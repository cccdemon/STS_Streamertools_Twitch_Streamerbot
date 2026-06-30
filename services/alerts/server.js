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
  giveawayUrl:   process.env.GIVEAWAY_URL   || 'http://giveaway:3001',
  spacefightUrl: process.env.SPACEFIGHT_URL || 'http://spacefight:3002',
};

const { buildProfile } = require('./profile.js');

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
      return;
    }
    // Admin test console injects a synthetic alert → fan out to overlays.
    if (msg.event === 'cc_test') { injectTestAlert(msg); return; }
  });

  ws.on('close', () => {
    clients.delete(clientId);
    log('WS', `Disconnected: ${clientId} – ${clients.size} remaining`);
  });
});

// ── Admin test injection ─────────────────────────────────
// The admin "Alert Test" console sends { event:'cc_test', alertType, ... }.
// We sanitize and broadcast a flat, _test-flagged alert that the redesign
// overlay (overlay.html) picks up on its admin WS channel.
const TEST_ALERT_TYPES = new Set([
  'follow', 'sub', 'resub', 'bits', 'cheer', 'subgift', 'subbomb', 'giftbomb',
  'raid', 'outraid', 'hypetrain', 'streamstart', 'alert', 'redeem', 'shoutout',
  'profile',
]);
async function injectTestAlert(msg) {
  const type = sanitizeStr(msg.alertType || '', 20).toLowerCase();
  if (!TEST_ALERT_TYPES.has(type)) { log('Test', `rejected alertType: ${type}`); return; }

  // Profil-Test: echte Aggregation für den angegebenen User, als _test broadcasten.
  if (type === 'profile') {
    try {
      const login = sanitizeStr(msg.user || '', 40) || 'tester';
      const p = await aggregateProfile(login, {
        display: sanitizeStr(msg.user || login, 40),
        avatar: sanitizeStr(msg.avatar || '', 300),
      });
      broadcastAll(Object.assign({ _test: true }, p));
      log('Test', `inject profile ← ${login}`);
    } catch (e) { logErr('Test', 'profile:', e.message); }
    return;
  }
  const out = {
    alertType: type,
    _test:  true,
    user:   sanitizeStr(msg.user   || '', 40),
    recipient: sanitizeStr(msg.recipient || '', 40),
    amount: parseInt(msg.amount, 10) || 0,
    tier:   sanitizeStr(msg.tier   || '', 6),
    months: parseInt(msg.months, 10) || 0,
    level:  parseInt(msg.level,  10) || 0,
    reward: sanitizeStr(msg.reward || '', 80),
    game:   sanitizeStr(msg.game   || '', 60),
    avatar: sanitizeStr(msg.avatar || '', 300),
  };
  broadcastAll(out);
  log('Test', `inject ${type} ← ${out.user || '?'}`);
}

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
      // Hinweis: follow/cheer/raid/sub/shoutout laufen NICHT mehr über diesen
      // Pfad. Die CC-Alert-Actions senden direkt an die Overlay-WS-Session
      // (cc_alert_session) in Streamerbot → overlay.html. Hier bleibt nur
      // first_chatter (kommt über die Bridge und löst eine Chat-Antwort aus).
      switch (msg.event) {
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

// ── Twitch-User-Cache (lokale Avatare, weniger Helix-/CDN-Traffic) ──
// Helix wird pro User nur alle TW_FRESH_TTL Sekunden befragt; das Bild wird
// nur neu heruntergeladen, wenn sich die Twitch-URL geändert hat. Avatare
// liegen unter public/avatars/ und werden lokal als /alerts/avatars/<file>
// ausgeliefert → das Overlay holt sie vom eigenen Server, nicht von Twitch.
const fs   = require('fs');
const path = require('path');
const AVATAR_DIR  = path.join('public', 'avatars');
const TW_FRESH_TTL = 43200;   // 12h
try { fs.mkdirSync(AVATAR_DIR, { recursive: true }); } catch (e) { logErr('Avatar', 'mkdir:', e.message); }

function avatarExt(url) {
  const m = /\.(png|jpe?g|gif|webp)(?:$|\?)/i.exec(url || '');
  return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'png';
}
function avatarLocalUrl(rec) {
  // Relative URL (kein /alerts-Prefix): löst sowohl direkt (:3003 → /avatars/x)
  // als auch via Caddy (/alerts/overlay.html → /alerts/avatars/x) korrekt auf.
  return (rec && rec.file && fs.existsSync(path.join(AVATAR_DIR, rec.file)))
    ? `avatars/${rec.file}` : '';
}
async function downloadAvatar(login, url) {
  const file = `${login}.${avatarExt(url)}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error('download ' + r.status);
  await fs.promises.writeFile(path.join(AVATAR_DIR, file), Buffer.from(await r.arrayBuffer()));
  return file;
}

// Roher Helix-Call (kein Cache)
async function fetchTwitchRaw(login) {
  const token = await getTwitchToken();
  if (!token) return null;
  const r = await fetch(`https://api.twitch.tv/helix/users?login=${login}`, {
    headers: { 'Client-Id': process.env.TWITCH_CLIENT_ID, 'Authorization': `Bearer ${token}` },
    signal: AbortSignal.timeout(3000),
  });
  if (!r.ok) return null;
  const j = await r.json();
  return j.data?.[0] || null;
}

// Gecachter Lookup → { login, display, avatar(lokale URL), description } | null
async function getCachedTwitchUser(login) {
  const u = sanitizeUsername(login);
  if (!u) return null;
  const key = `tw:user:${u}`;

  let rec = null;
  try { const s = await redis.get(key); if (s) rec = JSON.parse(s); } catch (e) {}
  const fresh = await redis.get(`tw:fresh:${u}`);

  // frisch + lokales Bild vorhanden → KEIN Helix-Call
  if (rec && fresh && avatarLocalUrl(rec)) {
    return { login: u, display: rec.display || u, avatar: avatarLocalUrl(rec), description: rec.description || '' };
  }

  const tw = await fetchTwitchRaw(u).catch((e) => { logErr('Twitch', 'helix:', e.message); return null; });
  if (!tw) {
    // Helix down → notfalls alten (stale) Datensatz nutzen
    return rec ? { login: u, display: rec.display || u, avatar: avatarLocalUrl(rec), description: rec.description || '' } : null;
  }

  // Bild nur laden, wenn URL geändert oder Datei fehlt
  let file = rec && rec.file;
  if (!rec || rec.twUrl !== tw.profile_image_url || !avatarLocalUrl(rec)) {
    try { file = await downloadAvatar(u, tw.profile_image_url); }
    catch (e) { logErr('Avatar', 'dl:', e.message); }
  }

  const newRec = { twUrl: tw.profile_image_url, file, display: tw.display_name, description: tw.description };
  try { await redis.set(key, JSON.stringify(newRec)); } catch (e) {}
  try { await redis.set(`tw:fresh:${u}`, '1', 'EX', TW_FRESH_TTL); } catch (e) {}

  // lokale URL bevorzugen, sonst (Download fehlgeschlagen) Twitch-URL direkt
  return {
    login: u, display: tw.display_name, description: tw.description,
    avatar: avatarLocalUrl(newRec) || tw.profile_image_url,
  };
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
    const login = sanitizeUsername(req.params.login);
    if (!login) return res.status(400).json({ error: 'invalid login' });
    const tu = await getCachedTwitchUser(login);   // lokaler Avatar-Cache, Helix nur alle 12h
    if (!tu) return res.status(404).json({ error: 'user not found / twitch creds' });
    // profile_image_url = lokale URL (/alerts/avatars/<file>), spart Twitch-CDN
    res.json({ login: tu.login, display_name: tu.display, profile_image_url: tu.avatar, description: tu.description });
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

// ── Profil / Steckbrief (!id) ─────────────────────────────
// Reichert die von Streamerbot gelieferten Twitch-/Hauling-Felder mit
// Watchtime + Giveaway- + Spacefight-Daten aus den anderen Services an
// und baut das fertige Overlay-Payload (alertType:'profile').
async function aggregateProfile(login, extras = {}) {
  const u = sanitizeUsername(login);
  if (!u) throw new Error('invalid login');

  let watchSec = 0, giveawayWins = 0, msgs = 0, sfWins = 0, sfLosses = 0;

  try {
    const r = await fetch(`${CFG.giveawayUrl}/api/user/${u}`, { signal: AbortSignal.timeout(3000) });
    if (r.ok) {
      const j = await r.json();
      const lt = j.lifetime || {};
      watchSec     = parseInt(lt.total_watch_sec || 0, 10) + parseInt(j.watchSec || 0, 10);
      giveawayWins = parseInt(lt.times_won || 0, 10);
      msgs         = parseInt(lt.total_msgs || 0, 10) + parseInt(j.msgs || 0, 10);
    }
  } catch (e) { logErr('Profile', 'giveaway lookup:', e.message); }

  try {
    const r = await fetch(`${CFG.spacefightUrl}/api/spacefight/player/${u}`, { signal: AbortSignal.timeout(3000) });
    if (r.ok) {
      const j = await r.json();
      const s = j.stats || j;
      sfWins   = parseInt(s.wins   || 0, 10);
      sfLosses = parseInt(s.losses || 0, 10);
    }
  } catch (e) { logErr('Profile', 'spacefight lookup:', e.message); }

  const coins = Math.round((watchSec / 7200) * 100) / 100;   // 2h = 1 Coin

  // Avatar/Display via Twitch nachladen, falls Streamerbot keins lieferte
  let avatar = extras.avatar || '';
  let display = extras.display || u;
  if (!avatar) {
    const tu = await getCachedTwitchUser(u);
    if (tu) { avatar = tu.avatar || ''; if (!extras.display && tu.display) display = tu.display; }
  }

  return buildProfile({
    login: u,
    display,
    avatar,
    followageDays: extras.followageDays,
    isSub: extras.isSub,
    subTier: extras.subTier,
    subMonths: extras.subMonths,
    bitsTotal: extras.bitsTotal,
    haulPoints: extras.haulPoints,
    haulRank: extras.haulRank,
    watchSec, coins, giveawayWins, msgs, sfWins, sfLosses,
  });
}

app.post('/api/profile', async (req, res) => {
  try {
    const b = req.body || {};
    const login = sanitizeStr(b.login || b.user || '', 40);
    if (!login) return res.status(400).json({ error: 'login required' });
    const payload = await aggregateProfile(login, {
      display:       sanitizeStr(b.display || b.user || '', 40),
      avatar:        sanitizeStr(b.avatar || '', 300),
      followageDays: parseInt(b.followageDays, 10) || 0,
      isSub:         !!b.isSub,
      subTier:       sanitizeStr(b.subTier || '1000', 6),
      subMonths:     parseInt(b.subMonths, 10) || 0,
      bitsTotal:     parseInt(b.bitsTotal, 10) || 0,
      haulPoints:    parseInt(b.haulPoints, 10) || 0,
      haulRank:      sanitizeStr(b.haulRank || '', 40),
    });
    res.json(payload);
  } catch (e) { res.status(500).json({ error: e.message }); }
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
