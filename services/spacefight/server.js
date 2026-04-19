'use strict';

// ════════════════════════════════════════════════════════
// CHAOS CREW – Spacefight Service
// Fight engine, battle results, leaderboard.
//
// Redis Sub: ch:spacefight (fight_cmd, spacefight_challenge,
//            spacefight_result, spacefight_rejected,
//            stream_online, stream_offline)
// Redis Pub: ch:chat_reply (challenge/rejection messages)
// WS:  admin commands + battle broadcasts
// REST: /api/spacefight/leaderboard, /history, /player/:u
// ════════════════════════════════════════════════════════

const Redis     = require('ioredis');
const WebSocket = require('ws');
const express   = require('express');
const http      = require('http');
const { Pool }  = require('pg');

function log(tag, ...args)    { console.log( `[${tag}]`, ...args); }
function logErr(tag, ...args) { console.error(`[${tag}]`, ...args); }

function sanitizeUsername(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 25);
}
function sanitizeStr(s, maxLen = 100) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[\u0000-\u001f\x80-\xFF<>"'`]/g, '').slice(0, maxLen);
}

const CFG = {
  port: parseInt(process.env.PORT || '3002'),
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

const SF_GAME_ACTIVE = 'sf_game_active';
const SF_LIVE        = 'sf_live';
const SF_INDEX       = 'sf:index';

const redis    = new Redis(CFG.redis);
const redisSub = new Redis(CFG.redis);
const redisPub = new Redis(CFG.redis);
const pg       = new Pool(CFG.pg);

redis.on('connect',    () => log('Redis', 'Main connected'));
redis.on('error',      (e) => logErr('Redis', 'Main:', e.message));
redisSub.on('connect', () => log('Redis', 'Sub connected'));
redisSub.on('error',   (e) => logErr('Redis', 'Sub:', e.message));
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

// ── WS Server ─────────────────────────────────────────────
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

function broadcastClients() {
  const list = [...clients.entries()].map(([id, c]) => ({
    id, role: c.role || 'unbekannt', ip: c.ip, connectedAt: c.connectedAt, msgCount: c.msgCount,
  }));
  broadcastAll({ event: 'ws_clients', clients: list });
}

wss.on('connection', (ws, req) => {
  const clientId = `sf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const meta = { ws, role: null, ip: req.socket.remoteAddress, connectedAt: Date.now(), msgCount: 0 };
  clients.set(clientId, meta);
  log('WS', `Connected: ${clientId} – ${clients.size} total`);
  broadcastClients();

  ws.on('message', async (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    meta.msgCount++;

    if (msg.event === 'cc_identify') {
      meta.role = sanitizeStr(msg.role || '', 50);
      broadcastClients();
      return;
    }

    broadcastAll({ event: 'ws_traffic', clientId, role: meta.role || 'unbekannt', msgEvent: msg.event || '?', ts: Date.now() });
    const send = (obj) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(obj));

    switch (msg.event) {
      case 'sf_status_request': {
        const live       = await redis.get(SF_LIVE)        === 'true';
        const gameActive = await redis.get(SF_GAME_ACTIVE) === 'true';
        send({ event: 'sf_game_status', active: gameActive, live });
        break;
      }
      case 'sf_cmd':
        await handleSfCmd(send, msg);
        break;
      case 'spacefight_result': {
        if (msg.winner && msg.loser) {
          await saveSpacefightResult(msg);
          broadcastAll({ event: 'sf_result', winner: msg.winner, loser: msg.loser, ship_w: msg.ship_w, ship_l: msg.ship_l });
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    clients.delete(clientId);
    log('WS', `Disconnected: ${clientId} – ${clients.size} remaining`);
    broadcastClients();
  });
});

async function handleSfCmd(send, msg) {
  switch (msg.cmd) {
    case 'sf_start': {
      await redis.set(SF_GAME_ACTIVE, 'true');
      broadcastAll({ event: 'sf_game_status', active: true });
      log('SF', 'Game activated');
      break;
    }
    case 'sf_stop': {
      await redis.set(SF_GAME_ACTIVE, 'false');
      broadcastAll({ event: 'sf_game_status', active: false });
      log('SF', 'Game deactivated');
      break;
    }
    case 'sf_reset': {
      await pg.query('DELETE FROM spacefight_stats');
      await pg.query('DELETE FROM spacefight_results');
      await redis.del(SF_INDEX);
      send({ event: 'sf_ack', type: 'reset' });
      log('SF', 'All data reset');
      break;
    }
    case 'sf_delete_player': {
      const u = sanitizeUsername(msg.user);
      if (!u) break;
      await pg.query('DELETE FROM spacefight_stats WHERE username=$1', [u]);
      await pg.query('DELETE FROM spacefight_results WHERE winner=$1 OR loser=$1', [u]);
      await redis.zrem(SF_INDEX, u);
      send({ event: 'sf_ack', type: 'player_deleted', user: u });
      log('SF', 'Player deleted:', u);
      break;
    }
    case 'sf_edit_player': {
      const u = sanitizeUsername(msg.user);
      if (!u) break;
      const wins   = Math.max(0, parseInt(msg.wins)   || 0);
      const losses = Math.max(0, parseInt(msg.losses) || 0);
      await pg.query('UPDATE spacefight_stats SET wins=$1, losses=$2 WHERE username=$3', [wins, losses, u]);
      await redis.zadd(SF_INDEX, wins, u);
      send({ event: 'sf_ack', type: 'player_edited', user: u, wins, losses });
      log('SF', 'Player edited:', u, wins, losses);
      break;
    }
  }
}

// ── Fight result persistence ──────────────────────────────
async function saveSpacefightResult(result) {
  const winner = sanitizeUsername(result.winner);
  const loser  = sanitizeUsername(result.loser);
  if (!winner || !loser) return;

  const client = await pg.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO spacefight_results (winner, loser, ship_w, ship_l) VALUES ($1,$2,$3,$4)',
      [winner, loser, sanitizeStr(result.ship_w || '', 30), sanitizeStr(result.ship_l || '', 30)]
    );
    await client.query(`
      INSERT INTO spacefight_stats (username, display, wins, losses, last_fight)
      VALUES ($1,$2,1,0,NOW())
      ON CONFLICT (username) DO UPDATE SET wins = spacefight_stats.wins + 1, last_fight = NOW()
    `, [winner, result.winner || winner]);
    await client.query(`
      INSERT INTO spacefight_stats (username, display, wins, losses, last_fight)
      VALUES ($1,$2,0,1,NOW())
      ON CONFLICT (username) DO UPDATE SET losses = spacefight_stats.losses + 1, last_fight = NOW()
    `, [loser, result.loser || loser]);
    await client.query('COMMIT');

    const row = await pg.query('SELECT wins FROM spacefight_stats WHERE username=$1', [winner]);
    await redis.zadd(SF_INDEX, row.rows[0]?.wins || 0, winner);
    log('SF', `${winner} defeated ${loser}`);
  } catch(e) {
    await client.query('ROLLBACK');
    logErr('SF', 'Save error:', e.message);
  } finally {
    client.release();
  }
}

// ── Redis Pub/Sub: consume ch:spacefight ─────────────────
function subscribeToSpacefight() {
  redisSub.subscribe('ch:spacefight', (err) => {
    if (err) { logErr('Sub', err.message); return; }
    log('Sub', 'Subscribed to ch:spacefight');
  });

  redisSub.on('message', async (channel, payload) => {
    if (channel !== 'ch:spacefight') return;
    let msg;
    try { msg = JSON.parse(payload); } catch { return; }

    log('SF', `← ${msg.event}`);

    switch (msg.event) {
      case 'fight_cmd': {
        const gameActive = await redis.get(SF_GAME_ACTIVE) === 'true';
        if (!gameActive) break;
        broadcastAll(msg);
        break;
      }
      case 'spacefight_challenge': {
        const a = msg.attacker || '';
        const d = msg.defender || '';
        if (a && d) {
          redisPub.publish('ch:chat_reply', JSON.stringify({
            event: 'chat_reply',
            message: `@${d}, @${a} fordert dich zum Raumkampf heraus! Tippe !ja um anzunehmen oder !nein um abzulehnen. (30s)`,
          }));
        }
        broadcastAll(msg);
        break;
      }
      case 'spacefight_rejected': {
        const reason = msg.reason || '';
        const a = msg.attacker || '';
        const d = msg.defender || '';
        let reply = '';
        if (reason === 'not_in_chat')          reply = `@${a} Zielerfassung fehlgeschlagen — ${d} ist nicht verfügbar, das war nur ein Radarecho. 📡`;
        else if (reason === 'challenge_timeout') reply = `@${a} ${d} hat nicht reagiert. Challenge abgelaufen.`;
        else if (reason === 'challenge_declined') reply = `@${a} ${d} hat den Kampf abgelehnt.`;
        else if (reason === 'stream_offline')   reply = `@${a} Es gibt noch kein Schlachtfeld oder du bist zu spät. 🛸`;
        if (reply) redisPub.publish('ch:chat_reply', JSON.stringify({ event: 'chat_reply', message: reply }));
        broadcastAll(msg);
        break;
      }
      case 'spacefight_result': {
        if (msg.winner && msg.loser) {
          await saveSpacefightResult(msg);
          broadcastAll({ event: 'sf_result', winner: msg.winner, loser: msg.loser, ship_w: msg.ship_w, ship_l: msg.ship_l });
        }
        break;
      }
      case 'stream_online':
        await redis.set(SF_LIVE, 'true');
        broadcastAll({ event: 'sf_status', live: true });
        break;
      case 'stream_offline':
        await redis.set(SF_LIVE, 'false');
        broadcastAll({ event: 'sf_status', live: false });
        break;
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
    res.json({ status: 'ok', service: 'spacefight', redis: 'ok', pg: 'ok' });
  } catch(e) {
    res.status(503).json({ status: 'error', error: e.message });
  }
});

app.get('/api/spacefight/leaderboard', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '10'), 100);
    const result = await pg.query(
      `SELECT *, CASE WHEN wins+losses > 0 THEN ROUND(wins::numeric/(wins+losses)*100) ELSE 0 END AS ratio
       FROM spacefight_stats ORDER BY wins DESC, last_fight DESC LIMIT $1`, [limit]
    );
    res.json(result.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/spacefight/history', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '20'), 100);
    const result = await pg.query('SELECT * FROM spacefight_results ORDER BY ts DESC LIMIT $1', [limit]);
    res.json(result.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/spacefight/player/:username', async (req, res) => {
  try {
    const u = sanitizeUsername(req.params.username);
    const result = await pg.query('SELECT * FROM spacefight_stats WHERE username=$1', [u]);
    if (!result.rows.length) return res.status(404).json({ error: 'not found' });
    const rank = await redis.zrevrank(SF_INDEX, u);
    res.json({ ...result.rows[0], rank: rank !== null ? rank + 1 : null });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/spacefight', async (req, res) => {
  try {
    const { winner, loser, ship_w, ship_l } = req.body || {};
    if (!winner || !loser) return res.status(400).json({ error: 'winner and loser required' });
    await saveSpacefightResult({ winner, loser, ship_w: ship_w || '', ship_l: ship_l || '' });
    broadcastAll({ event: 'sf_result', winner, loser, ship_w, ship_l });
    res.json({ status: 'ok' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Serve static web files
app.use(express.static('public'));

// ── Start ─────────────────────────────────────────────────
async function main() {
  await redisReady();
  await pgReady();
  subscribeToSpacefight();
  server.listen(CFG.port, () => log('Spacefight', `Service on port ${CFG.port}`));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
main().catch(err => { logErr('FATAL', err.message); process.exit(1); });
