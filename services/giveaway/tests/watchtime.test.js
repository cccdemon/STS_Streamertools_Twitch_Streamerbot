'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const {
  WatchtimeEngine, coinsFromSec, countWords, sanitizeStr, sanitizeUsername,
  CHAT_BONUS_SEC, SECS_PER_COIN,
} = require('../watchtime.js');

// ── In-memory redis/pg mocks (no external deps) ───────────
function makeRedis() {
  const store = new Map(), sets = new Map();
  const api = {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async set(k, v) { store.set(k, String(v)); return 'OK'; },
    async del(...ks) { ks.flat().forEach(k => { store.delete(k); sets.delete(k); }); return 1; },
    async incr(k) { const n = (parseFloat(store.get(k)) || 0) + 1; store.set(k, String(n)); return n; },
    async incrbyfloat(k, by) { const n = (parseFloat(store.get(k)) || 0) + Number(by); store.set(k, String(n)); return String(n); },
    async sadd(k, ...m) { if (!sets.has(k)) sets.set(k, new Set()); m.flat().forEach(x => sets.get(k).add(x)); return 1; },
    async smembers(k) { return sets.has(k) ? [...sets.get(k)] : []; },
    async ttl(k) { return store.has(k) ? 100 : -2; },
    pipeline() {
      const ops = [];
      const p = {
        del: (...a) => { ops.push(() => api.del(...a)); return p; },
        set: (...a) => { ops.push(() => api.set(...a)); return p; },
        async exec() { for (const o of ops) await o(); return []; },
      };
      return p;
    },
  };
  return api;
}
function makePg() {
  return {
    async query() { return { rows: [{ n: 0 }], rowCount: 1 }; },
    async connect() {
      return {
        async query(sql) {
          if (/RETURNING id/.test(sql)) return { rows: [{ id: 1 }] };
          if (/COUNT/.test(sql)) return { rows: [{ n: 0 }] };
          if (/SELECT winner/.test(sql)) return { rows: [{}] };
          return { rows: [], rowCount: 1 };
        },
        release() {},
      };
    },
  };
}
function engine() { return new WatchtimeEngine(makeRedis(), makePg()); }

// ── Pure helpers ──────────────────────────────────────────
test('coinsFromSec: 7200s = 1 coin', () => {
  assert.equal(coinsFromSec(SECS_PER_COIN), 1);
  assert.equal(coinsFromSec(3600), 0.5);
});
test('countWords', () => {
  assert.equal(countWords('one two three four'), 4);
  assert.equal(countWords('  spaced   out  '), 2);
});
test('sanitizeUsername / sanitizeStr', () => {
  assert.equal(sanitizeUsername('Bob_X!!'), 'bob_x');
  assert.equal(sanitizeStr('<b>hi"there</b>'), 'bhithere/b');
});

// ── Chat bonus + follow gate ──────────────────────────────
test('chat bonus adds 0.5s when following + >3 words', async () => {
  const e = engine();
  await e.redis.set('gw_open', 'true');
  const r = await e.handleChatMessage('justcallmedeimos', 'bob', 'this is a message', 'sess_1', true);
  assert.equal(r.added, CHAT_BONUS_SEC);
  assert.equal(r.channel, 'justcallmedeimos');
});
test('chat bonus blocked when not following', async () => {
  const e = engine();
  await e.redis.set('gw_open', 'true');
  const r = await e.handleChatMessage('justcallmedeimos', 'bob', 'this is a message', 'sess_1', false);
  assert.equal(r.followed, false);
  assert.equal(r.added, undefined);
});
test('short message (<4 words) gives no bonus', async () => {
  const e = engine();
  await e.redis.set('gw_open', 'true');
  const r = await e.handleChatMessage('justcallmedeimos', 'bob', 'too short', 'sess_1', true);
  assert.equal(r, null);
});

// ── Multiplier ────────────────────────────────────────────
test('multiplier doubles chat bonus', async () => {
  const e = engine();
  await e.redis.set('gw_open', 'true');
  await e.setMultiplier(2, 900);
  assert.equal(await e.getMultiplier(), 2);
  const r = await e.handleChatMessage('justcallmedeimos', 'bob', 'this is a message', 'sess_1', true);
  assert.equal(r.added, CHAT_BONUS_SEC * 2);
});
test('setMultiplier clamps + removes at factor 1', async () => {
  const e = engine();
  await e.setMultiplier(99, 60);        // clamp to 10
  assert.equal(await e.getMultiplier(), 10);
  await e.setMultiplier(1, 60);         // → removed
  assert.equal(await e.getMultiplier(), 1);
});

// ── Opt-in threshold ──────────────────────────────────────
test('keyword opt-in requires >=1 coin', async () => {
  const e = engine();
  await e.redis.set('gw_open', 'true');
  await e.redis.set('gw_keyword', 'join');
  let r = await e.handleChatMessage('justcallmedeimos', 'bob', 'join', 'sess_1', true);
  assert.equal(r.registered, false);
  assert.equal(r.needCoins, 1);

  // give bob 1 coin on the channel, then opt-in succeeds
  await e.redis.set('gw:ch:justcallmedeimos:watch:bob', String(SECS_PER_COIN));
  r = await e.handleChatMessage('justcallmedeimos', 'bob', 'join', 'sess_1', true);
  assert.equal(r.registered, true);
});

// ── Eligibility: >=2 channels ─────────────────────────────
test('eligible only with valid coins on >=2 channels + registered', async () => {
  const e = engine();
  await e.redis.set('gw:channels', JSON.stringify(['justcallmedeimos', 'jerichoramirez', 'x_jazzz_x']));
  // 1 channel only
  await e.redis.set('gw:ch:justcallmedeimos:watch:bob', String(SECS_PER_COIN));
  await e.redis.set('gw:ch:justcallmedeimos:follows:bob', '1');
  await e.redis.set('gw:registered:bob', '1');
  let a = await e.getUserAggregate('bob');
  assert.equal(a.channelsQualified, 1);
  assert.equal(a.eligible, false);
  // add 2nd channel
  await e.redis.set('gw:ch:jerichoramirez:watch:bob', String(SECS_PER_COIN));
  await e.redis.set('gw:ch:jerichoramirez:follows:bob', '1');
  a = await e.getUserAggregate('bob');
  assert.equal(a.channelsQualified, 2);
  assert.equal(a.totalCoins, 2);
  assert.equal(a.eligible, true);
});

// ── Draw only picks eligible ──────────────────────────────
test('drawWinner ignores non-eligible', async () => {
  const e = engine();
  await e.redis.set('gw:channels', JSON.stringify(['justcallmedeimos', 'jerichoramirez']));
  // eligible alice (2 channels, registered)
  for (const ch of ['justcallmedeimos', 'jerichoramirez']) {
    await e.redis.set('gw:ch:' + ch + ':watch:alice', String(SECS_PER_COIN));
    await e.redis.set('gw:ch:' + ch + ':follows:alice', '1');
  }
  await e.redis.set('gw:registered:alice', '1');
  await e.redis.sadd('gw:users', 'alice');
  // non-eligible bob (1 channel)
  await e.redis.set('gw:ch:justcallmedeimos:watch:bob', String(SECS_PER_COIN));
  await e.redis.set('gw:ch:justcallmedeimos:follows:bob', '1');
  await e.redis.set('gw:registered:bob', '1');
  await e.redis.sadd('gw:users', 'bob');

  const r = await e.drawWinner('sess_1', {});
  assert.equal(r.winner, 'alice');
  assert.equal(r.eligibleCount, 1);
});
