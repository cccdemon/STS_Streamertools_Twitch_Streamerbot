'use strict';

// ════════════════════════════════════════════════════════
// CHAOS CREW – Stats Service
// Read-only aggregation of giveaway + spacefight data.
// No Redis, no WS – pure REST from PostgreSQL.
//
// REST:
//   GET /api/sessions
//   GET /api/leaderboard
//   GET /api/spacefight/leaderboard
//   GET /api/spacefight/history
//   GET /api/spacefight/player/:username
// ════════════════════════════════════════════════════════

const express = require('express');
const { Pool } = require('pg');

function log(tag, ...args)    { console.log( `[${tag}]`, ...args); }
function logErr(tag, ...args) { console.error(`[${tag}]`, ...args); }

function sanitizeUsername(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 25);
}

const CFG = {
  port: parseInt(process.env.PORT || '3004'),
  pg: {
    host:     process.env.PG_HOST     || 'postgres',
    port:     parseInt(process.env.PG_PORT || '5432'),
    database: process.env.PG_DB       || 'chaoscrew',
    user:     process.env.PG_USER     || 'chaoscrew',
    password: process.env.PG_PASSWORD || 'changeme',
    max: 5,
    idleTimeoutMillis: 30000,
  },
};

const pg = new Pool(CFG.pg);
pg.on('error', (e) => logErr('PG', e.message));

async function pgReady() {
  for (let i = 0; i < 30; i++) {
    try { const c = await pg.connect(); c.release(); log('PG', 'Ready'); return; }
    catch(e) { log('PG', `Waiting... (${i + 1}/30): ${e.message}`); await sleep(2000); }
  }
  throw new Error('PG: Could not connect');
}

// ── REST ──────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

app.get('/health', async (req, res) => {
  try {
    await pg.query('SELECT 1');
    res.json({ status: 'ok', service: 'stats', pg: 'ok' });
  } catch(e) {
    res.status(503).json({ status: 'error', error: e.message });
  }
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
    const rankResult = await pg.query(
      `SELECT COUNT(*)+1 AS rank FROM spacefight_stats WHERE wins > (SELECT wins FROM spacefight_stats WHERE username=$1)`,
      [u]
    );
    res.json({ ...result.rows[0], rank: parseInt(rankResult.rows[0]?.rank) || null });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Serve static web files
app.use(express.static('public'));

// ── Start ─────────────────────────────────────────────────
async function main() {
  await pgReady();
  app.listen(CFG.port, () => log('Stats', `Service on port ${CFG.port}`));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
main().catch(err => { logErr('FATAL', err.message); process.exit(1); });
