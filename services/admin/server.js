'use strict';

// ════════════════════════════════════════════════════════
// TEAM GIVEAWAY – Admin Service
// Login + user management (PostgreSQL + signed-cookie sessions),
// aggregated health, static admin pages.
//
// Auth model: Caddy `forward_auth` → GET /auth/verify. Valid session
// cookie → 200; else 302 → login. Browser auth endpoints are reached
// via /admin/auth/* (Caddy strips /admin). User-management API under
// /api/users re-verifies the cookie in-process (role: superadmin).
// ════════════════════════════════════════════════════════

const express = require('express');
const { Pool } = require('pg');
const A = require('./auth.js');

function log(tag, ...args)    { console.log( `[${tag}]`, ...args); }
function logErr(tag, ...args) { console.error(`[${tag}]`, ...args); }

const CFG = {
  port: parseInt(process.env.PORT || '3005'),
  services: {
    bridge:   process.env.BRIDGE_URL   || 'http://bridge:3000',
    giveaway: process.env.GIVEAWAY_URL || 'http://giveaway:3001',
  },
  pg: {
    host:     process.env.PG_HOST     || 'postgres',
    port:     parseInt(process.env.PG_PORT || '5432'),
    database: process.env.PG_DB       || 'chaoscrew',
    user:     process.env.PG_USER     || 'chaoscrew',
    password: process.env.PG_PASSWORD || 'changeme',
    max: 5,
    idleTimeoutMillis: 30000,
  },
  sessionSecret:  process.env.SESSION_SECRET || '',
  cookieSecure:   process.env.COOKIE_SECURE !== 'false',
  bootstrapUser:  process.env.ADMIN_BOOTSTRAP_USER || 'admin',
  bootstrapPass:  process.env.ADMIN_BOOTSTRAP_PASS || '',
  loginPath:      '/admin/login.html',
};

if (!CFG.sessionSecret) {
  CFG.sessionSecret = require('crypto').randomBytes(32).toString('hex');
  logErr('Auth', 'SESSION_SECRET not set — using a random secret; sessions drop on restart. Set SESSION_SECRET in .env.');
}

const pg = new Pool(CFG.pg);
pg.on('error', (e) => logErr('PG', e.message));

const app = express();
app.use(express.json());

// ── Session helper ────────────────────────────────────────
function sessionFromReq(req) {
  const cookies = A.parseCookies(req.headers.cookie);
  return A.verifyToken(cookies[A.COOKIE_NAME], CFG.sessionSecret);
}

// ── Auth routes ───────────────────────────────────────────
// forward_auth target. 200 (+identity headers) if valid, else 302 → login.
app.get('/auth/verify', (req, res) => {
  const sess = sessionFromReq(req);
  if (!sess) return res.redirect(302, CFG.loginPath);
  res.set('X-Auth-User', sess.user);
  res.set('X-Auth-Role', sess.role);
  res.status(200).end();
});

app.get('/auth/me', (req, res) => {
  const sess = sessionFromReq(req);
  if (!sess) return res.status(401).json({ error: 'unauthenticated' });
  res.json({ user: sess.user, role: sess.role });
});

app.post('/auth/login', async (req, res) => {
  const user = A.sanitizeUserName(req.body && req.body.username);
  const pass = req.body && req.body.password;
  if (!user || !pass) return res.status(400).json({ error: 'missing_credentials' });
  try {
    const r = await pg.query('SELECT username, password_hash, role FROM admin_users WHERE username=$1', [user]);
    const row = r.rows[0];
    const ok = row && await A.verifyPassword(pass, row.password_hash);
    if (!ok) return res.status(401).json({ error: 'invalid_credentials' });
    await pg.query('UPDATE admin_users SET last_login=NOW() WHERE username=$1', [user]);
    const token = A.signToken({ user: row.username, role: row.role }, CFG.sessionSecret);
    res.set('Set-Cookie', A.serializeSessionCookie(token, { secure: CFG.cookieSecure }));
    res.json({ ok: true, user: row.username, role: row.role });
  } catch (e) {
    logErr('Auth', 'login:', e.message);
    res.status(500).json({ error: 'server_error' });
  }
});

app.post('/auth/logout', (req, res) => {
  res.set('Set-Cookie', A.clearSessionCookie({ secure: CFG.cookieSecure }));
  res.json({ ok: true });
});

// ── User management (superadmin only) ─────────────────────
function requireSuperadmin(req, res) {
  const sess = sessionFromReq(req);
  if (!sess) { res.status(401).json({ error: 'unauthenticated' }); return null; }
  if (sess.role !== 'superadmin') { res.status(403).json({ error: 'forbidden' }); return null; }
  return sess;
}

app.get('/api/users', async (req, res) => {
  if (!requireSuperadmin(req, res)) return;
  try {
    const r = await pg.query('SELECT username, role, created_at, last_login FROM admin_users ORDER BY username');
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/users', async (req, res) => {
  if (!requireSuperadmin(req, res)) return;
  const user = A.sanitizeUserName(req.body && req.body.username);
  const pass = req.body && req.body.password;
  const role = A.sanitizeRole(req.body && req.body.role);
  if (!user || !pass || String(pass).length < 8) {
    return res.status(400).json({ error: 'username_and_password_min8_required' });
  }
  try {
    const hash = await A.hashPassword(pass);
    await pg.query(`
      INSERT INTO admin_users (username, password_hash, role)
      VALUES ($1,$2,$3)
      ON CONFLICT (username) DO UPDATE SET password_hash=EXCLUDED.password_hash, role=EXCLUDED.role
    `, [user, hash, role]);
    res.json({ ok: true, user, role });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/users/:username', async (req, res) => {
  const sess = requireSuperadmin(req, res);
  if (!sess) return;
  const target = A.sanitizeUserName(req.params.username);
  if (target === sess.user) return res.status(400).json({ error: 'cannot_delete_self' });
  try {
    const cnt = await pg.query(`SELECT COUNT(*)::int AS n FROM admin_users WHERE role='superadmin'`);
    const t   = await pg.query('SELECT role FROM admin_users WHERE username=$1', [target]);
    if (t.rows[0]?.role === 'superadmin' && cnt.rows[0].n <= 1) {
      return res.status(400).json({ error: 'cannot_delete_last_superadmin' });
    }
    await pg.query('DELETE FROM admin_users WHERE username=$1', [target]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Aggregated health (public) ────────────────────────────
app.get('/health', async (req, res) => {
  const results = {};
  let allOk = true;
  await Promise.all(Object.entries(CFG.services).map(async ([name, url]) => {
    try {
      const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
      results[name] = r.ok ? 'ok' : `error (${r.status})`;
      if (!r.ok) allOk = false;
    } catch(e) {
      results[name] = `unreachable: ${e.message}`;
      allOk = false;
    }
  }));
  res.status(allOk ? 200 : 503).json({ status: allOk ? 'ok' : 'degraded', services: results });
});

// ── Static admin pages ────────────────────────────────────
app.use(express.static('public'));
app.get('*', (req, res) => res.sendFile('index.html', { root: 'public' }));

// ── Schema + bootstrap ────────────────────────────────────
async function ensureSchema() {
  await pg.query(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id            BIGSERIAL PRIMARY KEY,
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'admin',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login    TIMESTAMPTZ
    )`);
  const { rows } = await pg.query('SELECT COUNT(*)::int AS n FROM admin_users');
  if (rows[0].n === 0) {
    let pass = CFG.bootstrapPass;
    if (!pass) {
      pass = require('crypto').randomBytes(9).toString('base64url');
      log('Auth', `No admin users + no ADMIN_BOOTSTRAP_PASS — created superadmin "${CFG.bootstrapUser}" with password: ${pass}`);
    }
    const hash = await A.hashPassword(pass);
    await pg.query(
      `INSERT INTO admin_users (username, password_hash, role) VALUES ($1,$2,'superadmin')`,
      [A.sanitizeUserName(CFG.bootstrapUser), hash]
    );
    log('Auth', `Bootstrap superadmin "${CFG.bootstrapUser}" created`);
  }
}

async function pgReady() {
  for (let i = 0; i < 30; i++) {
    try { const c = await pg.connect(); c.release(); return; }
    catch(e) { log('PG', `Waiting... (${i + 1}/30)`); await new Promise(r => setTimeout(r, 2000)); }
  }
  throw new Error('PG: could not connect');
}

async function main() {
  await pgReady();
  await ensureSchema();
  app.listen(CFG.port, () => log('Admin', `Service on port ${CFG.port}`));
}
main().catch(e => { logErr('FATAL', e.message); process.exit(1); });
