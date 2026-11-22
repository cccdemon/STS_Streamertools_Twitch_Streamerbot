'use strict';

const crypto = require('crypto');
const { config } = require('./config.js');
const store = require('./store.js');
const { authorizeUrl, exchangeCode, helix } = require('./auth.js');
const { sendChat } = require('./chat.js');
const { EventSubClient } = require('./eventsub.js');
const { ChatReplies } = require('./replies.js');
const { ChatCommands } = require('./commands.js');
const { SongRequests, songState, limits } = require('./songrequest.js');
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
//   /api/regie/*                      Regie-Seite (/admin/regie.html), nur mit
//                                     x-admin-token: Wunschliste, An/Aus, Status
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

  // ── Regie ──
  app.get('/api/regie/state', requireAdmin, async (_req, res) => {
    res.json(await regieState());
  });

  app.post('/api/regie/songs/enabled', requireAdmin, async (req, res) => {
    const enabled = req.body?.enabled === true;
    await store.setSongState({ ...songState(), enabled });
    log('Regie', `Songwuensche ${enabled ? 'an' : 'aus'}`);
    res.json(await regieState());
  });

  // action: 'remove' streicht, 'front' zieht nach vorn. 409, wenn der Eintrag
  // nicht mehr an der Stelle steht (Liste hat sich inzwischen bewegt).
  app.post('/api/regie/wishes/:action', requireAdmin, async (req, res) => {
    const index = Number.parseInt(req.body?.index, 10);
    const uri = String(req.body?.uri || '');
    const run = { remove: () => wishes.removeAt(index, uri), front: () => wishes.moveToFront(index, uri) }[req.params.action];
    if (!run) return res.status(404).json({ error: 'unbekannte Aktion' });
    const hit = await run();
    if (hit) log('Regie', `Wunsch ${req.params.action}: „${hit.title}“ (${hit.user})`);
    res.status(hit ? 200 : 409).json(await regieState());
  });
}

// Laufender Titel fuer die Regie. 3 s Cache: mehrere offene Regie-Tabs sollen
// Spotify nicht je Tab und Takt einzeln fragen.
let nowCache = { at: 0, value: null, error: '' };

async function nowPlaying() {
  if (!spotifyApi.spotifyConnected()) return { now: null, playerError: '' };
  if (Date.now() - nowCache.at > 3000) {
    try {
      const p = await spotifyApi.player();
      const item = p?.item;
      nowCache = {
        at: Date.now(),
        error: item ? '' : 'Spotify spielt gerade nichts ab.',
        value: item ? {
          uri: item.uri,
          title: spotifyApi.sanitizeStr(item.name ?? '', 80),
          artists: spotifyApi.sanitizeStr((item.artists || []).map((a) => a.name).join(', '), 80),
          progressMs: p.progress_ms || 0,
          durationMs: item.duration_ms || 0,
          playing: Boolean(p.is_playing),
        } : null,
      };
    } catch (err) {
      nowCache = { at: Date.now(), value: null, error: 'Spotify antwortet nicht.' };
      logErr('Regie', 'player:', err.message);
    }
  }
  return { now: nowCache.value, playerError: nowCache.error };
}

// Alles, was die Regie-Seite zeigt. Keine Tokens.
async function regieState() {
  const s = songState();
  const w = wishes.state();
  const { now, playerError } = await nowPlaying();
  const slim = (x) => ({ uri: x.uri, title: x.title, artists: x.artists || '', user: x.user, durationMs: x.durationMs || 0 });
  // Der laufende Titel ist ein Wunsch, solange Spotify noch genau den spielt.
  const active = w.active && (!w.active.seenUri || w.active.seenUri === now?.uri)
    ? { title: w.active.title, user: w.active.user } : null;
  return {
    songs: {
      enabled: s.enabled,
      history: s.history,
      playlist: s.playlist ? { name: s.playlist.name, url: s.playlist.url } : null,
      limits,
    },
    wishes: { pending: w.pending.map(slim), active },
    now,
    playerError,
    spotify: {
      configured: spotifyApi.spotifyConfigured(),
      connected: spotifyApi.spotifyConnected(),
      needsReconnect: spotifyApi.spotifyConnected() && !spotifyApi.hasPlaylistScope(),
    },
    twitch: { eventsub: eventsub.status, channel: config.channel || null, connected: Boolean(store.getTokens()?.accessToken) },
  };
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
