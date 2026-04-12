'use strict';

// ════════════════════════════════════════════════════════
// CHAOS CREW v5 – API Server
// Watchtime-Logik liegt hier, nicht in Streamerbot
// Streamerbot schickt nur rohe Events per WebSocket
// ════════════════════════════════════════════════════════

const Redis     = require('ioredis');
const WebSocket = require('ws');
const express   = require('express');
const { Pool }  = require('pg');
const { WatchtimeEngine, K, sanitizeUsername, sanitizeStr } = require('./watchtime.js');

// ── Config ────────────────────────────────────────────────
const CFG = {
  sbHost:  process.env.SB_HOST   || '192.168.178.39',
  sbPort:  parseInt(process.env.SB_PORT    || '9090'),
  apiPort: parseInt(process.env.API_PORT   || '3000'),
  redis: {
    host:          process.env.REDIS_HOST || 'redis',
    port:          parseInt(process.env.REDIS_PORT || '6379'),
    db:            parseInt(process.env.REDIS_DB   || '0'),  // PROD: 0, TEST: 1
    lazyConnect:   true,
    retryStrategy: (t) => Math.min(t * 500, 5000),
  },
  pg: {
    host:     process.env.PG_HOST     || 'postgres',
    port:     parseInt(process.env.PG_PORT || '5432'),
    database: process.env.PG_DB       || 'chaoscrew',
    user:     process.env.PG_USER     || 'chaoscrew',
    password: process.env.PG_PASSWORD || 'changeme',
    max:      10,
    idleTimeoutMillis: 30000,
  },
  reconnectDelay: 3000,
};

// ── Redis + PG ────────────────────────────────────────────
const redis = new Redis(CFG.redis);
const pg    = new Pool(CFG.pg);

redis.on('connect', () => console.log('[Redis] Connected (DB ' + CFG.redis.db + ')'));
redis.on('error',   (e) => console.error('[Redis] Error:', e.message));
pg.on('error',      (e) => console.error('[PG] Error:', e.message));

async function redisReady() {
  for (let i = 0; i < 30; i++) {
    try { await redis.connect(); await redis.ping(); console.log('[Redis] Ready'); return; }
    catch(e) { console.log(`[Redis] Waiting... (${i+1}/30)`); await sleep(2000); }
  }
  throw new Error('[Redis] Could not connect');
}

async function pgReady() {
  for (let i = 0; i < 30; i++) {
    try { const c = await pg.connect(); c.release(); console.log('[PG] Ready'); return; }
    catch(e) { console.log(`[PG] Waiting... (${i+1}/30): ${e.message}`); await sleep(2000); }
  }
  throw new Error('[PG] Could not connect');
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
  await pg.query(`
    INSERT INTO sessions (id) VALUES ($1)
    ON CONFLICT (id) DO NOTHING
  `, [currentSessionId]);
  await redis.set(K.gwSessionId(), currentSessionId);
  console.log('[Session] Created:', currentSessionId);
  return currentSessionId;
}

async function openGiveaway(keyword) {
  const sid = await ensureSession();
  await wte.openGiveaway(keyword, sid);
  await pg.query(`
    UPDATE sessions SET keyword = $1 WHERE id = $2
  `, [keyword || '', sid]);
  broadcastAll({ event: 'gw_status', status: 'open' });
  console.log('[GW] Opened, keyword:', keyword);
}

async function closeGiveaway() {
  const sid = currentSessionId || await redis.get(K.gwSessionId());
  await wte.closeGiveaway(sid);
  currentSessionId = null;
  broadcastAll({ event: 'gw_status', status: 'closed' });
  console.log('[GW] Closed');
}

// ── WebSocket Server (Browser-Clients) ───────────────────
const wss = new WebSocket.Server({ port: 9091 });
const clients = new Map(); // sessionId → ws

wss.on('connection', (ws) => {
  const clientId = `c_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
  clients.set(clientId, ws);

  ws.on('message', async (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    await handleClientMessage(ws, msg);
  });

  ws.on('close', () => clients.delete(clientId));
});

function broadcastAll(obj) {
  const str = JSON.stringify(obj);
  for (const [, ws] of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(str);
  }
}

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
    case 'sf_status_request': {
      const live = await redis.get('sf_live') === 'true';
      send({ event: 'sf_status', live });
      break;
    }
  }
}

async function handleAdminCmd(send, msg) {
  const cmd = msg.cmd;

  switch (cmd) {
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
      const sid = currentSessionId;
      await closeGiveaway();
      await wte.resetGiveaway();
      currentSessionId = null;
      send({ event: 'gw_ack', type: 'reset' });
      break;
    }
    case 'gw_draw_winner': {
      const participants = await wte.getAllParticipants();
      const eligible = participants.filter(p => !p.banned && p.coins > 0);
      if (!eligible.length) { send({ event: 'gw_ack', type: 'no_winner' }); break; }
      // Gewichtete Zufallsauswahl nach Coins
      const total = eligible.reduce((s, p) => s + p.coins, 0);
      let rand = Math.random() * total;
      let winner = eligible[eligible.length - 1];
      for (const p of eligible) { rand -= p.coins; if (rand <= 0) { winner = p; break; } }
      // In PG speichern
      if (currentSessionId) {
        await pg.query(`
          UPDATE sessions SET winner=$1, winner_watch_sec=$2, winner_coins=$3 WHERE id=$4
        `, [winner.username, winner.watchSec, winner.coins, currentSessionId]);
        await pg.query(`UPDATE users SET times_won = times_won + 1 WHERE username=$1`, [winner.username]);
      }
      send({ event: 'gw_ack', type: 'winner_drawn', winner: winner.username, watchSec: winner.watchSec, coins: winner.coins });
      broadcastAll({ event: 'gw_overlay', winner: winner.username, coins: winner.coins });
      break;
    }
  }
}

// ── Streamerbot WS Client ─────────────────────────────────
// Streamerbot schickt nur noch rohe Events – kein State mehr
let sbWs = null;

function connectToStreamerbot() {
  if (sbWs) { try { sbWs.terminate(); } catch(e){} }

  const url = `ws://${CFG.sbHost}:${CFG.sbPort}`;
  console.log('[SB] Connecting to', url);
  sbWs = new WebSocket(url);

  sbWs.on('open', () => {
    console.log('[SB] Connected');
    sbWs.send(JSON.stringify({ event: 'cc_api_register' }));
  });

  sbWs.on('message', async (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    try { await handleSbEvent(msg); } catch(e) { console.error('[SB] Handler error:', e.message); }
  });

  sbWs.on('close', () => {
    console.log('[SB] Disconnected, reconnecting in', CFG.reconnectDelay, 'ms');
    setTimeout(connectToStreamerbot, CFG.reconnectDelay);
  });

  sbWs.on('error', (e) => console.error('[SB] Error:', e.message));
}

// Streamerbot Event Handler
async function handleSbEvent(msg) {
  if (!msg || !msg.event) return;
  const sid = currentSessionId || await redis.get(K.gwSessionId());

  switch (msg.event) {

    // ── Viewer Tick (Present Viewer) ─────────────────────
    // SB schickt: { event: 'viewer_tick', user: 'username' }
    case 'viewer_tick': {
      const result = await wte.handleViewerTick(msg.user, sid);
      if (result) {
        console.log(`[Tick] ${msg.user}: +${result.added}s → ${result.watchSec}s (${result.coins} coins)`);
        broadcastAll({ event: 'wt_update', user: msg.user, watchSec: result.watchSec, coins: result.coins });
      }
      break;
    }

    // ── Chat Message ─────────────────────────────────────
    // SB schickt: { event: 'chat_msg', user: 'username', message: '...' }
    case 'chat_msg': {
      const result = await wte.handleChatMessage(msg.user, msg.message, sid);
      if (result && result.isNew) {
        console.log(`[GW] New registration: ${msg.user}`);
        broadcastAll({ event: 'gw_join', user: msg.user });
      }
      if (result && result.added) {
        console.log(`[Chat] ${msg.user}: +${result.added}s → ${result.watchSec}s`);
        broadcastAll({ event: 'wt_update', user: msg.user, watchSec: result.watchSec, coins: result.coins });
      }
      break;
    }

    // ── !time / !coin Command ─────────────────────────────
    // SB schickt: { event: 'time_cmd', user: 'username' }
    case 'time_cmd': {
      const u = sanitizeUsername(msg.user);
      const state = await wte.getUserState(u);
      const open  = await redis.get(K.gwOpen()) === 'true';

      if (!open) {
        sbSend({ event: 'chat_reply', user: u, message: `@${u} Kein Giveaway aktiv.` });
        break;
      }
      if (!state.registered) {
        sbSend({ event: 'chat_reply', user: u, message: `@${u} Du bist noch nicht registriert!` });
        break;
      }

      const h = Math.floor(state.watchSec / 3600);
      const m = Math.floor((state.watchSec % 3600) / 60);
      const s = state.watchSec % 60;
      const timeStr = h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;

      const nextFull = Math.floor(state.coins) + 1;
      const secsLeft = Math.round((nextFull - state.coins) * 7200);
      const minsLeft = Math.floor(secsLeft / 60);
      const nextStr  = minsLeft >= 60 ? `${Math.floor(minsLeft/60)}h ${minsLeft%60}m` : `${minsLeft}m`;

      sbSend({ event: 'chat_reply', user: u,
        message: `@${u} Watchtime: ${timeStr} | Coins: ${state.coins.toFixed(2)} | Nächstes Coin in ca. ${nextStr}` });
      break;
    }

    // ── Spacefight Result ─────────────────────────────────
    case 'spacefight_result': {
      if (msg.winner && msg.loser) {
        await saveSpacefightResult(msg);
        broadcastAll({ event: 'sf_result', winner: msg.winner, loser: msg.loser, ship_w: msg.ship_w, ship_l: msg.ship_l });
      }
      break;
    }

    // ── Shoutout / Raid → an Browser-Overlays weiterleiten ─
    case 'shoutout':
    case 'raid':
      broadcastAll(msg);
      break;

    // ── Stream Online / Offline ───────────────────────────
    case 'stream_online':  await redis.set('sf_live', 'true');  broadcastAll({ event: 'sf_status', live: true });  break;
    case 'stream_offline': await redis.set('sf_live', 'false'); broadcastAll({ event: 'sf_status', live: false }); break;

    // ── Challenge Events (Spacefight) ─────────────────────
    case 'fight_cmd':
      broadcastAll(msg);
      break;

    case 'spacefight_challenge': {
      const a = msg.attacker || '';
      const d = msg.defender || '';
      if (a && d) {
        sbSend({ event: 'chat_reply', message: `@${d}, @${a} fordert dich zum Raumkampf heraus! Tippe !ja um anzunehmen oder !nein um abzulehnen. (30s)` });
      }
      broadcastAll(msg);
      break;
    }

    case 'spacefight_rejected': {
      const reason = msg.reason || '';
      const a = msg.attacker || '';
      const d = msg.defender || '';
      if (reason === 'not_in_chat') {
        sbSend({ event: 'chat_reply', message: `@${a} ${d} ist gerade nicht im Chat aktiv.` });
      } else if (reason === 'challenge_timeout') {
        sbSend({ event: 'chat_reply', message: `@${a} ${d} hat nicht reagiert. Challenge abgelaufen.` });
      } else if (reason === 'challenge_declined') {
        sbSend({ event: 'chat_reply', message: `@${a} ${d} hat den Kampf abgelehnt.` });
      } else if (reason === 'stream_offline') {
        sbSend({ event: 'chat_reply', message: `@${a} Kämpfe sind nur während des Streams möglich.` });
      }
      broadcastAll(msg);
      break;
    }
  }
}

function sbSend(obj) {
  if (sbWs && sbWs.readyState === WebSocket.OPEN)
    sbWs.send(JSON.stringify(obj));
}

// ── Spacefight ─────────────────────────────────────────────
async function saveSpacefightResult(result) {
  const winner = sanitizeUsername(result.winner);
  const loser  = sanitizeUsername(result.loser);
  if (!winner || !loser) return;

  const client = await pg.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO spacefight_results (winner, loser, ship_w, ship_l) VALUES ($1,$2,$3,$4)',
      [winner, loser, sanitizeStr(result.ship_w||'',30), sanitizeStr(result.ship_l||'',30)]
    );
    await client.query(`
      INSERT INTO spacefight_stats (username, display, wins, losses, last_fight)
      VALUES ($1,$2,1,0,NOW())
      ON CONFLICT (username) DO UPDATE SET
        wins = spacefight_stats.wins + 1, last_fight = NOW()
    `, [winner, result.winner || winner]);
    await client.query(`
      INSERT INTO spacefight_stats (username, display, wins, losses, last_fight)
      VALUES ($1,$2,0,1,NOW())
      ON CONFLICT (username) DO UPDATE SET
        losses = spacefight_stats.losses + 1, last_fight = NOW()
    `, [loser, result.loser || loser]);
    await client.query('COMMIT');

    // Redis Sorted Set aktualisieren
    const wins = (await pg.query('SELECT wins FROM spacefight_stats WHERE username=$1', [winner])).rows[0]?.wins || 0;
    await redis.zadd(K.sfIndex(), wins, winner);
    console.log(`[SF] ${winner} defeated ${loser}`);
  } catch(e) {
    await client.query('ROLLBACK');
    console.error('[SF] Save error:', e.message);
  } finally {
    client.release();
  }
}

// ── REST API ──────────────────────────────────────────────
const app = express();
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
    res.json({ status: 'ok', session: currentSessionId, redis: 'ok', pg: 'ok' });
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
    const pg_row = await pg.query('SELECT * FROM users WHERE username=$1', [state.username]);
    res.json({ ...state, lifetime: pg_row.rows[0] || null });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/sessions', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '20'), 100);
    const result = await pg.query(
      'SELECT * FROM sessions ORDER BY opened_at DESC LIMIT $1', [limit]
    );
    res.json(result.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/leaderboard', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50'), 500);
    const result = await pg.query(
      'SELECT * FROM users ORDER BY total_watch_sec DESC LIMIT $1', [limit]
    );
    res.json(result.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/spacefight/leaderboard', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '10'), 100);
    const result = await pg.query(
      'SELECT *, CASE WHEN wins+losses > 0 THEN ROUND(wins::numeric/(wins+losses)*100) ELSE 0 END AS ratio FROM spacefight_stats ORDER BY wins DESC, last_fight DESC LIMIT $1',
      [limit]
    );
    res.json(result.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/spacefight/history', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '20'), 100);
    const result = await pg.query(
      'SELECT * FROM spacefight_results ORDER BY ts DESC LIMIT $1', [limit]
    );
    res.json(result.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/spacefight/player/:username', async (req, res) => {
  try {
    const u = sanitizeUsername(req.params.username);
    const result = await pg.query('SELECT * FROM spacefight_stats WHERE username=$1', [u]);
    if (!result.rows.length) return res.status(404).json({ error: 'not found' });
    const rank = await redis.zrevrank(K.sfIndex(), u);
    res.json({ ...result.rows[0], rank: rank !== null ? rank + 1 : null });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/chat/send', (req, res) => {
  const msg = sanitizeStr(req.body?.message || '');
  if (!msg) return res.status(400).json({ error: 'message required' });
  sbSend({ event: 'chat_reply', message: msg });
  res.json({ status: 'ok' });
});

app.post('/api/backup/trigger', async (req, res) => {
  try {
    await redis.bgsave();
    res.json({ status: 'ok', message: 'Redis BGSAVE triggered' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Start ─────────────────────────────────────────────────
async function main() {
  await redisReady();
  await pgReady();

  const existing = await redis.get(K.gwSessionId());
  if (existing) { currentSessionId = existing; console.log('[Session] Resuming:', currentSessionId); }

  app.listen(CFG.apiPort, () => console.log(`[API] REST on port ${CFG.apiPort}`));
  console.log('[WS] Browser WS on port 9091');
  connectToStreamerbot();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
main().catch(err => { console.error('[FATAL]', err.message); process.exit(1); });
