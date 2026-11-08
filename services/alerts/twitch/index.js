'use strict';

const crypto = require('crypto');
const { config } = require('./config.js');
const store = require('./store.js');
const { authorizeUrl, exchangeCode } = require('./auth.js');
const { sendChat } = require('./chat.js');
const { EventSubClient } = require('./eventsub.js');
const { ChatReplies } = require('./replies.js');
const { ChatCommands } = require('./commands.js');
const { log, logErr } = require('./log.js');

// Twitch-Chatbefehle ohne Streamerbot: eigener Broadcaster-Login, Chat ueber
// EventSub lesen, ueber Helix antworten. Aufbau wie im DerDeimos-Overlay.
//
// Routen (durch Caddy unter /alerts/...):
//   GET /auth/login?key=ADMIN_TOKEN   Twitch-Login starten
//   GET /auth/callback                Redirect-Ziel von Twitch

const eventsub = new EventSubClient(handleChat);
const say = (message) => sendChat(eventsub.broadcaster, message);

const replies = new ChatReplies({ replies: config.chatReplies, say });
const commands = new ChatCommands({
  getBroadcaster: () => eventsub.broadcaster,
  say,
  krakenTarget: config.krakenTarget,
});

function handleChat(e) {
  const text = e?.message?.text;
  const user = e?.chatter_user_name || e?.chatter_user_login || '';
  if (replies.handle(text, { source: `chat:${e?.chatter_user_login}`, user })) return;
  commands.handle(e);
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
}

async function start(redis) {
  await store.init(redis);
  log('Twitch', `Chatbefehle: ${[...replies.names(), ...commands.names()].join(', ')}`);
  await eventsub.start().catch((err) => logErr('EventSub', 'start:', err.message));
}

function status() {
  return {
    eventsub: eventsub.status,
    channel: config.channel || null,
    connected: Boolean(store.getTokens()?.accessToken),
  };
}

module.exports = { mount, start, status };
