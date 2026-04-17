'use strict';

// ════════════════════════════════════════════════════════
// CHAOS CREW – Alert Service
// Follow, cheer, raid, shoutout, sub, hype train,
// clip, ad break alerts. Claude AI summaries.
// Twitch user lookup. Chat send.
//
// Redis Sub: ch:alerts (follow, cheer, raid, shoutout,
//            first_chatter)
//            ch:chat   (chat_msg for HUD, clip_created,
//            ad_break_start, ad_break_end)
// Redis Pub: ch:chat_reply (shoutout reply)
// WS:  broadcast-only (overlays connect here)
// REST: /api/twitch/user/:login, /api/claude/summary,
//       /api/chat/send
// ════════════════════════════════════════════════════════

const Redis   = require('ioredis');
const WebSocket = require('ws');
const express = require('express');
const http    = require('http');

function log(tag, ...args)    { console.log( `[${tag}]`, ...args); }
function logErr(tag, ...args) { console.error(`[${tag}]`, ...args); }

function sanitizeStr(s, maxLen = 100) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[\u0000-\u001f\x80-\xFF<>"'`]/g, '').slice(0, maxLen);
}
function sanitizeUsername(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 25);
}

const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY || '';

const CFG = {
  port: parseInt(process.env.PORT || '3003'),
  redis: {
    host:          process.env.REDIS_HOST || 'redis',
    port:          parseInt(process.env.REDIS_PORT || '6379'),
    db:            parseInt(process.env.REDIS_DB   || '0'),
    lazyConnect:   true,
    retryStrategy: (t) => Math.min(t * 500, 5000),
  },
};

const redis    = new Redis(CFG.redis);
const redisSub = new Redis(CFG.redis);
const redisPub = new Redis(CFG.redis);

redis.on('connect',    () => log('Redis', 'Main connected'));
redis.on('error',      (e) => logErr('Redis', 'Main:', e.message));
redisSub.on('connect', () => log('Redis', 'Sub connected'));
redisSub.on('error',   (e) => logErr('Redis', 'Sub:', e.message));

async function redisReady() {
  for (let i = 0; i < 30; i++) {
    try {
      await redis.connect();
      await redis.ping();
      await redisSub.connect();
      await redisPub.connect();
      log('Redis', 'Ready');
      return;
    } catch(e) { log('Redis', `Waiting... (${i + 1}/30)`); await sleep(2000); }
  }
  throw new Error('Redis: Could not connect');
}

// ── WS Server (broadcast-only for overlays) ──────────────
const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });
const clients = new Map();

function broadcastAll(obj) {
  const str = JSON.stringify(obj);
  for (const [, c] of clients) {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(str);
  }
}

wss.on('connection', (ws, req) => {
  const clientId = `al_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const meta = { ws, role: null, ip: req.socket.remoteAddress, connectedAt: Date.now(), msgCount: 0 };
  clients.set(clientId, meta);
  log('WS', `Connected: ${clientId} – ${clients.size} total`);

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    meta.msgCount++;
    if (msg.event === 'cc_identify') {
      meta.role = sanitizeStr(msg.role || '', 50);
      log('WS', `${clientId} identified as: ${meta.role}`);
    }
  });

  ws.on('close', () => {
    clients.delete(clientId);
    log('WS', `Disconnected: ${clientId} – ${clients.size} remaining`);
  });
});

// ── Redis Pub/Sub: ch:alerts + ch:chat ───────────────────
function subscribeToAlerts() {
  redisSub.subscribe('ch:alerts', 'ch:chat', (err) => {
    if (err) { logErr('Sub', err.message); return; }
    log('Sub', 'Subscribed to ch:alerts, ch:chat');
  });

  redisSub.on('message', async (channel, payload) => {
    let msg;
    try { msg = JSON.parse(payload); } catch { return; }

    log('Alert', `← [${channel}] ${msg.event}`);

    if (channel === 'ch:alerts') {
      switch (msg.event) {
        case 'follow':
        case 'cheer':
        case 'raid':
          broadcastAll(msg);
          break;
        case 'shoutout':
          broadcastAll(msg);
          break;
        case 'first_chatter': {
          const enabled = await redis.get('cc_first_chatter_enabled') === 'true';
          if (enabled && msg.user) {
            const u = sanitizeUsername(msg.user);
            if (u) {
              redisPub.publish('ch:chat_reply', JSON.stringify({
                event: 'chat_reply',
                message: `@${u} Willkommen in der Chaos Crew! Schön, dass du heute zum ersten Mal chattest! chaoscrHype`,
              }));
              log('FirstChatter', u);
            }
          }
          break;
        }
      }
    }

    if (channel === 'ch:chat') {
      switch (msg.event) {
        case 'chat_msg':
          // Forward to HUD overlay
          broadcastAll(msg);
          break;
        case 'clip_created':
        case 'ad_break_start':
        case 'ad_break_end':
          broadcastAll(msg);
          break;
      }
    }
  });
}

// ── Twitch user lookup ────────────────────────────────────
let twitchToken = null;
let twitchTokenExp = 0;

async function getTwitchToken() {
  if (twitchToken && Date.now() < twitchTokenExp - 60000) return twitchToken;
  const cid = process.env.TWITCH_CLIENT_ID;
  const sec = process.env.TWITCH_CLIENT_SECRET;
  if (!cid || !sec) return null;
  const r = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cid, client_secret: sec, grant_type: 'client_credentials' }),
  });
  if (!r.ok) return null;
  const j = await r.json();
  twitchToken    = j.access_token;
  twitchTokenExp = Date.now() + (j.expires_in || 0) * 1000;
  return twitchToken;
}

// ── Claude prompts ────────────────────────────────────────
const CLAUDE_PROMPTS = {
  shoutout: (user, game, bio) =>
    `Du bist der Bordcomputer eines Raumschiffs im Firefly-Universum.\n` +
    `Die Crew gibt einem Twitch-Kanal einen Shoutout. Schreibe eine kurze, warme Empfehlung auf Deutsch – maximal 2 Sätze. Verwende ausschließlich den Kanalnamen, keine Pronomen (nicht er/sie/es/ihm/ihr). Normaler Satzbau, kein Markdown, keine Aufzählungen.\n\n` +
    `Streamer: ${user}\nLetztes Spiel: ${game || 'unbekannt'}\nKanal-Bio: ${bio || 'keine Angaben'}\n\nAntworte nur mit dem Text.`,
  raid: (user, game, bio) =>
    `Du bist der Bordcomputer eines Raumschiffs im Firefly-Universum.\n` +
    `Ein Twitch-Kanal hat gerade einen Raid gesendet. Schreibe eine kurze Crew-Analyse auf Deutsch – maximal 2 Sätze. Verwende ausschließlich den Kanalnamen, keine Pronomen (nicht er/sie/es/ihm/ihr). Normaler Satzbau, kein Markdown, keine Aufzählungen.\n\n` +
    `Streamer: ${user}\nLetztes Spiel: ${game || 'unbekannt'}\nKanal-Bio: ${bio || 'keine Angaben'}\n\nAntworte nur mit dem Analysetext.`,
};

// ── REST ──────────────────────────────────────────────────
app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

app.get('/health', async (req, res) => {
  try {
    await redis.ping();
    res.json({ status: 'ok', service: 'alerts', redis: 'ok', claude: !!ANTHROPIC_KEY });
  } catch(e) {
    res.status(503).json({ status: 'error', error: e.message });
  }
});

app.get('/api/twitch/user/:login', async (req, res) => {
  try {
    const token = await getTwitchToken();
    if (!token) return res.status(503).json({ error: 'Twitch credentials not configured' });
    const login = sanitizeUsername(req.params.login);
    if (!login) return res.status(400).json({ error: 'invalid login' });
    const r = await fetch(`https://api.twitch.tv/helix/users?login=${login}`, {
      headers: { 'Client-Id': process.env.TWITCH_CLIENT_ID, 'Authorization': `Bearer ${token}` },
    });
    if (!r.ok) return res.status(r.status).json({ error: `Twitch API ${r.status}` });
    const j = await r.json();
    const u = j.data?.[0];
    if (!u) return res.status(404).json({ error: 'user not found' });
    res.json({ login: u.login, display_name: u.display_name, profile_image_url: u.profile_image_url, description: u.description });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/claude/summary', async (req, res) => {
  if (!ANTHROPIC_KEY) return res.status(503).json({ error: 'ANTHROPIC_KEY nicht konfiguriert' });

  const type = req.body?.type === 'raid' ? 'raid' : 'shoutout';
  const user = sanitizeStr(req.body?.user || '', 50);
  const game = sanitizeStr(req.body?.game || '', 100);
  const bio  = sanitizeStr(req.body?.bio  || '', 300);
  if (!user) return res.status(400).json({ error: 'user required' });

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: type === 'raid' ? 200 : 80,
        messages: [{ role: 'user', content: CLAUDE_PROMPTS[type](user, game, bio) }],
      }),
    });
    if (!r.ok) {
      const err = await r.text();
      logErr('Claude', `API error ${r.status}:`, err);
      return res.status(502).json({ error: `Claude API: HTTP ${r.status}` });
    }
    const json = await r.json();
    const summary = json.content?.find(b => b.type === 'text')?.text?.trim() || '';
    log('Claude', `${type} for ${user}: ${summary.length} chars`);
    res.json({ summary });
  } catch(e) {
    logErr('Claude', 'Fetch error:', e.message);
    res.status(502).json({ error: e.message });
  }
});

app.post('/api/chat/send', (req, res) => {
  const msg = sanitizeStr(req.body?.message || '', 500);
  if (!msg) return res.status(400).json({ error: 'message required' });
  redisPub.publish('ch:chat_reply', JSON.stringify({ event: 'chat_reply', message: msg }));
  res.json({ status: 'ok' });
});

// Serve static web files (overlays)
app.use(express.static('public'));

// ── Start ─────────────────────────────────────────────────
async function main() {
  await redisReady();
  subscribeToAlerts();
  server.listen(CFG.port, () => {
    log('Alerts', `Service on port ${CFG.port}`);
    log('Claude', ANTHROPIC_KEY ? 'API key configured' : 'WARNING: ANTHROPIC_KEY not set');
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
main().catch(err => { logErr('FATAL', err.message); process.exit(1); });
