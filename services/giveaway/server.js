'use strict';

// ════════════════════════════════════════════════════════
// TEAM GIVEAWAY – Giveaway Service (multi-tenant)
// Watchtime engine, coins, winner draw — all per team.
// Admin WS commands carry teamId; authorized via the X-Auth-User
// header injected by Caddy forward_auth (must own the team).
// Redis Sub: ch:giveaway (viewer_tick/chat_msg/time_cmd/… with team+channel)
// Redis Pub: ch:chat_reply (routed back to the origin channel's bot)
// ════════════════════════════════════════════════════════

const Redis     = require('ioredis');
const WebSocket = require('ws');
const express   = require('express');
const http      = require('http');
const crypto    = require('crypto');
const { Pool }  = require('pg');
const { WatchtimeEngine, K, sanitizeUsername, sanitizeStr, sanitizeTeamId, sanitizeChannel, TICK_SEC } = require('./watchtime.js');

function log(tag, ...args)    { console.log( `[${tag}]`, ...args); }
function logErr(tag, ...args) { console.error(`[${tag}]`, ...args); }

const CFG = {
  port: parseInt(process.env.PORT || '3001'),
  redis: {
    host: process.env.REDIS_HOST || 'redis', port: parseInt(process.env.REDIS_PORT || '6379'),
    db: parseInt(process.env.REDIS_DB || '0'), lazyConnect: true,
    retryStrategy: (t) => Math.min(t * 500, 5000),
  },
  pg: {
    host: process.env.PG_HOST || 'postgres', port: parseInt(process.env.PG_PORT || '5432'),
    database: process.env.PG_DB || 'chaoscrew', user: process.env.PG_USER || 'chaoscrew',
    password: process.env.PG_PASSWORD || 'changeme', max: 10, idleTimeoutMillis: 30000,
  },
};

const redis    = new Redis(CFG.redis);
const redisSub = new Redis(CFG.redis);
const redisPub = new Redis(CFG.redis);
const pg       = new Pool(CFG.pg);

redis.on('error',    (e) => logErr('Redis', 'Main:', e.message));
redisSub.on('error', (e) => logErr('Redis', 'Sub:', e.message));
redisPub.on('error', (e) => logErr('Redis', 'Pub:', e.message));
pg.on('error',       (e) => logErr('PG', e.message));

async function redisReady() {
  for (let i = 0; i < 30; i++) {
    try { await redis.connect(); await redis.ping(); await redisSub.connect(); await redisPub.connect(); log('Redis', 'Ready'); return; }
    catch(e) { log('Redis', `Waiting... (${i + 1}/30)`); await sleep(2000); }
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

const wte = new WatchtimeEngine(redis, pg);

// ── Team authz ────────────────────────────────────────────
async function ownsTeam(login, teamId) {
  if (!login || !teamId) return false;
  const r = await pg.query(`SELECT 1 FROM team_members WHERE team_id=$1 AND login=$2 AND role='owner'`, [teamId, login]);
  return r.rowCount > 0;
}
async function isMember(login, teamId) {
  if (!login || !teamId) return false;
  const r = await pg.query(`SELECT 1 FROM team_members WHERE team_id=$1 AND login=$2`, [teamId, login]);
  return r.rowCount > 0;
}

// ── Session (per team) ────────────────────────────────────
async function openGiveaway(teamId, keyword) {
  const sid = `sess_${Date.now()}`;
  await wte.openGiveaway(teamId, keyword, sid);
  const chans = await wte.getChannels(teamId);
  await pg.query(`INSERT INTO sessions (id, team_id, keyword, channels) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`,
    [sid, teamId, keyword || '', JSON.stringify(chans)]);
  broadcastTeam(teamId, { event: 'gw_status', status: 'open' });
  log('GW', `[${teamId}] opened session ${sid}, kw="${keyword}", channels=${chans.join(',')}`);
  return sid;
}
async function closeGiveaway(teamId) {
  const sid = await wte.getSessionId(teamId);
  await wte.closeGiveaway(teamId, sid);
  broadcastTeam(teamId, { event: 'gw_status', status: 'closed' });
  log('GW', `[${teamId}] closed`);
}

// ── WS Server ─────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });
const clients = new Map(); // clientId → { ws, authUser, teamId, role, ip, connectedAt, msgCount }

function broadcastTeam(teamId, obj) {
  const str = JSON.stringify(obj);
  for (const [, c] of clients) if (c.teamId === teamId && c.ws.readyState === WebSocket.OPEN) c.ws.send(str);
}

wss.on('connection', (ws, req) => {
  const clientId = `gw_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const authUser = sanitizeUsername(req.headers['x-auth-user'] || '');
  const meta = { ws, authUser, teamId: null, role: null, ip: req.socket.remoteAddress, connectedAt: Date.now(), msgCount: 0 };
  clients.set(clientId, meta);
  log('WS', `Connected: ${clientId} user=${authUser || '?'} (${clients.size} total)`);

  ws.on('message', async (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    meta.msgCount++;
    if (msg.event === 'cc_identify') { meta.role = sanitizeStr(msg.role || '', 50); return; }
    await handleClientMessage(meta, msg);
  });
  ws.on('close', () => { clients.delete(clientId); log('WS', `Disconnected: ${clientId}`); });
});

async function sendTeamData(meta) {
  const send = (o) => meta.ws.readyState === WebSocket.OPEN && meta.ws.send(JSON.stringify(o));
  const teamId = meta.teamId;
  const participants = await wte.getAllParticipants(teamId);
  const open = await wte.isOpen(teamId);
  const session = await wte.getSessionId(teamId);
  const channels = await wte.getChannels(teamId);
  send({ event: 'gw_data', teamId, open, session, participants, channels });
}

async function handleClientMessage(meta, msg) {
  const send = (obj) => meta.ws.readyState === WebSocket.OPEN && meta.ws.send(JSON.stringify(obj));

  switch (msg.event) {
    // Client wählt ein Team → nur Mitglieder dürfen dessen Daten sehen.
    case 'gw_subscribe':
    case 'gw_get_all': {
      const teamId = sanitizeTeamId(msg.teamId);
      if (!await isMember(meta.authUser, teamId)) { send({ event: 'gw_ack', type: 'forbidden' }); return; }
      meta.teamId = teamId;
      await sendTeamData(meta);
      break;
    }
    case 'gw_cmd':
      await handleAdminCmd(send, msg, meta);
      break;
    case 'gw_overlay': {
      const teamId = sanitizeTeamId(msg.teamId);
      if (await isMember(meta.authUser, teamId)) broadcastTeam(teamId, { event: 'gw_overlay', winner: msg.winner || null, coins: msg.coins || 0 });
      break;
    }
    // Test-Console-Sim: nur für eigene Teams republishen.
    case 'viewer_tick':
    case 'chat_msg':
    case 'time_cmd': {
      const teamId = sanitizeTeamId(msg.teamId);
      if (!await ownsTeam(meta.authUser, teamId)) return;
      redisPub.publish('ch:giveaway', JSON.stringify({ ...msg, team: teamId }))
        .catch((e) => logErr('Sim', 'republish failed:', e.message));
      break;
    }
  }
}

async function handleAdminCmd(send, msg, meta) {
  const teamId = sanitizeTeamId(msg.teamId);
  if (!await ownsTeam(meta.authUser, teamId)) { send({ event: 'gw_ack', type: 'forbidden' }); return; }
  const sid = () => wte.getSessionId(teamId);

  switch (msg.cmd) {
    case 'gw_open':
      await openGiveaway(teamId, sanitizeStr(msg.keyword || '', 100));
      send({ event: 'gw_status', status: 'open' });
      break;
    case 'gw_close':
      await closeGiveaway(teamId);
      send({ event: 'gw_status', status: 'closed' });
      break;
    case 'gw_set_keyword': {
      const kw = sanitizeStr(msg.keyword || '', 100);
      await redis.set(K.gwKeyword(teamId), kw);
      const s = await sid(); if (s) await pg.query('UPDATE sessions SET keyword=$1 WHERE id=$2', [kw, s]);
      send({ event: 'gw_ack', type: 'keyword_set', keyword: kw });
      break;
    }
    case 'gw_get_keyword':
      send({ event: 'gw_ack', type: 'keyword', keyword: await redis.get(K.gwKeyword(teamId)) || '' });
      break;
    case 'gw_get_channels':
      send({ event: 'gw_ack', type: 'channels', channels: await wte.getChannels(teamId) });
      break;
    case 'gw_add_ticket': {
      const u = sanitizeUsername(msg.user); if (!u) return;
      await wte.registerUser(teamId, u);
      const r = await wte.adjustWatch(teamId, u, msg.channel, 7200);
      send({ event: 'gw_ack', type: 'ticket_added', user: u, channel: r.channel, watchSec: r.watchSec });
      break;
    }
    case 'gw_sub_ticket': {
      const u = sanitizeUsername(msg.user); if (!u) return;
      const r = await wte.adjustWatch(teamId, u, msg.channel, -7200);
      send({ event: 'gw_ack', type: 'ticket_removed', user: u, channel: r.channel, watchSec: r.watchSec });
      break;
    }
    case 'gw_ban': {
      const u = sanitizeUsername(msg.user); if (!u) return;
      await wte.setBanned(teamId, u, true);
      send({ event: 'gw_ack', type: 'banned', user: u });
      break;
    }
    case 'gw_unban': {
      const u = sanitizeUsername(msg.user); if (!u) return;
      await wte.setBanned(teamId, u, false);
      send({ event: 'gw_ack', type: 'unbanned', user: u });
      break;
    }
    case 'gw_reset':
      await closeGiveaway(teamId);
      await wte.resetGiveaway(teamId);
      send({ event: 'gw_ack', type: 'reset' });
      break;
    case 'gw_set_multiplier': {
      const r = await wte.setMultiplier(teamId, msg.factor, (parseInt(msg.minutes) || 0) * 60);
      broadcastTeam(teamId, { event: 'gw_multiplier', factor: r.factor, secondsLeft: r.seconds });
      send({ event: 'gw_ack', type: 'multiplier_set', factor: r.factor, seconds: r.seconds });
      break;
    }
    case 'gw_get_multiplier': {
      const st = await wte.multiplierState(teamId);
      send({ event: 'gw_multiplier', factor: st.factor, secondsLeft: st.secondsLeft });
      break;
    }
    case 'gw_gen_ingest_token': {
      const ch = sanitizeChannel(msg.channel); if (!ch) return;
      const key = teamId + '::' + ch;
      const token = crypto.randomBytes(24).toString('base64url');
      const old = await redis.hget('ingest:team_tokens', key);
      if (old) await redis.hdel('ingest:tokens', old);
      await redis.hset('ingest:tokens', token, key);
      await redis.hset('ingest:team_tokens', key, token);
      send({ event: 'gw_ack', type: 'ingest_token', channel: ch, token });
      break;
    }
    case 'gw_get_ingest_tokens': {
      const map = await redis.hgetall('ingest:team_tokens');
      const tokens = Object.entries(map)
        .filter(([k]) => k.startsWith(teamId + '::'))
        .map(([k, token]) => ({ channel: k.split('::')[1], token }));
      send({ event: 'gw_ack', type: 'ingest_tokens', tokens });
      break;
    }
    case 'gw_revoke_ingest_token': {
      const ch = sanitizeChannel(msg.channel); if (!ch) return;
      const key = teamId + '::' + ch;
      const old = await redis.hget('ingest:team_tokens', key);
      if (old) await redis.hdel('ingest:tokens', old);
      await redis.hdel('ingest:team_tokens', key);
      send({ event: 'gw_ack', type: 'ingest_revoked', channel: ch });
      break;
    }
    case 'gw_draw_winner': {
      try {
        const result = await wte.drawWinner(teamId, await sid(), { test: !!msg.test, prize: msg.prize });
        if (!result) { send({ event: 'gw_ack', type: 'no_winner' }); break; }
        send({ event: 'gw_ack', type: 'winner_drawn', winner: result.winner, watchSec: result.watchSec, coins: result.coins, drawId: result.drawId, prize: result.prize });
        broadcastTeam(teamId, { event: 'gw_overlay', winner: result.winner, coins: result.coins });
      } catch (e) {
        logErr('GW', 'draw failed:', e.message);
        send({ event: 'gw_ack', type: 'draw_error', error: e.message });
      }
      break;
    }
  }
}

// ── Redis Pub/Sub: consume ch:giveaway ───────────────────
function subscribeToGiveaway() {
  redisSub.subscribe('ch:giveaway', (err) => { if (err) return logErr('Sub', err.message); log('Sub', 'Subscribed ch:giveaway'); });
  redisSub.on('message', async (channel, payload) => {
    if (channel !== 'ch:giveaway') return;
    let msg; try { msg = JSON.parse(payload); } catch { return; }
    const teamId = sanitizeTeamId(msg.team);

    switch (msg.event) {
      case 'viewer_tick':
        await wte.handleViewerTick(teamId, msg.channel, msg.user, msg.follows);
        break;
      case 'chat_msg': {
        const result = await wte.handleChatMessage(teamId, msg.channel, msg.user, msg.message, msg.follows);
        const u = sanitizeUsername(msg.user);
        if (result && result.registered === true && result.isNew) {
          broadcastTeam(teamId, { event: 'gw_join', user: u });
          redisPub.publish('ch:chat_reply', JSON.stringify({ event: 'chat_reply', channel: msg.channel,
            message: `@${u} Du bist im Giveaway-Lostopf! 🎟 ${result.coins.toFixed(2)} Punkte.` }));
        } else if (result && result.registered === false && result.needCoins) {
          redisPub.publish('ch:chat_reply', JSON.stringify({ event: 'chat_reply', channel: msg.channel,
            message: `@${u} Noch nicht genug: ${result.haveCoins.toFixed(2)}/${result.needCoins} Punkt. Schau weiter zu & schreib sinnvoll im Chat!` }));
        }
        if (result && result.added) broadcastTeam(teamId, { event: 'wt_update', user: u, channel: result.channel, watchSec: result.watchSec, coins: result.coins });
        break;
      }
      case 'time_cmd': {
        const u = sanitizeUsername(msg.user);
        let reply;
        if (!await wte.isOpen(teamId)) reply = `@${u} Kein Giveaway aktiv.`;
        else {
          const a = await wte.getUserAggregate(teamId, u);
          const kw = await redis.get(K.gwKeyword(teamId)) || '';
          if (a.eligible) {
            const all = await wte.getAllParticipants(teamId);
            const pool = all.filter(p => p.eligible).reduce((s, p) => s + p.totalCoins, 0);
            const chance = pool > 0 ? (a.totalCoins / pool * 100) : 0;
            reply = `@${u} 🎟 ${a.totalCoins.toFixed(2)} Punkte | Kanäle ${a.channelsQualified}/2 ✓ | Chance ${chance.toFixed(1)}% | im Lostopf ✅`;
          } else if (a.registered && a.channelsQualified < 2) {
            reply = `@${u} 🎟 ${a.totalCoins.toFixed(2)} Punkte, aber nur ${a.channelsQualified} Kanal – folge & sammle auf mind. 2 Kanälen!`;
          } else if (!a.registered && a.totalCoins >= 1) {
            reply = `@${u} 🎟 ${a.totalCoins.toFixed(2)} Punkte – schreib "${kw || 'das Keyword'}" um teilzunehmen!`;
          } else {
            reply = `@${u} 🎟 ${a.totalCoins.toFixed(2)} Punkte – schau zu & schreib sinnvoll im Chat (folge ≥2 Kanälen).`;
          }
        }
        redisPub.publish('ch:chat_reply', JSON.stringify({ event: 'chat_reply', channel: msg.channel, message: reply }));
        break;
      }
      case 'stream_online': {
        try { await pg.query('TRUNCATE TABLE debug_log'); } catch(e) { logErr('Debug', e.message); }
        break;
      }
      case 'cc_debug': {
        try {
          await pg.query(`INSERT INTO debug_log (source, stage, username, info) VALUES ($1,$2,$3,$4)`,
            [sanitizeStr(msg.source, 50), sanitizeStr(msg.stage, 50), msg.user ? sanitizeUsername(msg.user) : null, msg.info ? sanitizeStr(msg.info, 500) : null]);
        } catch(e) { logErr('Debug', e.message); }
        break;
      }
    }
  });
}

// ── REST (behind Caddy forward_auth; X-Auth-User trusted) ─
app.use(express.json());
app.use((req, res, next) => { res.header('Access-Control-Allow-Origin', '*'); res.header('Access-Control-Allow-Headers', 'Content-Type'); next(); });
function reqUser(req) { return sanitizeUsername(req.headers['x-auth-user'] || ''); }

app.get('/health', async (req, res) => {
  try { await redis.ping(); await pg.query('SELECT 1'); res.json({ status: 'ok', service: 'giveaway', redis: 'ok', pg: 'ok' }); }
  catch(e) { res.status(503).json({ status: 'error', error: e.message }); }
});

app.get('/api/participants', async (req, res) => {
  try {
    const teamId = sanitizeTeamId(req.query.team);
    if (!await isMember(reqUser(req), teamId)) return res.status(403).json({ error: 'forbidden' });
    res.json({ team: teamId, open: await wte.isOpen(teamId), session: await wte.getSessionId(teamId), participants: await wte.getAllParticipants(teamId) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/sessions', async (req, res) => {
  try {
    const teamId = sanitizeTeamId(req.query.team);
    if (!await isMember(reqUser(req), teamId)) return res.status(403).json({ error: 'forbidden' });
    const r = await pg.query('SELECT * FROM sessions WHERE team_id=$1 ORDER BY opened_at DESC LIMIT 50', [teamId]);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/draws', async (req, res) => {
  try {
    const teamId = sanitizeTeamId(req.query.team);
    if (!await isMember(reqUser(req), teamId)) return res.status(403).json({ error: 'forbidden' });
    const limit = Math.min(parseInt(req.query.limit || '50'), 500);
    const cols = req.query.full === '1' ? 'd.*'
      : 'd.id, d.session_id, d.winner, d.winner_coins, d.total_coins, d.eligible_count, d.rand_value, d.draw_index, d.is_test, d.prize, d.drawn_at';
    const r = await pg.query(`SELECT ${cols} FROM giveaway_draws d JOIN sessions s ON s.id=d.session_id
                              WHERE s.team_id=$1 ORDER BY d.drawn_at DESC LIMIT $2`, [teamId, limit]);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.use(express.static('public'));

// ── Schema ────────────────────────────────────────────────
async function ensureSchema() {
  await pg.query(`
    CREATE TABLE IF NOT EXISTS giveaway_draws (
      id BIGSERIAL PRIMARY KEY, session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      winner TEXT NOT NULL, winner_coins NUMERIC(10,4) NOT NULL DEFAULT 0, winner_watch_sec BIGINT NOT NULL DEFAULT 0,
      total_coins NUMERIC(10,4) NOT NULL DEFAULT 0, eligible_count INTEGER NOT NULL DEFAULT 0,
      rand_value NUMERIC(20,10) NOT NULL DEFAULT 0, draw_index INTEGER NOT NULL DEFAULT 1,
      is_test BOOLEAN NOT NULL DEFAULT FALSE, prize TEXT, eligible_snapshot JSONB,
      drawn_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pg.query(`ALTER TABLE giveaway_draws ADD COLUMN IF NOT EXISTS prize TEXT`);
  await pg.query(`CREATE INDEX IF NOT EXISTS idx_draws_session ON giveaway_draws(session_id)`);
  // Multi-tenant + multi-channel columns.
  await pg.query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS channels JSONB`);
  await pg.query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS team_id TEXT`);
  await pg.query(`CREATE INDEX IF NOT EXISTS idx_sessions_team ON sessions(team_id)`);
  await pg.query(`ALTER TABLE watchtime_events ADD COLUMN IF NOT EXISTS channel TEXT`);
  await pg.query(`ALTER TABLE watchtime_events ADD COLUMN IF NOT EXISTS team_id TEXT`);
  await pg.query(`ALTER TABLE watchtime_events DROP CONSTRAINT IF EXISTS watchtime_events_event_type_check`);
  await pg.query(`
    CREATE TABLE IF NOT EXISTS campaign_participation (
      session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE, username TEXT NOT NULL, channel TEXT NOT NULL,
      watch_sec BIGINT NOT NULL DEFAULT 0, msgs INTEGER NOT NULL DEFAULT 0, coins NUMERIC(10,4) NOT NULL DEFAULT 0,
      follows BOOLEAN NOT NULL DEFAULT FALSE, valid BOOLEAN NOT NULL DEFAULT FALSE,
      PRIMARY KEY (session_id, username, channel))`);
  await pg.query(`CREATE INDEX IF NOT EXISTS idx_cp_session ON campaign_participation(session_id)`);
  log('Schema', 'multi-tenant schema ensured');
}

async function main() {
  await redisReady();
  await pgReady();
  await ensureSchema();
  subscribeToGiveaway();
  startWatchtimeTicker();
  server.listen(CFG.port, () => log('Giveaway', `Service on port ${CFG.port}`));
}

function startWatchtimeTicker() {
  setInterval(async () => {
    try {
      const updates = await wte.tickPresentUsers();
      for (const u of updates) broadcastTeam(u.teamId, { event: 'wt_update', user: u.username, channel: u.channel, watchSec: u.watchSec, coins: u.coins });
    } catch(e) { logErr('Tick', e.message); }
  }, TICK_SEC * 1000);
  log('Tick', `Ticker started (${TICK_SEC}s)`);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
main().catch(err => { logErr('FATAL', err.message); process.exit(1); });
