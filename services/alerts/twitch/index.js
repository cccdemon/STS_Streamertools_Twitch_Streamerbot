'use strict';

const crypto = require('crypto');
const { config } = require('./config.js');
const store = require('./store.js');
const { authorizeUrl, exchangeCode, helix } = require('./auth.js');
const { sendChat } = require('./chat.js');
const { EventSubClient } = require('./eventsub.js');
const { ChatReplies } = require('./replies.js');
const { ChatCommands } = require('./commands.js');
const { SongRequests } = require('./songrequest.js');
const { WishPlayer } = require('./wishplayer.js');
const spotifyApi = require('./spotify.js');
const { log, logErr } = require('./log.js');

// Twitch-Chatbefehle ohne Streamerbot: eigener Broadcaster-Login, Chat ueber
// EventSub lesen, ueber Helix antworten. Aufbau wie im DerDeimos-Overlay.
//
// Routen (durch Caddy unter /alerts/...):
//   GET /auth/login?key=ADMIN_TOKEN   Twitch-Login starten
//   GET /auth/callback                Redirect-Ziel von Twitch
//   GET /auth/spotify/login?key=...   Spotify fuer !sr verbinden
//   GET /auth/spotify/callback        Redirect-Ziel von Spotify
// Die beiden Spotify-Routen reicht Caddy zusaetzlich ohne /alerts-Praefix
// durch — gleiche URLs wie im DerDeimos-Overlay.

const eventsub = new EventSubClient(handleChat);
const say = (message) => sendChat(eventsub.broadcaster, message);

const replies = new ChatReplies({ replies: config.chatReplies, say });
const commands = new ChatCommands({
  getBroadcaster: () => eventsub.broadcaster,
  say,
  krakenTarget: config.krakenTarget,
});
const wishes = new WishPlayer({
  api: {
    player: spotifyApi.player,
    queue: spotifyApi.rawQueue,
    playUris: spotifyApi.playUris,
    playContext: spotifyApi.playContext,
  },
  load: store.getWishes,
  save: store.setWishes,
  log: (m) => log('Wunsch', m),
  logErr: (m) => logErr('Wunsch', m),
});
const songs = new SongRequests({ getBroadcaster: () => eventsub.broadcaster, say, wishes });
const WISH_TICK_MS = 1500;

function handleChat(e) {
  const text = e?.message?.text;
  const user = e?.chatter_user_name || e?.chatter_user_login || '';
  if (replies.handle(text, { source: `chat:${e?.chatter_user_login}`, user })) return;
  if (commands.handle(e)) return;
  songs.handle(e);
}

function requireAdmin(req, res, next) {
  const key = req.query.key || req.get('x-admin-token') || '';
  if (!config.adminToken || key !== config.adminToken) {
    return res.status(401).send('unauthorized — ADMIN_TOKEN in .env setzen und ?key= anhaengen');
  }
  next();
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function mount(app) {
  const pendingStates = new Set();

  app.get('/auth/login', requireAdmin, (_req, res) => {
    if (!config.clientId || !config.clientSecret) {
      return res.status(500).send('TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET fehlen in .env');
    }
    const state = crypto.randomBytes(16).toString('hex');
    pendingStates.add(state);
    setTimeout(() => pendingStates.delete(state), 10 * 60_000);
    res.redirect(authorizeUrl(state));
  });

  app.get('/auth/callback', async (req, res) => {
    const { code, state, error, error_description: desc } = req.query;
    if (error) return res.status(400).send(`Twitch-Fehler: ${escapeHtml(desc || error)}`);
    if (!state || !pendingStates.delete(String(state))) {
      return res.status(400).send('Ungueltiger oder abgelaufener state-Parameter. Login neu starten.');
    }
    try {
      await exchangeCode(String(code));
      eventsub.stop();
      await eventsub.start();
      res.send('<!doctype html><meta charset="utf-8"><title>Kanal verbunden</title>'
        + '<h1>Kanal verbunden</h1><p>Fenster kann geschlossen werden.</p>');
    } catch (err) {
      logErr('TwitchAuth', 'callback:', err.message);
      res.status(500).send('Token-Tausch fehlgeschlagen — Server-Log pruefen.');
    }
  });

  // ── Spotify (Songwuensche) ──
  app.get('/auth/spotify/login', requireAdmin, (_req, res) => {
    if (!spotifyApi.spotifyConfigured()) {
      return res.status(500).send('SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET fehlen in .env');
    }
    const state = crypto.randomBytes(16).toString('hex');
    pendingStates.add(state);
    setTimeout(() => pendingStates.delete(state), 10 * 60_000);
    res.redirect(spotifyApi.authorizeUrl(state));
  });

  app.get('/auth/spotify/callback', async (req, res) => {
    const { code, state, error } = req.query;
    if (error) return res.status(400).send(`Spotify-Fehler: ${escapeHtml(error)}`);
    if (!state || !pendingStates.delete(String(state))) {
      return res.status(400).send('Ungueltiger oder abgelaufener state-Parameter. Login neu starten.');
    }
    try {
      await spotifyApi.exchangeCode(String(code));
      res.send('<!doctype html><meta charset="utf-8"><title>Spotify verbunden</title>'
        + '<h1>Spotify verbunden</h1><p>Fenster kann geschlossen werden.</p>');
    } catch (err) {
      logErr('Spotify', 'callback:', err.message);
      res.status(500).send('Spotify-Token-Tausch fehlgeschlagen — Server-Log pruefen.');
    }
  });
}

async function start(redis) {
  await store.init(redis);
  log('Twitch', `Chatbefehle: ${[...replies.names(), ...commands.names(), ...songs.names()].join(', ')}`);
  await eventsub.start().catch((err) => logErr('EventSub', 'start:', err.message));
  // Fragt Spotify nur, solange Wuensche offen sind.
  setInterval(() => wishes.tick(), WISH_TICK_MS).unref();
}

function status() {
  return {
    eventsub: eventsub.status,
    channel: config.channel || null,
    connected: Boolean(store.getTokens()?.accessToken),
    spotify: !spotifyApi.spotifyConfigured() ? 'nicht-konfiguriert'
      : spotifyApi.spotifyConnected() ? 'verbunden' : 'nicht-verbunden',
    wishes: wishes.state().pending.length,
  };
}

// Aktive Ziele fuer GET /api/goals (Szenen-Rahmen). 60 s Cache: mehrere
// Rahmen fragen im Minutentakt, Helix soll davon nur eine Anfrage sehen.
const GOAL_LABELS = {
  follower: 'Follower-Ziel',
  subscription: 'Abo-Ziel',
  subscription_count: 'Abo-Ziel',
  new_subscription: 'Neue-Abos-Ziel',
  new_subscription_count: 'Neue-Abos-Ziel',
};
let goalsCache = { at: 0, list: [] };

function normalizeGoals(data) {
  return (data || []).filter((g) => GOAL_LABELS[g?.type]).map((g) => ({
    type: g.type,
    label: GOAL_LABELS[g.type],
    description: String(g.description || '').trim().slice(0, 80),
    current: Number(g.current_amount) || 0,
    target: Number(g.target_amount) || 0,
  }));
}

async function goals() {
  if (Date.now() - goalsCache.at < 60_000) return goalsCache.list;
  const b = eventsub.broadcaster;
  if (!b?.id) return [];
  const res = await helix('/goals', { query: { broadcaster_id: b.id } });
  goalsCache = { at: Date.now(), list: normalizeGoals(res?.data) };
  return goalsCache.list;
}

module.exports = { mount, start, status, goals, normalizeGoals };
