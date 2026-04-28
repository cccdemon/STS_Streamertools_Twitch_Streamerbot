'use strict';

// ════════════════════════════════════════════════════════
// CHAOS CREW – Bridge Service
// Connects to Streamerbot WS (9090), routes all events
// to Redis Pub/Sub channels by domain.
//
// Channels (publish):
//   ch:giveaway   – viewer_tick, chat_msg, time_cmd
//   ch:spacefight – fight_cmd, spacefight_challenge,
//                   spacefight_result, spacefight_rejected,
//                   stream_online, stream_offline
//   ch:alerts     – follow, cheer, raid, shoutout,
//                   first_chatter
//   ch:chat       – chat_msg (HUD), clip_created,
//                   ad_break_start, ad_break_end
//
// Channels (subscribe):
//   ch:chat_reply – forward outbound chat to Streamerbot
// ════════════════════════════════════════════════════════

const Redis   = require('ioredis');
const WebSocket = require('ws');
const express = require('express');

function log(tag, ...args)    { console.log( `[${tag}]`, ...args); }
function logErr(tag, ...args) { console.error(`[${tag}]`, ...args); }

const CFG = {
  sbHost:  process.env.SB_HOST  || '192.168.178.39',
  sbPort:  parseInt(process.env.SB_PORT  || '9090'),
  port:    parseInt(process.env.PORT     || '3000'),
  redis: {
    host:          process.env.REDIS_HOST || 'redis',
    port:          parseInt(process.env.REDIS_PORT || '6379'),
    db:            parseInt(process.env.REDIS_DB   || '0'),
    lazyConnect:   true,
    retryStrategy: (t) => Math.min(t * 500, 5000),
  },
  reconnectDelay: 3000,
};

// ── Redis: two clients (pub cannot subscribe) ────────────
const redisPub = new Redis(CFG.redis);
const redisSub = new Redis(CFG.redis);

redisPub.on('connect', () => log('Redis', 'Pub connected (DB ' + CFG.redis.db + ')'));
redisPub.on('error',   (e) => logErr('Redis', 'Pub error:', e.message));
redisSub.on('connect', () => log('Redis', 'Sub connected'));
redisSub.on('error',   (e) => logErr('Redis', 'Sub error:', e.message));

async function redisReady() {
  for (let i = 0; i < 30; i++) {
    try {
      await redisPub.connect();
      await redisPub.ping();
      await redisSub.connect();
      log('Redis', 'Ready');
      return;
    } catch(e) {
      log('Redis', `Waiting... (${i + 1}/30)`);
      await sleep(2000);
    }
  }
  throw new Error('Redis: Could not connect');
}

// ── Event routing table ───────────────────────────────────
// event → channel(s) to publish on
const ROUTES = {
  viewer_tick:           ['ch:giveaway'],
  chat_msg:              ['ch:giveaway', 'ch:chat'],
  time_cmd:              ['ch:giveaway'],
  fight_cmd:             ['ch:spacefight'],
  spacefight_challenge:  ['ch:spacefight'],
  spacefight_result:     ['ch:spacefight'],
  spacefight_rejected:   ['ch:spacefight'],
  stream_online:         ['ch:spacefight', 'ch:giveaway'],
  stream_offline:        ['ch:spacefight'],
  follow:                ['ch:alerts'],
  cheer:                 ['ch:alerts'],
  raid:                  ['ch:alerts'],
  shoutout:              ['ch:alerts'],
  first_chatter:         ['ch:alerts'],
  clip_created:          ['ch:chat'],
  ad_break_start:        ['ch:chat'],
  ad_break_end:          ['ch:chat'],
  cc_debug:              ['ch:giveaway'],
};

// ── Streamerbot WS Client ─────────────────────────────────
let sbWs = null;

function connectToStreamerbot() {
  if (sbWs) { try { sbWs.terminate(); } catch(e) {} }

  const url = `ws://${CFG.sbHost}:${CFG.sbPort}`;
  log('SB', 'Connecting to', url);
  sbWs = new WebSocket(url);

  sbWs.on('open', () => {
    log('SB', 'Connected');
    sbWs.send(JSON.stringify({ event: 'cc_api_register' }));
  });

  sbWs.on('message', async (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (!msg || !msg.event) return;

    const channels = ROUTES[msg.event];
    if (!channels) {
      log('SB', `← ${msg.event} (unrouted)`);
      return;
    }

    log('SB', `← ${msg.event} → [${channels.join(', ')}]`);
    const payload = JSON.stringify(msg);
    for (const ch of channels) {
      redisPub.publish(ch, payload).catch(e => logErr('Pub', ch, e.message));
    }
  });

  sbWs.on('close', () => {
    log('SB', `Disconnected, reconnecting in ${CFG.reconnectDelay}ms`);
    setTimeout(connectToStreamerbot, CFG.reconnectDelay);
  });

  sbWs.on('error', (e) => logErr('SB', e.message));
}

function sbSend(obj) {
  if (sbWs && sbWs.readyState === WebSocket.OPEN)
    sbWs.send(JSON.stringify(obj));
}

// ── Subscribe ch:chat_reply → forward to Streamerbot ─────
function subscribeToReplies() {
  redisSub.subscribe('ch:chat_reply', (err) => {
    if (err) { logErr('Sub', 'chat_reply:', err.message); return; }
    log('Sub', 'Subscribed to ch:chat_reply');
  });

  redisSub.on('message', (channel, payload) => {
    if (channel !== 'ch:chat_reply') return;
    try {
      const msg = JSON.parse(payload);
      sbSend(msg);
      log('SB', `→ chat_reply: ${msg.message?.substring(0, 60) || '?'}`);
    } catch(e) {
      logErr('Sub', 'Bad chat_reply payload:', e.message);
    }
  });
}

// ── Health endpoint ───────────────────────────────────────
const app = express();

app.get('/health', async (req, res) => {
  try {
    await redisPub.ping();
    const sbStatus = sbWs && sbWs.readyState === WebSocket.OPEN ? 'connected' : 'disconnected';
    res.json({ status: 'ok', redis: 'ok', streamerbot: sbStatus });
  } catch(e) {
    res.status(503).json({ status: 'error', error: e.message });
  }
});

// ── Start ─────────────────────────────────────────────────
async function main() {
  await redisReady();
  subscribeToReplies();
  connectToStreamerbot();
  app.listen(CFG.port, () => log('Bridge', `Health on port ${CFG.port}`));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
main().catch(err => { logErr('FATAL', err.message); process.exit(1); });
