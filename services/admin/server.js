'use strict';

// ════════════════════════════════════════════════════════
// CHAOS CREW – Admin Dashboard Service
// Serves static admin pages (index, test console, docs,
// test runner). Aggregated health check across all services.
// No WS server – admin pages connect directly to each
// service via Caddy path-based routing.
// ════════════════════════════════════════════════════════

const express = require('express');

function log(tag, ...args)    { console.log( `[${tag}]`, ...args); }
function logErr(tag, ...args) { console.error(`[${tag}]`, ...args); }

const CFG = {
  port: parseInt(process.env.PORT || '3005'),
  services: {
    bridge:     process.env.BRIDGE_URL     || 'http://bridge:3000',
    giveaway:   process.env.GIVEAWAY_URL   || 'http://giveaway:3001',
    spacefight: process.env.SPACEFIGHT_URL || 'http://spacefight:3002',
    alerts:     process.env.ALERTS_URL     || 'http://alerts:3003',
    stats:      process.env.STATS_URL      || 'http://stats:3004',
    gamescenes: process.env.GAMESCENES_URL || 'http://gamescenes:3006',
  },
};

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// ── Aggregated health check ───────────────────────────────
app.get('/health', async (req, res) => {
  const results = {};
  let allOk = true;

  await Promise.all(Object.entries(CFG.services).map(async ([name, url]) => {
    try {
      const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
      const body = await r.json().catch(() => ({}));
      results[name] = r.ok ? 'ok' : `error (${r.status})`;
      if (!r.ok) allOk = false;
    } catch(e) {
      results[name] = `unreachable: ${e.message}`;
      allOk = false;
    }
  }));

  res.status(allOk ? 200 : 503).json({ status: allOk ? 'ok' : 'degraded', services: results });
});

// Serve static admin pages
app.use(express.static('public'));

// Fallback: any unmatched path → index.html (SPA-style)
app.get('*', (req, res) => {
  res.sendFile('index.html', { root: 'public' });
});

app.listen(CFG.port, () => log('Admin', `Dashboard on port ${CFG.port}`));
