'use strict';

// ════════════════════════════════════════════════════════
// Session-Log – reine Logik, ohne Redis und ohne HTTP.
//
// Live-Alerts laufen von Streamerbot direkt in overlay.html; der Server
// sieht sie nie. Damit die Szenen-Rahmen (gamescenes/scene.html) "Zuletzt"
// und die Credits zeigen koennen, meldet overlay.html jedes echte Ereignis
// an POST /api/session/event. Hier wird es geprueft und zusammengefasst.
// ════════════════════════════════════════════════════════

const TYPES = new Set(['follow', 'cheer', 'sub', 'resub', 'subgift', 'subbomb', 'raid']);
const MAX_EVENTS = 500;

function cleanName(s) {
  return String(s == null ? '' : s).replace(/[^\w\- .äöüÄÖÜß]/g, '').trim().slice(0, 40);
}

// Rohdaten aus dem Request -> gespeichertes Ereignis, oder null wenn unbrauchbar.
function normalizeEvent(body, now = Date.now()) {
  const b = body || {};
  const type = String(b.type || '').toLowerCase();
  if (!TYPES.has(type)) return null;
  const user = cleanName(b.user);
  if (!user) return null;
  const amount = Math.max(0, Math.min(1e7, parseInt(b.amount, 10) || 0));
  return { type, user, amount, ts: now };
}

function pushUnique(list, name) {
  if (!list.some((n) => n.toLowerCase() === name.toLowerCase())) list.push(name);
}

function addAmount(list, user, amount) {
  const hit = list.find((e) => e.user.toLowerCase() === user.toLowerCase());
  if (hit) hit.amount += amount;
  else list.push({ user, amount });
}

// Ereignisliste (aelteste zuerst) -> { latest, credits } fuer die Rahmen.
function summarize(events) {
  const latest = { follow: null, sub: null, cheer: null, raid: null };
  const credits = { follow: [], sub: [], gift: [], cheer: [], raid: [] };
  for (const e of events || []) {
    if (!e || !TYPES.has(e.type) || !e.user) continue;
    const amount = Number(e.amount) || 0;
    switch (e.type) {
      case 'follow':
        latest.follow = { user: e.user };
        pushUnique(credits.follow, e.user);
        break;
      case 'sub':
      case 'resub':
        latest.sub = { user: e.user };
        pushUnique(credits.sub, e.user);
        break;
      case 'subgift':
      case 'subbomb':
        latest.sub = { user: e.user };
        addAmount(credits.gift, e.user, amount || 1);
        break;
      case 'cheer':
        latest.cheer = { user: e.user, amount };
        addAmount(credits.cheer, e.user, amount);
        break;
      case 'raid':
        latest.raid = { user: e.user, amount };
        addAmount(credits.raid, e.user, amount);
        break;
    }
  }
  return { latest, credits };
}

module.exports = { TYPES, MAX_EVENTS, normalizeEvent, summarize };
