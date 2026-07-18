'use strict';

// ════════════════════════════════════════════════════════
// CHAOS CREW – Giveaway Service
// Watchtime engine, coin calculation, winner draw,
// giveaway open/close, first-chatter toggle.
//
// Redis Sub: ch:giveaway (viewer_tick, chat_msg, time_cmd)
// Redis Pub: ch:chat_reply (time_cmd replies, first chatter)
// WS + REST (3001): admin commands + broadcasts; same HTTP server
// REST:       /api/participants, /api/user/:u, /api/sessions, /api/leaderboard
// ════════════════════════════════════════════════════════

const Redis     = require('ioredis');
const WebSocket = require('ws');
const express   = require('express');
const http      = require('http');
const { Pool }  = require('pg');
const { WatchtimeEngine, K, sanitizeUsername, sanitizeStr, TICK_SEC } = require('./watchtime.js');

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
async function openGiveaway(keyword) {
  // Jedes Öffnen startet eine frische Session (neues Giveaway = neue Session).
  currentSessionId = `sess_${Date.now()}`;
  await pg.query(
    `INSERT INTO sessions (id, keyword) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
    [currentSessionId, keyword || '']
  );
  await redis.set(K.gwSessionId(), currentSessionId);
  await wte.openGiveaway(keyword, currentSessionId);
  broadcastAll({ event: 'gw_status', status: 'open' });
  log('GW', 'Opened, session:', currentSessionId, 'keyword:', keyword);
}

async function closeGiveaway() {
  const sid = currentSessionId || await redis.get(K.gwSessionId());
  await wte.closeGiveaway(sid);
  // currentSessionId bewusst NICHT zurücksetzen: Reroll nach dem Schließen
  // braucht die Session, damit times_won korrekt umgebucht wird (gw_reset löscht).
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
      send({ event: 'gw_data', open, session: currentSessionId, participants });
      break;
    }
    case 'gw_cmd':
      await handleAdminCmd(send, msg);
      break;

    // Overlay-Relay: Admin/Test senden gw_overlay (winner / clear) → an alle
    // Clients weiterreichen, damit das OBS-Overlay (giveaway-overlay.html) es sieht.
    case 'gw_overlay':
      broadcastAll({ event: 'gw_overlay', winner: msg.winner || null, coins: msg.coins || 0 });
      break;

    // Test-Console-Simulation: viewer_tick / chat_msg / time_cmd kommen im
    // Echtbetrieb über die Bridge auf ch:giveaway. Über WS injizierte Sim-Events
    // werden hier auf denselben Kanal republished, damit der reguläre
    // Subscriber sie identisch verarbeitet.
    case 'viewer_tick':
    case 'chat_msg':
    case 'time_cmd':
      redisPub.publish('ch:giveaway', JSON.stringify(msg))
        .catch((e) => logErr('Sim', 'republish failed:', e.message));
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
      // User registrieren, sonst taucht er nicht in gwIndex auf → unsichtbar
      // für Teilnehmerliste und Ziehung (verwaiste watchSec).
      const sid = currentSessionId || await redis.get(K.gwSessionId());
      await wte.registerUser(u, sid);
      const newSec = await redis.incrby(K.gwWatchSec(u), 7200);
      await wte.logManualAdjust(u, 7200, sid);   // Audit-Trail
      send({ event: 'gw_ack', type: 'ticket_added', user: u, watchSec: newSec });
      break;
    }
    case 'gw_sub_ticket': {
      const u = sanitizeUsername(msg.user);
      if (!u) return;
      // Atomar abziehen, dann auf >=0 klemmen (vermeidet Race mit Ticker-incrby).
      const after = await redis.decrby(K.gwWatchSec(u), 7200);
      let newSec = after;
      if (after < 0) { await redis.set(K.gwWatchSec(u), '0'); newSec = 0; }
      const sid = currentSessionId || await redis.get(K.gwSessionId());
      await wte.logManualAdjust(u, -7200, sid);  // Audit-Trail
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
    case 'gw_draw_winner': {
      try {
        const sid = currentSessionId || await redis.get(K.gwSessionId());
        const result = await wte.drawWinner(sid, { test: !!msg.test, prize: msg.prize });
        if (!result) { send({ event: 'gw_ack', type: 'no_winner' }); break; }
        send({ event: 'gw_ack', type: 'winner_drawn', winner: result.winner,
               watchSec: result.watchSec, coins: result.coins, drawId: result.drawId, prize: result.prize });
        broadcastAll({ event: 'gw_overlay', winner: result.winner, coins: result.coins });
        log('GW', `Winner: ${result.winner} (draw #${result.drawId}, ${result.eligibleCount} eligible, pool ${result.total})`);
      } catch (e) {
        logErr('GW', 'draw_winner failed:', e.message);
        send({ event: 'gw_ack', type: 'draw_error', error: e.message });
      }
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
        // Nur Presence markieren – Accumulation macht der 60s-Ticker
        await wte.handleViewerTick(msg.user, sid);
        break;
      }
      case 'stream_online': {
        try {
          const r = await pg.query('TRUNCATE TABLE debug_log');
          log('Debug', 'debug_log truncated on stream_online');
          broadcastAll({ event: 'cc_debug', source: 'GW_Service', stage: 'truncate', user: null, info: 'debug_log cleared (stream_online)', ts: Date.now() });
        } catch(e) { logErr('Debug', 'TRUNCATE failed:', e.message); }
        break;
      }
      case 'cc_debug': {
        const source = sanitizeStr(msg.source, 50);
        const stage  = sanitizeStr(msg.stage, 50);
        const user   = msg.user ? sanitizeUsername(msg.user) : null;
        const info   = msg.info ? sanitizeStr(msg.info, 500) : null;
        try {
          await pg.query(
            `INSERT INTO debug_log (source, stage, username, info) VALUES ($1, $2, $3, $4)`,
            [source, stage, user, info]
          );
        } catch(e) { logErr('Debug', 'PG insert failed:', e.message); }
        broadcastAll({ event: 'cc_debug', source, stage, user, info, ts: Date.now() });
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

// Audit-Trail aller Ziehungen (Nachvollziehbarkeit).
// ?session=<id> filtert auf eine Session, ?full=1 inkl. eligible_snapshot.
app.get('/api/draws', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50'), 500);
    const cols = req.query.full === '1'
      ? '*'
      : 'id, session_id, winner, winner_coins, winner_watch_sec, total_coins, eligible_count, rand_value, draw_index, is_test, prize, drawn_at';
    const result = req.query.session
      ? await pg.query(`SELECT ${cols} FROM giveaway_draws WHERE session_id=$1 ORDER BY drawn_at DESC LIMIT $2`, [req.query.session, limit])
      : await pg.query(`SELECT ${cols} FROM giveaway_draws ORDER BY drawn_at DESC LIMIT $1`, [limit]);
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
// Idempotente Schema-Sicherung. Migrations werden bei bestehendem
// Volume NICHT automatisch angewendet (init.sql läuft nur bei frischem
// Datenverzeichnis) — daher hier garantieren, dass die Audit-Tabelle existiert.
async function ensureSchema() {
  await pg.query(`
    CREATE TABLE IF NOT EXISTS giveaway_draws (
      id                BIGSERIAL PRIMARY KEY,
      session_id        TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      winner            TEXT NOT NULL,
      winner_coins      NUMERIC(10,4) NOT NULL DEFAULT 0,
      winner_watch_sec  BIGINT NOT NULL DEFAULT 0,
      total_coins       NUMERIC(10,4) NOT NULL DEFAULT 0,
      eligible_count    INTEGER NOT NULL DEFAULT 0,
      rand_value        NUMERIC(20,10) NOT NULL DEFAULT 0,
      draw_index        INTEGER NOT NULL DEFAULT 1,
      is_test           BOOLEAN NOT NULL DEFAULT FALSE,
      prize             TEXT,
      eligible_snapshot JSONB,
      drawn_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  // Bestehende Volumes nachziehen (CREATE TABLE greift nur bei frischem Volume).
  await pg.query(`ALTER TABLE giveaway_draws ADD COLUMN IF NOT EXISTS prize TEXT`);
  await pg.query(`CREATE INDEX IF NOT EXISTS idx_draws_session ON giveaway_draws(session_id)`);
  await pg.query(`CREATE INDEX IF NOT EXISTS idx_draws_winner  ON giveaway_draws(winner)`);
  await pg.query(`CREATE INDEX IF NOT EXISTS idx_draws_ts      ON giveaway_draws(drawn_at DESC)`);
  log('Schema', 'giveaway_draws ensured');
}

async function main() {
  await redisReady();
  await pgReady();
  await ensureSchema();

  const existing = await redis.get(K.gwSessionId());
  if (existing) { currentSessionId = existing; log('Session', 'Resuming:', currentSessionId); }

  subscribeToGiveaway();
  startWatchtimeTicker();

  server.listen(CFG.port, () => log('Giveaway', `Service on port ${CFG.port}`));
}

// ── Server-seitiger Watchtime-Ticker (jede Minute) ───────
function startWatchtimeTicker() {
  setInterval(async () => {
    try {
      const sid = currentSessionId || await redis.get(K.gwSessionId());
      const updates = await wte.tickPresentUsers(sid);
      for (const u of updates) {
        broadcastAll({ event: 'wt_update', user: u.username, watchSec: u.watchSec, coins: u.coins });
      }
    } catch(e) { logErr('Tick', e.message); }
  }, TICK_SEC * 1000);
  log('Tick', `Watchtime-Ticker started (${TICK_SEC}s interval)`);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
main().catch(err => { logErr('FATAL', err.message); process.exit(1); });
