'use strict';

// ════════════════════════════════════════════════════════
// CHAOS CREW v5 – Watchtime Engine Unit Tests
// Nutzt Redis DB 1 (nie DB 0 = Produktion!)
// Nutzt separate Test-PG-Datenbank
// ════════════════════════════════════════════════════════

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  WatchtimeEngine, K,
  sanitizeUsername, sanitizeStr, countWords, coinsFromSec,
  SECS_PER_COIN, CHAT_BONUS_SEC, CHAT_COOLDOWN, CHAT_MIN_WORDS
} = require('../api/watchtime.js');

// ── Mock-Implementierungen ────────────────────────────────
// Echter Redis für Integration, Mock-PG für Isolation

function makeMockRedis() {
  const store = new Map();
  const sets  = new Map();

  const r = {
    _store: store,
    _sets:  sets,

    async get(key) { return store.get(key) ?? null; },
    async set(key, val, ...args) {
      store.set(key, String(val));
      return 'OK';
    },
    async incrby(key, by) {
      const v = parseInt(store.get(key) || '0') + by;
      store.set(key, String(v));
      return v;
    },
    async del(...keys) {
      for (const k of keys.flat()) store.delete(k), sets.delete(k);
      return 1;
    },
    async sadd(key, ...members) {
      if (!sets.has(key)) sets.set(key, new Set());
      for (const m of members.flat()) sets.get(key).add(m);
      return 1;
    },
    async smembers(key) { return [...(sets.get(key) || new Set())]; },
    pipeline() {
      const ops = [];
      const p = {
        del:  (...args) => { ops.push(() => r.del(...args)); return p; },
        set:  (...args) => { ops.push(() => r.set(...args)); return p; },
        exec: async () => { for (const op of ops) await op(); return []; },
      };
      return p;
    },
    async flushall() { store.clear(); sets.clear(); return 'OK'; },
  };
  return r;
}

function makeMockPg() {
  const queries = [];
  const client = {
    query: async (sql, params) => { queries.push({ sql, params }); return { rows: [] }; },
    release: () => {},
  };
  return {
    _queries: queries,
    async query(sql, params) { queries.push({ sql, params }); return { rows: [] }; },
    async connect() { return client; },
  };
}

// ── Hilfsfunktion: Giveaway öffnen ───────────────────────
async function openGiveaway(redis, keyword = 'test') {
  await redis.set(K.gwOpen(), 'true');
  await redis.set(K.gwKeyword(), keyword);
}

async function registerUser(engine, redis, username) {
  await redis.set(K.gwRegistered(username), '1');
  await redis.sadd(K.gwIndex(), username);
}

// ════════════════════════════════════════════════════════
// PURE FUNCTION TESTS (kein Redis/PG nötig)
// ════════════════════════════════════════════════════════

test('sanitizeUsername: lowercase, strip invalid', () => {
  assert.equal(sanitizeUsername('JustCallMeDeimos'), 'justcallmedeimos');
  assert.equal(sanitizeUsername('user@name!'), 'username');
  assert.equal(sanitizeUsername('a'.repeat(30)), 'a'.repeat(25));
  assert.equal(sanitizeUsername(''), '');
  assert.equal(sanitizeUsername(null), '');
});

test('countWords: edge cases', () => {
  assert.equal(countWords(''), 0);
  assert.equal(countWords('eins'), 1);
  assert.equal(countWords('eins zwei drei'), 3);
  assert.equal(countWords('  leading trailing  '), 2);
  assert.equal(countWords('a b c d e'), 5);
  assert.equal(countWords('a  b  c'), 3);  // Doppelspaces
});

test('countWords: min 5 Wörter Schwelle', () => {
  assert.equal(countWords('eins zwei drei vier') < CHAT_MIN_WORDS, true);
  assert.equal(countWords('eins zwei drei vier fuenf') >= CHAT_MIN_WORDS, true);
  assert.equal(countWords('a b c d e f') >= CHAT_MIN_WORDS, true);
});

test('coinsFromSec: Formel', () => {
  assert.equal(coinsFromSec(0),     0);
  assert.equal(coinsFromSec(7200),  1.0);
  assert.equal(coinsFromSec(3600),  0.5);
  assert.equal(coinsFromSec(1800),  0.25);
  assert.equal(coinsFromSec(14400), 2.0);
  // Dezimalgenauigkeit
  const result = coinsFromSec(1);
  assert.ok(result > 0 && result < 0.001, `1s → ${result}`);
});

test('SECS_PER_COIN ist 7200 (2h)', () => {
  assert.equal(SECS_PER_COIN, 7200);
});

test('CHAT_BONUS_SEC ist 5', () => {
  assert.equal(CHAT_BONUS_SEC, 5);
});

test('CHAT_COOLDOWN ist 10', () => {
  assert.equal(CHAT_COOLDOWN, 10);
});

// ════════════════════════════════════════════════════════
// WATCHTIME ENGINE TESTS (Mock-Redis + Mock-PG)
// ════════════════════════════════════════════════════════

test('ViewerTick: Giveaway geschlossen → kein Tick', async () => {
  const redis = makeMockRedis();
  const pg    = makeMockPg();
  const engine = new WatchtimeEngine(redis, pg);

  await redis.set(K.gwOpen(), 'false');
  const result = await engine.handleViewerTick('testuser', 'sess_1');
  assert.equal(result, null);
});

test('ViewerTick: Nicht registrierter User → kein Tick', async () => {
  const redis = makeMockRedis();
  const pg    = makeMockPg();
  const engine = new WatchtimeEngine(redis, pg);

  await openGiveaway(redis);
  const result = await engine.handleViewerTick('unknown_user', 'sess_1');
  assert.equal(result, null);
});

test('ViewerTick: Registrierter User → +60s', async () => {
  const redis = makeMockRedis();
  const pg    = makeMockPg();
  const engine = new WatchtimeEngine(redis, pg);

  await openGiveaway(redis);
  await registerUser(engine, redis, 'deimos');

  const result = await engine.handleViewerTick('deimos', 'sess_1');
  assert.ok(result, 'result should not be null');
  assert.equal(result.added, 60);
  assert.equal(result.watchSec, 60);
  assert.equal(result.coins, coinsFromSec(60));
});

test('ViewerTick: Kumulierung über mehrere Ticks', async () => {
  const redis = makeMockRedis();
  const pg    = makeMockPg();
  const engine = new WatchtimeEngine(redis, pg);

  await openGiveaway(redis);
  await registerUser(engine, redis, 'deimos');

  await engine.handleViewerTick('deimos', 'sess_1');
  await engine.handleViewerTick('deimos', 'sess_1');
  const r3 = await engine.handleViewerTick('deimos', 'sess_1');

  assert.equal(r3.watchSec, 180);  // 3 × 60
  assert.equal(r3.coins, coinsFromSec(180));
});

test('ViewerTick: Gebannter User → kein Tick', async () => {
  const redis = makeMockRedis();
  const pg    = makeMockPg();
  const engine = new WatchtimeEngine(redis, pg);

  await openGiveaway(redis);
  await registerUser(engine, redis, 'baduser');
  await redis.set(K.gwBanned('baduser'), '1');

  const result = await engine.handleViewerTick('baduser', 'sess_1');
  assert.equal(result, null);
});

test('ViewerTick: PG-Event wird geloggt', async () => {
  const redis = makeMockRedis();
  const pg    = makeMockPg();
  const engine = new WatchtimeEngine(redis, pg);

  await openGiveaway(redis);
  await registerUser(engine, redis, 'deimos');
  await engine.handleViewerTick('deimos', 'sess_42');

  assert.equal(pg._queries.length, 1);
  assert.ok(pg._queries[0].sql.includes('INSERT INTO watchtime_events'));
  assert.deepEqual(pg._queries[0].params, ['deimos', 'tick', 60, 'sess_42']);
});

test('ChatMessage: Giveaway geschlossen → kein Bonus', async () => {
  const redis = makeMockRedis();
  const pg    = makeMockPg();
  const engine = new WatchtimeEngine(redis, pg);

  await redis.set(K.gwOpen(), 'false');
  const result = await engine.handleChatMessage('deimos', 'hallo wie geht es dir heute', 'sess_1');
  assert.equal(result, null);
});

test('ChatMessage: Keyword → Registrierung', async () => {
  const redis = makeMockRedis();
  const pg    = makeMockPg();
  const engine = new WatchtimeEngine(redis, pg);

  await openGiveaway(redis, '!mitmachen');
  const result = await engine.handleChatMessage('newuser', '!mitmachen', 'sess_1');

  assert.ok(result);
  assert.equal(result.registered, true);
  assert.equal(result.isNew, true);

  // Zweites Mal → nicht mehr isNew
  const result2 = await engine.handleChatMessage('newuser', '!mitmachen', 'sess_1');
  assert.equal(result2.isNew, false);
});

test('ChatMessage: Keyword Case-Insensitive', async () => {
  const redis = makeMockRedis();
  const pg    = makeMockPg();
  const engine = new WatchtimeEngine(redis, pg);

  await openGiveaway(redis, '!MITMACHEN');
  const result = await engine.handleChatMessage('newuser', '!mitmachen', 'sess_1');
  assert.ok(result);
  assert.equal(result.registered, true);
});

test('ChatMessage: Zu wenig Wörter → kein Bonus', async () => {
  const redis = makeMockRedis();
  const pg    = makeMockPg();
  const engine = new WatchtimeEngine(redis, pg);

  await openGiveaway(redis, '!join');
  await registerUser(engine, redis, 'deimos');

  // Nur 3 Wörter
  const result = await engine.handleChatMessage('deimos', 'hey wie gehts', 'sess_1');
  assert.equal(result, null);
});

test('ChatMessage: 5+ Wörter → +5s Bonus', async () => {
  const redis = makeMockRedis();
  const pg    = makeMockPg();
  const engine = new WatchtimeEngine(redis, pg);

  await openGiveaway(redis, '!join');
  await registerUser(engine, redis, 'deimos');

  const result = await engine.handleChatMessage('deimos', 'hallo wie geht es dir', 'sess_1');
  assert.ok(result);
  assert.equal(result.added, CHAT_BONUS_SEC);
  assert.equal(result.watchSec, CHAT_BONUS_SEC);
});

test('ChatMessage: Cooldown verhindert Doppelzählung', async () => {
  const redis = makeMockRedis();
  const pg    = makeMockPg();
  const engine = new WatchtimeEngine(redis, pg);

  await openGiveaway(redis, '!join');
  await registerUser(engine, redis, 'deimos');

  const r1 = await engine.handleChatMessage('deimos', 'hallo wie geht es dir', 'sess_1');
  assert.ok(r1);  // Erste Nachricht zählt

  const r2 = await engine.handleChatMessage('deimos', 'noch eine Nachricht mit Wörtern hier', 'sess_1');
  assert.equal(r2, null);  // Cooldown – zählt nicht
});

test('ChatMessage: Cooldown läuft ab → nächste Nachricht zählt wieder', async () => {
  const redis = makeMockRedis();
  const pg    = makeMockPg();
  const engine = new WatchtimeEngine(redis, pg);

  await openGiveaway(redis, '!join');
  await registerUser(engine, redis, 'deimos');

  // Ersten Chat-Timestamp weit in der Vergangenheit setzen (15s ago)
  const pastTs = Math.floor(Date.now() / 1000) - 15;
  await redis.set(K.gwChatTime('deimos'), String(pastTs));

  const result = await engine.handleChatMessage('deimos', 'hallo wie geht es dir heute', 'sess_1');
  assert.ok(result);
  assert.equal(result.added, CHAT_BONUS_SEC);
});

test('ChatMessage: Unregistrierter User → kein Bonus', async () => {
  const redis = makeMockRedis();
  const pg    = makeMockPg();
  const engine = new WatchtimeEngine(redis, pg);

  await openGiveaway(redis, '!join');

  const result = await engine.handleChatMessage('stranger', 'hallo wie geht es dir heute', 'sess_1');
  assert.ok(result);  // Nicht null (gibt {registered:false})
  assert.equal(result.registered, false);
  // Aber keine watchSec hinzugefügt
  const state = await engine.getUserState('stranger');
  assert.equal(state.watchSec, 0);
});

test('ChatMessage: Tick + Chat kumulieren', async () => {
  const redis = makeMockRedis();
  const pg    = makeMockPg();
  const engine = new WatchtimeEngine(redis, pg);

  await openGiveaway(redis, '!join');
  await registerUser(engine, redis, 'deimos');

  // 3 Ticks = 180s
  await engine.handleViewerTick('deimos', 'sess_1');
  await engine.handleViewerTick('deimos', 'sess_1');
  await engine.handleViewerTick('deimos', 'sess_1');

  // 1 Chat-Bonus = 5s → 185s total
  const chatResult = await engine.handleChatMessage('deimos', 'hallo wie geht es dir heute', 'sess_1');
  assert.ok(chatResult);
  assert.equal(chatResult.watchSec, 185);
  assert.equal(chatResult.coins, coinsFromSec(185));
});

test('getUserState: korrekter Stand', async () => {
  const redis = makeMockRedis();
  const pg    = makeMockPg();
  const engine = new WatchtimeEngine(redis, pg);

  await openGiveaway(redis, '!join');
  await registerUser(engine, redis, 'deimos');
  await redis.set(K.gwWatchSec('deimos'), '3600');

  const state = await engine.getUserState('deimos');
  assert.equal(state.username, 'deimos');
  assert.equal(state.watchSec, 3600);
  assert.equal(state.coins, 0.5);
  assert.equal(state.registered, true);
  assert.equal(state.banned, false);
});

test('getUserState: Unbekannter User → 0s', async () => {
  const redis = makeMockRedis();
  const pg    = makeMockPg();
  const engine = new WatchtimeEngine(redis, pg);

  const state = await engine.getUserState('nobody');
  assert.equal(state.watchSec, 0);
  assert.equal(state.coins, 0);
  assert.equal(state.registered, false);
});

test('getAllParticipants: sortiert nach Coins', async () => {
  const redis = makeMockRedis();
  const pg    = makeMockPg();
  const engine = new WatchtimeEngine(redis, pg);

  await redis.set(K.gwWatchSec('alice'), '7200');
  await redis.set(K.gwWatchSec('bob'),   '3600');
  await redis.set(K.gwWatchSec('carol'), '14400');
  await redis.set(K.gwRegistered('alice'), '1');
  await redis.set(K.gwRegistered('bob'),   '1');
  await redis.set(K.gwRegistered('carol'), '1');
  await redis.sadd(K.gwIndex(), 'alice', 'bob', 'carol');

  const participants = await engine.getAllParticipants();
  assert.equal(participants[0].username, 'carol');  // 2.0 coins
  assert.equal(participants[1].username, 'alice');  // 1.0 coins
  assert.equal(participants[2].username, 'bob');    // 0.5 coins
});

test('resetGiveaway: löscht Redis-State, nicht PG', async () => {
  const redis = makeMockRedis();
  const pg    = makeMockPg();
  const engine = new WatchtimeEngine(redis, pg);

  await openGiveaway(redis, '!join');
  await registerUser(engine, redis, 'deimos');
  await redis.set(K.gwWatchSec('deimos'), '3600');

  await engine.resetGiveaway();

  const open = await redis.get(K.gwOpen());
  assert.equal(open, 'false');

  const watchSec = await redis.get(K.gwWatchSec('deimos'));
  assert.equal(watchSec, null);

  const members = await redis.smembers(K.gwIndex());
  assert.equal(members.length, 0);

  // PG nicht angetastet
  assert.equal(pg._queries.length, 0);
});

test('2h Watchtime = genau 1.0 Coin', () => {
  assert.equal(coinsFromSec(7200), 1.0);
});

test('Vielfache von 2h = ganze Coins', () => {
  assert.equal(coinsFromSec(7200 * 2), 2.0);
  assert.equal(coinsFromSec(7200 * 5), 5.0);
});

test('Isolierung: Tests teilen keinen State', async () => {
  const redis1 = makeMockRedis();
  const redis2 = makeMockRedis();
  const pg = makeMockPg();

  await openGiveaway(redis1);
  await registerUser(new WatchtimeEngine(redis1, pg), redis1, 'user_a');
  await redis1.set(K.gwWatchSec('user_a'), '100');

  // redis2 ist komplett unberührt
  const val = await redis2.get(K.gwWatchSec('user_a'));
  assert.equal(val, null);
});
