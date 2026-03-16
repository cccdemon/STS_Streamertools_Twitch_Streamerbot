// ════════════════════════════════════════════════════════
// CHAOS CREW – Giveaway API Server
// Bridges Streamerbot WebSocket events → Redis
// Exposes REST endpoints for stats/history
// ════════════════════════════════════════════════════════

'use strict';

const Redis    = require('ioredis');
const WebSocket = require('ws');
const express  = require('express');

// ── Config ────────────────────────────────────────────────
const CFG = {
  sbHost:  process.env.SB_HOST  || '192.168.178.39',
  sbPort:  parseInt(process.env.SB_PORT   || '9090'),
  apiPort: parseInt(process.env.API_PORT  || '3000'),
  redis: {
    host: process.env.REDIS_HOST || 'redis',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    lazyConnect: true,
    retryStrategy: (times) => Math.min(times * 500, 5000),
  },
  reconnectDelay: 3000,
};

// ── Redis Client ──────────────────────────────────────────
const redis = new Redis(CFG.redis);

redis.on('connect', () => console.log('[Redis] Connected'));
redis.on('error',   (e) => console.error('[Redis] Error:', e.message));

async function redisReady() {
  for (let i = 0; i < 30; i++) {
    try {
      await redis.connect();
      await redis.ping();
      console.log('[Redis] Ready');
      return;
    } catch(e) {
      console.log(`[Redis] Waiting... (${i+1}/30): ${e.message}`);
      await sleep(2000);
    }
  }
  throw new Error('[Redis] Could not connect after 30 attempts');
}

// ── Redis Key Helpers ─────────────────────────────────────
// Mirrors Streamerbot GlobalVar naming where possible
// Additional API-only keys prefixed with "api:"

const K = {
  // Giveaway state (mirrors Streamerbot)
  gwOpen:    () => 'gw_open',
  gwKeyword: () => 'gw_keyword',
  gwIndex:   () => 'gw_index',
  gwUser:    (u) => `gw_u_${u}`,

  // API-only keys
  sessions:      () => 'api:sessions',          // list of session ids
  session:       (id) => `api:session:${id}`,   // session hash
  sessionUsers:  (id) => `api:session:${id}:users`, // set of usernames
  winners:       () => 'api:winners',           // list of winner JSONs
  userStats:     (u) => `api:stats:${u}`,       // user lifetime stats hash
  userStatsIndex:() => 'api:stats:index',       // set of all tracked users
  currentSession:() => 'api:current_session',   // current session id
};

// ── State ─────────────────────────────────────────────────
let currentSessionId = null;
let ws               = null;

// ── Session Management ────────────────────────────────────
async function getOrCreateSession() {
  const existing = await redis.get(K.currentSession());
  if (existing) {
    currentSessionId = existing;
    console.log(`[Redis] Resuming session ${currentSessionId}`);
    return;
  }
  currentSessionId = `sess_${Date.now()}`;
  const sessionData = {
    id:         currentSessionId,
    opened_at:  new Date().toISOString(),
    closed_at:  '',
    keyword:    '',
    winner:     '',
    winner_tickets: 0,
    total_participants: 0,
    total_tickets: 0,
  };
  await redis.hset(K.session(currentSessionId), sessionData);
  await redis.lpush(K.sessions(), currentSessionId);
  await redis.set(K.currentSession(), currentSessionId);
  console.log(`[Redis] Opened session ${currentSessionId}`);
}

async function closeSession() {
  if (!currentSessionId) return;
  await redis.hset(K.session(currentSessionId), 'closed_at', new Date().toISOString());
  await redis.del(K.currentSession());
  console.log(`[Redis] Closed session ${currentSessionId}`);
}

async function updateKeyword(keyword) {
  if (!currentSessionId) return;
  await redis.hset(K.session(currentSessionId), 'keyword', keyword || '');
}

// ── Participant Sync ──────────────────────────────────────
async function syncParticipants(msg) {
  const participants = msg.participants || [];
  const isOpen       = !!msg.open;

  if (isOpen && !currentSessionId) await getOrCreateSession();
  if (!currentSessionId) return;

  let totalParticipants = 0;
  let totalTickets      = 0;

  for (const p of participants) {
    const username = (p.key || p.display || '').toLowerCase();
    const display  = p.display  || username;
    const watchSec = parseInt(p.watchSec) || 0;
    const msgs     = parseInt(p.msgs)     || 0;
    const tickets  = parseFloat(p.tickets)  || 0;
    const banned   = p.banned ? '1' : '0';

    // Store participant in current session
    await redis.hset(`${K.session(currentSessionId)}:p:${username}`, {
      username, display, watch_sec: watchSec,
      msgs, tickets, banned,
      updated_at: new Date().toISOString()
    });
    await redis.sadd(K.sessionUsers(currentSessionId), username);

    // Update lifetime user stats
    const existing = await redis.hgetall(K.userStats(username));
    await redis.hset(K.userStats(username), {
      username,
      display,
      total_watch_sec: Math.max(parseInt(existing.total_watch_sec||0), watchSec),
      total_msgs:      Math.max(parseInt(existing.total_msgs||0),      msgs),
      total_tickets:   Math.max(parseFloat(existing.total_tickets||0),   tickets),
      times_won:       existing.times_won || 0,
      first_seen:      existing.first_seen || new Date().toISOString(),
      last_seen:       new Date().toISOString(),
    });
    await redis.sadd(K.userStatsIndex(), username);

    if (!p.banned) {
      totalParticipants++;
      totalTickets += tickets;
    }
  }

  await redis.hset(K.session(currentSessionId), {
    total_participants: totalParticipants,
    total_tickets:      totalTickets,
  });
}

async function recordWinner(winnerName, msg) {
  if (!currentSessionId) return;

  const username = winnerName.toLowerCase();
  const p = await redis.hgetall(`${K.session(currentSessionId)}:p:${username}`);
  const display  = p.display  || winnerName;
  const tickets  = parseFloat(p.tickets||0);
  const watchSec = parseInt(p.watch_sec||0);
  const msgs     = parseInt(p.msgs||0);

  const winnerEntry = JSON.stringify({
    session_id: currentSessionId,
    username,
    display,
    tickets,
    watch_sec: watchSec,
    msgs,
    won_at: new Date().toISOString(),
  });

  await redis.lpush(K.winners(), winnerEntry);

  await redis.hset(K.session(currentSessionId), {
    winner:         display,
    winner_tickets: tickets,
  });

  // Increment times_won in user stats
  await redis.hincrby(K.userStats(username), 'times_won', 1);

  console.log(`[Redis] Winner: ${display} (${tickets} tickets)`);
}

// ── Streamerbot WS Client ─────────────────────────────────
function connectToStreamerbot() {
  if (ws) { try { ws.terminate(); } catch(e){} }

  const url = `ws://${CFG.sbHost}:${CFG.sbPort}`;
  console.log(`[WS] Connecting to ${url}`);
  ws = new WebSocket(url);

  ws.on('open', () => {
    console.log('[WS] Connected');
    // Als API-Client registrieren – eigene Session damit Streamerbot uns Daten schickt
    ws.send(JSON.stringify({ event: 'gw_api_register' }));
    // Kurz warten dann Daten anfordern
    setTimeout(() => {
      ws.send(JSON.stringify({ event: 'gw_get_all' }));
    }, 500);
  });

  ws.on('message', async (data) => {
    try { await handleMessage(JSON.parse(data.toString())); }
    catch(e) { console.error('[WS] Handler error:', e.message); }
  });

  ws.on('close', () => {
    console.log('[WS] Disconnected, reconnecting...');
    setTimeout(connectToStreamerbot, CFG.reconnectDelay);
  });

  ws.on('error', (e) => console.error('[WS] Error:', e.message));
}

async function handleMessage(msg) {
  if (!msg || !msg.event) return;
  switch (msg.event) {
    case 'gw_data':
      await syncParticipants(msg);
      break;
    case 'gw_status':
      if (msg.status === 'open')   await getOrCreateSession();
      if (msg.status === 'closed') await closeSession();
      break;
    case 'gw_ack':
      if (['ticket_added','ticket_removed','banned','unbanned'].includes(msg.type)) {
        if (ws && ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ event: 'gw_get_all' }));
      }
      if (msg.type === 'reset') {
        await closeSession();
        currentSessionId = null;
      }
      if (msg.type === 'keyword_set') await updateKeyword(msg.keyword || '');
      break;
    case 'gw_overlay':
      if (msg.winner) await recordWinner(msg.winner, msg);
      break;
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

app.get('/health', (req, res) =>
  res.json({ status: 'ok', session: currentSessionId })
);

app.get('/api/participants', async (req, res) => {
  try {
    if (!currentSessionId) return res.json({ session: null, participants: [] });
    const usernames = await redis.smembers(K.sessionUsers(currentSessionId));
    const participants = [];
    for (const u of usernames) {
      const p = await redis.hgetall(`${K.session(currentSessionId)}:p:${u}`);
      if (p && p.username) participants.push({
        ...p,
        tickets:   parseFloat(p.tickets||0),
        watch_sec: parseInt(p.watch_sec||0),
        msgs:      parseInt(p.msgs||0),
        banned:    p.banned === '1',
      });
    }
    participants.sort((a,b) => b.tickets - a.tickets);
    res.json({ session: currentSessionId, participants });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/winners', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50'), 500);
    const raw   = await redis.lrange(K.winners(), 0, limit - 1);
    res.json(raw.map(r => JSON.parse(r)));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/leaderboard', async (req, res) => {
  try {
    const limit    = Math.min(parseInt(req.query.limit || '50'), 500);
    const usernames = await redis.smembers(K.userStatsIndex());
    const stats    = [];
    for (const u of usernames) {
      const s = await redis.hgetall(K.userStats(u));
      if (s && s.username) stats.push({
        ...s,
        total_watch_sec: parseInt(s.total_watch_sec||0),
        total_msgs:      parseInt(s.total_msgs||0),
        total_tickets:   parseInt(s.total_tickets||0),
        times_won:       parseInt(s.times_won||0),
      });
    }
    stats.sort((a,b) => b.total_tickets - a.total_tickets || b.total_watch_sec - a.total_watch_sec);
    res.json(stats.slice(0, limit));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/sessions', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '20'), 100);
    const ids   = await redis.lrange(K.sessions(), 0, limit - 1);
    const sessions = [];
    for (const id of ids) {
      const s = await redis.hgetall(K.session(id));
      if (s && s.id) sessions.push({
        ...s,
        total_participants: parseInt(s.total_participants||0),
        total_tickets:      parseInt(s.total_tickets||0),
        winner_tickets:     parseInt(s.winner_tickets||0),
      });
    }
    res.json(sessions);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/user/:username', async (req, res) => {
  try {
    const s = await redis.hgetall(K.userStats(req.params.username.toLowerCase()));
    if (!s || !s.username) return res.status(404).json({ error: 'Not found' });
    res.json({
      ...s,
      total_watch_sec: parseInt(s.total_watch_sec||0),
      total_msgs:      parseInt(s.total_msgs||0),
      total_tickets:   parseInt(s.total_tickets||0),
      times_won:       parseInt(s.times_won||0),
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Manual backup trigger
app.post('/api/backup', async (req, res) => {
  try {
    await redis.bgsave();
    res.json({ status: 'ok', message: 'BGSAVE triggered' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Start ─────────────────────────────────────────────────
async function main() {
  await redisReady();

  const existing = await redis.get(K.currentSession());
  if (existing) {
    currentSessionId = existing;
    console.log(`[Redis] Found open session: ${currentSessionId}`);
  }

  app.listen(CFG.apiPort, () => console.log(`[API] Listening on port ${CFG.apiPort}`));
  connectToStreamerbot();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(err => { console.error('[FATAL]', err.message); process.exit(1); });
