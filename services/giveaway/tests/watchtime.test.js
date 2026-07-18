'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const {
  WatchtimeEngine, K, coinsFromSec, countWords, sanitizeStr, sanitizeUsername,
  CHAT_BONUS_SEC, SECS_PER_COIN,
} = require('../watchtime.js');

const TEAM = 'team_test';
const CH = ['justcallmedeimos', 'jerichoramirez', 'x_jazzz_x'];

// ── In-memory redis/pg mocks ──────────────────────────────
function makeRedis() {
  const store = new Map(), sets = new Map();
  const api = {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async set(k, v) { store.set(k, String(v)); return 'OK'; },
    async del(...ks) { ks.flat().forEach(k => { store.delete(k); sets.delete(k); }); return 1; },
    async incr(k) { const n = (parseFloat(store.get(k)) || 0) + 1; store.set(k, String(n)); return n; },
    async incrbyfloat(k, by) { const n = (parseFloat(store.get(k)) || 0) + Number(by); store.set(k, String(n)); return String(n); },
    async sadd(k, ...m) { if (!sets.has(k)) sets.set(k, new Set()); m.flat().forEach(x => sets.get(k).add(x)); return 1; },
    async srem(k, ...m) { if (sets.has(k)) m.flat().forEach(x => sets.get(k).delete(x)); return 1; },
    async smembers(k) { return sets.has(k) ? [...sets.get(k)] : []; },
    async ttl(k) { return store.has(k) ? 100 : -2; },
    pipeline() {
      const ops = [];
      const p = { del:(...a)=>{ops.push(()=>api.del(...a));return p;}, set:(...a)=>{ops.push(()=>api.set(...a));return p;},
                  srem:(...a)=>{ops.push(()=>api.srem(...a));return p;}, async exec(){ for (const o of ops) await o(); return []; } };
      return p;
    },
  };
  return api;
}
function makePg(channels) {
  return {
    async query(sql) {
      if (/from team_members/i.test(sql)) return { rows: (channels || []).map(c => ({ channel: c })) };
      return { rows: [{ n: 0 }], rowCount: 1 };
    },
    async connect() {
      return { async query(sql) {
        if (/RETURNING id/.test(sql)) return { rows: [{ id: 1 }] };
        if (/COUNT/.test(sql)) return { rows: [{ n: 0 }] };
        if (/SELECT winner/.test(sql)) return { rows: [{}] };
        return { rows: [], rowCount: 1 };
      }, release() {} };
    },
  };
}
function engine(channels) { return new WatchtimeEngine(makeRedis(), makePg(channels || CH)); }

test('coinsFromSec / countWords / sanitize', () => {
  assert.equal(coinsFromSec(SECS_PER_COIN), 1);
  assert.equal(countWords('one two three four'), 4);
  assert.equal(sanitizeUsername('Bob_X!!'), 'bob_x');
  assert.equal(sanitizeStr('<b>hi"there</b>'), 'bhithere/b');
});

test('getChannels reads team_members', async () => {
  const e = engine();
  assert.deepEqual(await e.getChannels(TEAM), CH);
});

test('chat bonus 0.5s when following + >3 words', async () => {
  const e = engine();
  await e.redis.set(K.gwOpen(TEAM), 'true');
  const r = await e.handleChatMessage(TEAM, 'justcallmedeimos', 'bob', 'this is a message', true);
  assert.equal(r.added, CHAT_BONUS_SEC);
});

test('chat bonus blocked when not following', async () => {
  const e = engine();
  await e.redis.set(K.gwOpen(TEAM), 'true');
  const r = await e.handleChatMessage(TEAM, 'justcallmedeimos', 'bob', 'this is a message', false);
  assert.equal(r.followed, false);
});

test('multiplier doubles chat bonus', async () => {
  const e = engine();
  await e.redis.set(K.gwOpen(TEAM), 'true');
  await e.setMultiplier(TEAM, 2, 900);
  const r = await e.handleChatMessage(TEAM, 'justcallmedeimos', 'bob', 'this is a message', true);
  assert.equal(r.added, CHAT_BONUS_SEC * 2);
});

test('multiplier clamps + removes at 1', async () => {
  const e = engine();
  await e.setMultiplier(TEAM, 99, 60);
  assert.equal(await e.getMultiplier(TEAM), 10);
  await e.setMultiplier(TEAM, 1, 60);
  assert.equal(await e.getMultiplier(TEAM), 1);
});

test('keyword opt-in requires >=1 coin', async () => {
  const e = engine();
  await e.redis.set(K.gwOpen(TEAM), 'true');
  await e.redis.set(K.gwKeyword(TEAM), 'join');
  let r = await e.handleChatMessage(TEAM, 'justcallmedeimos', 'bob', 'join', true);
  assert.equal(r.registered, false);
  await e.redis.set(K.chWatch(TEAM, 'justcallmedeimos', 'bob'), String(SECS_PER_COIN));
  r = await e.handleChatMessage(TEAM, 'justcallmedeimos', 'bob', 'join', true);
  assert.equal(r.registered, true);
});

test('eligible only with valid coins on >=2 channels + registered', async () => {
  const e = engine();
  await e.redis.set(K.chWatch(TEAM, 'justcallmedeimos', 'bob'), String(SECS_PER_COIN));
  await e.redis.set(K.chFollows(TEAM, 'justcallmedeimos', 'bob'), '1');
  await e.redis.set(K.gwRegistered(TEAM, 'bob'), '1');
  let a = await e.getUserAggregate(TEAM, 'bob');
  assert.equal(a.channelsQualified, 1);
  assert.equal(a.eligible, false);
  await e.redis.set(K.chWatch(TEAM, 'jerichoramirez', 'bob'), String(SECS_PER_COIN));
  await e.redis.set(K.chFollows(TEAM, 'jerichoramirez', 'bob'), '1');
  a = await e.getUserAggregate(TEAM, 'bob');
  assert.equal(a.channelsQualified, 2);
  assert.equal(a.totalCoins, 2);
  assert.equal(a.eligible, true);
});

test('team isolation: users/coins do not leak across teams', async () => {
  const e = engine();
  await e.redis.set(K.chWatch('team_a', 'justcallmedeimos', 'bob'), String(SECS_PER_COIN));
  await e.redis.sadd(K.gwUsers('team_a'), 'bob');
  const a = await e.getUserAggregate('team_a', 'bob');
  const b = await e.getUserAggregate('team_b', 'bob');
  assert.equal(a.totalCoins, 1);
  assert.equal(b.totalCoins, 0);
  assert.equal((await e.getAllParticipants('team_b')).length, 0);
});

test('drawWinner ignores non-eligible', async () => {
  const e = engine();
  for (const ch of ['justcallmedeimos', 'jerichoramirez']) {
    await e.redis.set(K.chWatch(TEAM, ch, 'alice'), String(SECS_PER_COIN));
    await e.redis.set(K.chFollows(TEAM, ch, 'alice'), '1');
  }
  await e.redis.set(K.gwRegistered(TEAM, 'alice'), '1');
  await e.redis.sadd(K.gwUsers(TEAM), 'alice');
  await e.redis.set(K.chWatch(TEAM, 'justcallmedeimos', 'bob'), String(SECS_PER_COIN));
  await e.redis.set(K.chFollows(TEAM, 'justcallmedeimos', 'bob'), '1');
  await e.redis.set(K.gwRegistered(TEAM, 'bob'), '1');
  await e.redis.sadd(K.gwUsers(TEAM), 'bob');
  const r = await e.drawWinner(TEAM, 'sess_1', {});
  assert.equal(r.winner, 'alice');
  assert.equal(r.eligibleCount, 1);
});
