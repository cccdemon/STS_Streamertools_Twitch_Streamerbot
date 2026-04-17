'use strict';

// ════════════════════════════════════════════════════════
// CHAOS CREW – Giveaway Service
// Watchtime engine, coin calculation, winner draw,
// giveaway open/close, first-chatter toggle.
//
// Redis Sub: ch:giveaway (viewer_tick, chat_msg, time_cmd)
// Redis Pub: ch:chat_reply (time_cmd replies, first chatter)
// WS (9001):  admin commands + broadcasts
// REST:       /api/participants, /api/user/:u, /api/sessions, /api/leaderboard
// ════════════════════════════════════════════════════════

const Redis     = require('ioredis');
const WebSocket = require('ws');
const express   = require('express');
const http      = require('http');
const { Pool }  = require('pg');
const { WatchtimeEngine, K, sanitizeUsername, sanitizeStr } = require('./watchtime.js');

function log(tag, ...args)    { console.log( `[${tag}]`, ...args); }
function logErr(tag, ...args) { console.error(`[${tag}]`, ...args); }

const CFG = {
  port: parseInt(process.env.PORT || '3001'),
  redis: {
    host:          process.env.REDIS_HOST || 'redis',
    port:          parseInt(process.env.REDIS_PORT || '6379'),
    db:            parseInt(process.env.REDIS_DB   || '0'),
    lazyConnect:   true,
    retryStrategy: (t) => Math.min(t * 500, 5000),
  },
  pg: {
    host:     process.env.PG_HOST     || 'postgres',
    port:     parseInt(process.env.PG_PORT || '5432'),
    database: process.env.PG_DB       || 'chaoscrew',
    user:     process.env.PG_USER     || 'chaoscrew',
    password: process.env.PG_PASSWORD || 'changeme',
    max: 10,
    idleTimeoutMillis: 30000,
  },
};

// ── Redis: three clients (main, sub, pub for replies) ────
const redis    = new Redis(CFG.redis);
const redisSub = new Redis(CFG.redis);
const redisPub = new Redis(CFG.redis);
const pg       = new Pool(CFG.pg);

redis.on('connect',    () => log('Redis', 'Main connected'));
redis.on('error',      (e) => logErr('Redis', 'Main:', e.message));
redisSub.on('connect', () => log('Redis', 'Sub connected'));
redisSub.on('error',   (e) => logErr('Redis', 'Sub:', e.message));
redisPub.on('connect', () => log('Redis', 'Pub connected'));
redisPub.on('error',   (e) => logErr('Redis', 'Pub:', e.message));
pg.on('error',         (e) => logErr('PG', e.message));

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

async function pgReady() {
  for (let i = 0; i < 30; i++) {
    try { const c = await pg.connect(); c.release(); log('PG', 'Ready'); return; }
    catch(e) { log('PG', `Waiting... (${i + 1}/30): ${e.message}`); await sleep(2000); }
  }
  throw new Error('PG: Could not connect');
}

// ── Watchtime Engine ──────────────────────────────────────
const wte = new WatchtimeEngine(redis, pg);
let currentSessionId = null;

// ── Session Management ────────────────────────────────────
async function ensureSession() {
  if (currentSessionId) return currentSessionId;
  const existing = await redis.get(K.gwSessionId());
  if (existing) { currentSessionId = existing; return existing; }
  currentSessionId = `sess_${Date.now()}`;
  await pg.query(`INSERT INTO sessions (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [currentSessionId]);
  await redis.set(K.gwSessionId(), currentSessionId);
  log('Session', 'Created:', currentSessionId);
  return currentSessionId;
}

async function openGiveaway(keyword) {
  const sid = await ensureSession();
  await wte.openGiveaway(keyword, sid);
  await pg.query(`UPDATE sessions SET keyword = $1 WHERE id = $2`, [keyword || '', sid]);
  broadcastAll({ event: 'gw_status', status: 'open' });
  log('GW', 'Opened, keyword:', keyword);
}

async function closeGiveaway() {
  const sid = currentSessionId || await redis.get(K.gwSessionId());
  await wte.closeGiveaway(sid);
  currentSessionId = null;
  broadcastAll({ event: 'gw_status', status: 'closed' });
  log('GW', 'Closed');
}

// ── WS Server ─────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });
const clients = new Map(); // clientId → { ws, role, ip, connectedAt, msgCount }

function broadcastAll(obj) {
  const str = JSON.stringify(obj);
  for (const [, c] of clients) {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(str);
  }
}

function broadcastClients() {
  const list = [...clients.entries()].map(([id, c]) => ({
    id, role: c.role || 'unbekannt', ip: c.ip, connectedAt: c.connectedAt, msgCount: c.msgCount,
  }));
  broadcastAll({ event: 'ws_clients', clients: list });
}

wss.on('connection', (ws, req) => {
  const clientId = `gw_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const meta = { ws, role: null, ip: req.socket.remoteAddress, connectedAt: Date.now(), msgCount: 0 };
  clients.set(clientId, meta);
  log('WS', `Connected: ${clientId} (${meta.ip}) – ${clients.size} total`);
  broadcastClients();

  ws.on('message', async (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    meta.msgCount++;

    if (msg.event === 'cc_identify') {
      meta.role = sanitizeStr(msg.role || '', 50);
      log('WS', `${clientId} identified as: ${meta.role}`);
      broadcastClients();
      return;
    }

    broadcastAll({ event: 'ws_traffic', clientId, role: meta.role || 'unbekannt', msgEvent: msg.event || '?', ts: Date.now() });
    await handleClientMessage(ws, msg);
  });

  ws.on('close', () => {
    clients.delete(clientId);
    log('WS', `Disconnected: ${clientId} – ${clients.size} remaining`);
    broadcastClients();
  });
});

async function handleClientMessage(ws, msg) {
  const send = (obj) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(obj));

  switch (msg.event) {
    case 'gw_get_all': {
      const participants = await wte.getAllParticipants();
      const open = await redis.get(K.gwOpen()) === 'true';
      const firstChatterEnabled = await redis.get('cc_first_chatter_enabled') === 'true';
      send({ event: 'gw_data', open, session: currentSessionId, participants });
      send({ event: 'cc_first_chatter_status', enabled: firstChatterEnabled });
      break;
    }
    case 'gw_cmd':
      await handleAdminCmd(send, msg);
      break;
  }
}

async function handleAdminCmd(send, msg) {
  switch (msg.cmd) {
    case 'gw_open': {
      await openGiveaway(msg.keyword || '');
      send({ event: 'gw_status', status: 'open' });
      break;
    }
    case 'gw_close': {
      await closeGiveaway();
      send({ event: 'gw_status', status: 'closed' });
      break;
    }
    case 'gw_set_keyword': {
      const kw = sanitizeStr(msg.keyword || '', 100);
      await redis.set(K.gwKeyword(), kw);
      if (currentSessionId) await pg.query('UPDATE sessions SET keyword=$1 WHERE id=$2', [kw, currentSessionId]);
      send({ event: 'gw_ack', type: 'keyword_set', keyword: kw });
      break;
    }
    case 'gw_get_keyword': {
      const kw = await redis.get(K.gwKeyword()) || '';
      send({ event: 'gw_ack', type: 'keyword', keyword: kw });
      break;
    }
    case 'gw_add_ticket': {
      const u = sanitizeUsername(msg.user);
      if (!u) return;
      const newSec = await redis.incrby(K.gwWatchSec(u), 7200);
      send({ event: 'gw_ack', type: 'ticket_added', user: u, watchSec: newSec });
      break;
    }
    case 'gw_sub_ticket': {
      const u = sanitizeUsername(msg.user);
      if (!u) return;
      const cur = parseInt(await redis.get(K.gwWatchSec(u)) || '0');
      const newSec = Math.max(0, cur - 7200);
      await redis.set(K.gwWatchSec(u), String(newSec));
      send({ event: 'gw_ack', type: 'ticket_removed', user: u, watchSec: newSec });
      break;
    }
    case 'gw_ban': {
      const u = sanitizeUsername(msg.user);
      if (!u) return;
      await redis.set(K.gwBanned(u), '1');
      send({ event: 'gw_ack', type: 'banned', user: u });
      break;
    }
    case 'gw_unban': {
      const u = sanitizeUsername(msg.user);
      if (!u) return;
      await redis.del(K.gwBanned(u));
      send({ event: 'gw_ack', type: 'unbanned', user: u });
      break;
    }
    case 'gw_reset': {
      await closeGiveaway();
      await wte.resetGiveaway();
      currentSessionId = null;
      send({ event: 'gw_ack', type: 'reset' });
      break;
    }
    case 'cc_first_chatter_toggle': {
      const cur = await redis.get('cc_first_chatter_enabled') === 'true';
      const next = !cur;
      await redis.set('cc_first_chatter_enabled', next ? 'true' : 'false');
      log('FirstChatter', next ? 'Aktiviert' : 'Deaktiviert');
      broadcastAll({ event: 'cc_first_chatter_status', enabled: next });
      break;
    }
    case 'gw_draw_winner': {
      const participants = await wte.getAllParticipants();
      const eligible = participants.filter(p => !p.banned && p.coins > 0);
      if (!eligible.length) { send({ event: 'gw_ack', type: 'no_winner' }); break; }
      const total = eligible.reduce((s, p) => s + p.coins, 0);
      let rand = Math.random() * total;
      let winner = eligible[eligible.length - 1];
      for (const p of eligible) { rand -= p.coins; if (rand <= 0) { winner = p; break; } }
      if (currentSessionId) {
        await pg.query(`UPDATE sessions SET winner=$1, winner_watch_sec=$2, winner_coins=$3 WHERE id=$4`,
          [winner.username, winner.watchSec, winner.coins, currentSessionId]);
        await pg.query(`UPDATE users SET times_won = times_won + 1 WHERE username=$1`, [winner.username]);
      }
      send({ event: 'gw_ack', type: 'winner_drawn', winner: winner.username, watchSec: winner.watchSec, coins: winner.coins });
      broadcastAll({ event: 'gw_overlay', winner: winner.username, coins: winner.coins });
      break;
    }
  }
}

// ── Redis Pub/Sub: consume ch:giveaway ───────────────────
function subscribeToGiveaway() {
  redisSub.subscribe('ch:giveaway', (err) => {
    if (err) { logErr('Sub', 'ch:giveaway:', err.message); return; }
    log('Sub', 'Subscribed to ch:giveaway');
  });

  redisSub.on('message', async (channel, payload) => {
    if (channel !== 'ch:giveaway') return;
    let msg;
    try { msg = JSON.parse(payload); } catch { return; }

    const sid = currentSessionId || await redis.get(K.gwSessionId());
    log('GW', `← ${msg.event}${msg.user ? ' [' + msg.user + ']' : ''}`);

    switch (msg.event) {
      case 'viewer_tick': {
        const result = await wte.handleViewerTick(msg.user, sid);
        if (result) {
          broadcastAll({ event: 'wt_update', user: msg.user, watchSec: result.watchSec, coins: result.coins });
        }
        break;
      }
      case 'chat_msg': {
        const result = await wte.handleChatMessage(msg.user, msg.message, sid);
        if (result && result.isNew) {
          log('GW', 'New registration:', msg.user);
          broadcastAll({ event: 'gw_join', user: msg.user });
        }
        if (result && result.added) {
          broadcastAll({ event: 'wt_update', user: msg.user, watchSec: result.watchSec, coins: result.coins });
        }
        break;
      }
      case 'time_cmd': {
        const u = sanitizeUsername(msg.user);
        const state = await wte.getUserState(u);
        const open  = await redis.get(K.gwOpen()) === 'true';
        let reply;
        if (!open) {
          reply = `@${u} Kein Giveaway aktiv.`;
        } else if (!state.registered) {
          reply = `@${u} Du bist noch nicht registriert!`;
        } else {
          const h = Math.floor(state.watchSec / 3600);
          const m = Math.floor((state.watchSec % 3600) / 60);
          const s = state.watchSec % 60;
          const timeStr = h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
          const nextFull = Math.floor(state.coins) + 1;
          const secsLeft = Math.round((nextFull - state.coins) * 7200);
          const minsLeft = Math.floor(secsLeft / 60);
          const nextStr  = minsLeft >= 60 ? `${Math.floor(minsLeft / 60)}h ${minsLeft % 60}m` : `${minsLeft}m`;
          reply = `@${u} Watchtime: ${timeStr} | Coins: ${state.coins.toFixed(2)} | Nächstes Coin in ca. ${nextStr}`;
        }
        redisPub.publish('ch:chat_reply', JSON.stringify({ event: 'chat_reply', message: reply }));
        break;
      }
    }
  });
}

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
    await pg.query('SELECT 1');
    res.json({ status: 'ok', service: 'giveaway', session: currentSessionId, redis: 'ok', pg: 'ok' });
  } catch(e) {
    res.status(503).json({ status: 'error', error: e.message });
  }
});

app.get('/api/participants', async (req, res) => {
  try {
    const participants = await wte.getAllParticipants();
    const open = await redis.get(K.gwOpen()) === 'true';
    res.json({ session: currentSessionId, open, participants });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/user/:username', async (req, res) => {
  try {
    const state = await wte.getUserState(req.params.username);
    const row = await pg.query('SELECT * FROM users WHERE username=$1', [state.username]);
    res.json({ ...state, lifetime: row.rows[0] || null });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/sessions', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '20'), 100);
    const result = await pg.query('SELECT * FROM sessions ORDER BY opened_at DESC LIMIT $1', [limit]);
    res.json(result.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/leaderboard', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50'), 500);
    const result = await pg.query('SELECT * FROM users ORDER BY total_watch_sec DESC LIMIT $1', [limit]);
    res.json(result.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/ws/clients', (_req, res) => {
  const list = [...clients.entries()].map(([id, c]) => ({
    id, role: c.role || 'unbekannt', ip: c.ip, connectedAt: c.connectedAt, msgCount: c.msgCount,
  }));
  res.json({ clients: list, total: list.length });
});

// Serve static web files
app.use(express.static('public'));

// ── Start ─────────────────────────────────────────────────
async function main() {
  await redisReady();
  await pgReady();

  const existing = await redis.get(K.gwSessionId());
  if (existing) { currentSessionId = existing; log('Session', 'Resuming:', currentSessionId); }

  subscribeToGiveaway();

  server.listen(CFG.port, () => log('Giveaway', `Service on port ${CFG.port}`));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
main().catch(err => { logErr('FATAL', err.message); process.exit(1); });
