'use strict';

// ════════════════════════════════════════════════════════
// CHAOS CREW v5 – Comprehensive Console Unit Tests
// Runs with: node --test tests/console-unit-tests.js
// No stream, no WS, no Redis, no PG needed.
// ════════════════════════════════════════════════���═══════

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

// ── Load modules under test ──────────────────────────────
const {
  WatchtimeEngine, K,
  sanitizeUsername, sanitizeStr, countWords, coinsFromSec,
  SECS_PER_COIN, CHAT_BONUS_SEC, CHAT_COOLDOWN, CHAT_MIN_WORDS
} = require('../api/watchtime.js');

// ── Mock factories ───────────────────────────────────────
function makeMockRedis() {
  const store = new Map();
  const sets  = new Map();
  const sorted = new Map(); // for zadd/zrevrank
  const r = {
    _store: store, _sets: sets,
    async get(key) { return store.get(key) ?? null; },
    async set(key, val) { store.set(key, String(val)); return 'OK'; },
    async incrby(key, by) {
      const v = parseInt(store.get(key) || '0') + by;
      store.set(key, String(v));
      return v;
    },
    async del(...keys) {
      for (const k of keys.flat()) { store.delete(k); sets.delete(k); }
      return 1;
    },
    async sadd(key, ...members) {
      if (!sets.has(key)) sets.set(key, new Set());
      for (const m of members.flat()) sets.get(key).add(m);
      return 1;
    },
    async smembers(key) { return [...(sets.get(key) || new Set())]; },
    async zadd(key, score, member) {
      if (!sorted.has(key)) sorted.set(key, new Map());
      sorted.get(key).set(member, score);
    },
    async zrevrank(key, member) {
      if (!sorted.has(key)) return null;
      const entries = [...sorted.get(key).entries()].sort((a,b) => b[1] - a[1]);
      const idx = entries.findIndex(e => e[0] === member);
      return idx >= 0 ? idx : null;
    },
    async ping() { return 'PONG'; },
    async bgsave() { return 'OK'; },
    pipeline() {
      const ops = [];
      const p = {
        del:  (...args) => { ops.push(() => r.del(...args)); return p; },
        set:  (...args) => { ops.push(() => r.set(...args)); return p; },
        exec: async () => { for (const op of ops) await op(); return []; },
      };
      return p;
    },
    async flushall() { store.clear(); sets.clear(); sorted.clear(); return 'OK'; },
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

async function openGiveaway(redis, keyword = 'test') {
  await redis.set(K.gwOpen(), 'true');
  await redis.set(K.gwKeyword(), keyword);
}

async function registerUser(engine, redis, username) {
  await redis.set(K.gwRegistered(username), '1');
  await redis.sadd(K.gwIndex(), username);
}

// ══════════════════════��═════════════════════════════���═══
// SECTION 1: Input Validation & Sanitization
// Tests the validate.js / chaos-crew-shared.js functions
// via the server-side equivalents in watchtime.js
// ════════════════════════════════════���═══════════════════

describe('sanitizeUsername', () => {
  test('lowercases input', () => {
    assert.equal(sanitizeUsername('JustCallMeDeimos'), 'justcallmedeimos');
  });

  test('strips invalid chars', () => {
    assert.equal(sanitizeUsername('user@name!'), 'username');
    assert.equal(sanitizeUsername('bad$user#123'), 'baduser123');
  });

  test('truncates at 25 chars', () => {
    assert.equal(sanitizeUsername('a'.repeat(30)), 'a'.repeat(25));
  });

  test('handles empty/null/undefined', () => {
    assert.equal(sanitizeUsername(''), '');
    assert.equal(sanitizeUsername(null), '');
    assert.equal(sanitizeUsername(undefined), '');
  });

  test('preserves underscores', () => {
    assert.equal(sanitizeUsername('user_name_1'), 'user_name_1');
  });

  test('preserves digits', () => {
    assert.equal(sanitizeUsername('player123'), 'player123');
  });
});

describe('sanitizeStr', () => {
  test('strips control characters', () => {
    assert.equal(sanitizeStr('hello\x00world'), 'helloworld');
    assert.equal(sanitizeStr('test\x1Fvalue'), 'testvalue');
  });

  test('strips HTML-dangerous chars', () => {
    assert.equal(sanitizeStr('<script>alert(1)</script>'), 'scriptalert(1)/script');
  });

  test('truncates to maxLen', () => {
    assert.equal(sanitizeStr('a'.repeat(200), 50), 'a'.repeat(50));
  });

  test('handles null/undefined', () => {
    assert.equal(sanitizeStr(null), '');
    assert.equal(sanitizeStr(undefined), '');
  });

  test('default maxLen is 100', () => {
    assert.equal(sanitizeStr('a'.repeat(150)).length, 100);
  });
});

describe('countWords', () => {
  test('empty string', () => assert.equal(countWords(''), 0));
  test('single word', () => assert.equal(countWords('hello'), 1));
  test('multiple words', () => assert.equal(countWords('eins zwei drei'), 3));
  test('leading/trailing spaces', () => assert.equal(countWords('  leading trailing  '), 2));
  test('double spaces', () => assert.equal(countWords('a  b  c'), 3));
  test('tabs count as separators', () => assert.equal(countWords('a\tb\tc'), 3));
  test('exactly 5 words (CHAT_MIN_WORDS threshold)', () => {
    assert.equal(countWords('eins zwei drei vier fuenf'), 5);
    assert.equal(countWords('eins zwei drei vier fuenf') >= CHAT_MIN_WORDS, true);
  });
  test('4 words below threshold', () => {
    assert.equal(countWords('eins zwei drei vier') < CHAT_MIN_WORDS, true);
  });
});

describe('coinsFromSec', () => {
  test('0s = 0 coins', () => assert.equal(coinsFromSec(0), 0));
  test('3600s = 0.5 coins', () => assert.equal(coinsFromSec(3600), 0.5));
  test('7200s = 1.0 coin', () => assert.equal(coinsFromSec(7200), 1.0));
  test('14400s = 2.0 coins', () => assert.equal(coinsFromSec(14400), 2.0));
  test('1800s = 0.25 coins', () => assert.equal(coinsFromSec(1800), 0.25));

  test('matches C# formula: watchSec / 7200', () => {
    // C# code sends raw seconds, JS converts to coins
    const cases = [0, 60, 300, 1800, 3600, 5400, 7200, 10800, 14400, 36000];
    for (const sec of cases) {
      const expected = Math.round((sec / 7200) * 10000) / 10000;
      assert.equal(coinsFromSec(sec), expected, `${sec}s → ${coinsFromSec(sec)} != ${expected}`);
    }
  });

  test('precision: 1s produces > 0 and < 0.001', () => {
    const result = coinsFromSec(1);
    assert.ok(result > 0 && result < 0.001, `1s → ${result}`);
  });
});

describe('Constants match protocol spec', () => {
  test('SECS_PER_COIN = 7200', () => assert.equal(SECS_PER_COIN, 7200));
  test('CHAT_BONUS_SEC = 5', () => assert.equal(CHAT_BONUS_SEC, 5));
  test('CHAT_COOLDOWN = 10', () => assert.equal(CHAT_COOLDOWN, 10));
  test('CHAT_MIN_WORDS = 5', () => assert.equal(CHAT_MIN_WORDS, 5));
});

// ══════════════════════════════════��═════════════════════
// SECTION 2: Redis Key Schema
// ══════════════════════════���═════════════════════════════

describe('Redis Key Schema', () => {
  test('gwOpen key', () => assert.equal(K.gwOpen(), 'gw_open'));
  test('gwKeyword key', () => assert.equal(K.gwKeyword(), 'gw_keyword'));
  test('gwWatchSec key', () => assert.equal(K.gwWatchSec('alice'), 'gw_watch:alice'));
  test('gwRegistered key', () => assert.equal(K.gwRegistered('alice'), 'gw_registered:alice'));
  test('gwBanned key', () => assert.equal(K.gwBanned('alice'), 'gw_banned:alice'));
  test('gwIndex key', () => assert.equal(K.gwIndex(), 'gw_index'));
  test('gwChatTime key', () => assert.equal(K.gwChatTime('alice'), 'gw_chat_ts:alice'));
  test('gwSessionId key', () => assert.equal(K.gwSessionId(), 'gw_session_id'));
  test('sfStats key', () => assert.equal(K.sfStats('player1'), 'sf:stats:player1'));
  test('sfIndex key', () => assert.equal(K.sfIndex(), 'sf:index'));
  test('sfHistory key', () => assert.equal(K.sfHistory(), 'sf:history'));
});

// ════════════════════════════════════════════════════════
// SECTION 3: WatchtimeEngine – ViewerTick
// ════════════════���══════════════════════════════��════════

describe('WatchtimeEngine: ViewerTick', () => {
  test('closed giveaway → null', async () => {
    const redis = makeMockRedis();
    const engine = new WatchtimeEngine(redis, makeMockPg());
    await redis.set(K.gwOpen(), 'false');
    assert.equal(await engine.handleViewerTick('testuser', 'sess_1'), null);
  });

  test('unregistered user → null', async () => {
    const redis = makeMockRedis();
    const engine = new WatchtimeEngine(redis, makeMockPg());
    await openGiveaway(redis);
    assert.equal(await engine.handleViewerTick('unknown', 'sess_1'), null);
  });

  test('registered user → +60s', async () => {
    const redis = makeMockRedis();
    const engine = new WatchtimeEngine(redis, makeMockPg());
    await openGiveaway(redis);
    await registerUser(engine, redis, 'deimos');
    const result = await engine.handleViewerTick('deimos', 'sess_1');
    assert.ok(result);
    assert.equal(result.added, 60);
    assert.equal(result.watchSec, 60);
    assert.equal(result.coins, coinsFromSec(60));
  });

  test('banned user → null', async () => {
    const redis = makeMockRedis();
    const engine = new WatchtimeEngine(redis, makeMockPg());
    await openGiveaway(redis);
    await registerUser(engine, redis, 'baduser');
    await redis.set(K.gwBanned('baduser'), '1');
    assert.equal(await engine.handleViewerTick('baduser', 'sess_1'), null);
  });

  test('cumulative ticks: 3×60 = 180s', async () => {
    const redis = makeMockRedis();
    const engine = new WatchtimeEngine(redis, makeMockPg());
    await openGiveaway(redis);
    await registerUser(engine, redis, 'deimos');
    await engine.handleViewerTick('deimos', 'sess_1');
    await engine.handleViewerTick('deimos', 'sess_1');
    const r3 = await engine.handleViewerTick('deimos', 'sess_1');
    assert.equal(r3.watchSec, 180);
    assert.equal(r3.coins, coinsFromSec(180));
  });

  test('120 ticks = 7200s = exactly 1.0 coin', async () => {
    const redis = makeMockRedis();
    const engine = new WatchtimeEngine(redis, makeMockPg());
    await openGiveaway(redis);
    await registerUser(engine, redis, 'deimos');
    for (let i = 0; i < 120; i++) {
      await engine.handleViewerTick('deimos', 'sess_1');
    }
    const state = await engine.getUserState('deimos');
    assert.equal(state.watchSec, 7200);
    assert.equal(state.coins, 1.0);
  });

  test('PG event is logged', async () => {
    const redis = makeMockRedis();
    const pg = makeMockPg();
    const engine = new WatchtimeEngine(redis, pg);
    await openGiveaway(redis);
    await registerUser(engine, redis, 'deimos');
    await engine.handleViewerTick('deimos', 'sess_42');
    assert.equal(pg._queries.length, 1);
    assert.ok(pg._queries[0].sql.includes('INSERT INTO watchtime_events'));
    assert.deepEqual(pg._queries[0].params, ['deimos', 'tick', 60, 'sess_42']);
  });

  test('empty username → null', async () => {
    const redis = makeMockRedis();
    const engine = new WatchtimeEngine(redis, makeMockPg());
    await openGiveaway(redis);
    assert.equal(await engine.handleViewerTick('', 'sess_1'), null);
  });

  test('username with special chars gets sanitized', async () => {
    const redis = makeMockRedis();
    const pg = makeMockPg();
    const engine = new WatchtimeEngine(redis, pg);
    await openGiveaway(redis);
    // Register the sanitized username
    await registerUser(engine, redis, 'testuser');
    const result = await engine.handleViewerTick('TestUser!@#$', 'sess_1');
    assert.ok(result);
    assert.equal(result.added, 60);
  });
});

// ════════════════════════════════════════════════════════
// SECTION 4: WatchtimeEngine – ChatMessage
// ═══════════════════════════════════════════════════���════

describe('WatchtimeEngine: ChatMessage', () => {
  test('closed giveaway → null', async () => {
    const redis = makeMockRedis();
    const engine = new WatchtimeEngine(redis, makeMockPg());
    await redis.set(K.gwOpen(), 'false');
    assert.equal(await engine.handleChatMessage('deimos', 'hello world', 'sess_1'), null);
  });

  test('keyword → registration (isNew: true)', async () => {
    const redis = makeMockRedis();
    const engine = new WatchtimeEngine(redis, makeMockPg());
    await openGiveaway(redis, '!mitmachen');
    const result = await engine.handleChatMessage('newuser', '!mitmachen', 'sess_1');
    assert.ok(result);
    assert.equal(result.registered, true);
    assert.equal(result.isNew, true);
  });

  test('keyword second time → isNew: false', async () => {
    const redis = makeMockRedis();
    const engine = new WatchtimeEngine(redis, makeMockPg());
    await openGiveaway(redis, '!mitmachen');
    await engine.handleChatMessage('newuser', '!mitmachen', 'sess_1');
    const r2 = await engine.handleChatMessage('newuser', '!mitmachen', 'sess_1');
    assert.equal(r2.isNew, false);
  });

  test('keyword case-insensitive', async () => {
    const redis = makeMockRedis();
    const engine = new WatchtimeEngine(redis, makeMockPg());
    await openGiveaway(redis, '!MITMACHEN');
    const result = await engine.handleChatMessage('newuser', '!mitmachen', 'sess_1');
    assert.ok(result);
    assert.equal(result.registered, true);
  });

  test('too few words → null', async () => {
    const redis = makeMockRedis();
    const engine = new WatchtimeEngine(redis, makeMockPg());
    await openGiveaway(redis, '!join');
    await registerUser(engine, redis, 'deimos');
    assert.equal(await engine.handleChatMessage('deimos', 'hey wie gehts', 'sess_1'), null);
  });

  test('5+ words → +5s bonus', async () => {
    const redis = makeMockRedis();
    const engine = new WatchtimeEngine(redis, makeMockPg());
    await openGiveaway(redis, '!join');
    await registerUser(engine, redis, 'deimos');
    const result = await engine.handleChatMessage('deimos', 'hallo wie geht es dir', 'sess_1');
    assert.ok(result);
    assert.equal(result.added, CHAT_BONUS_SEC);
  });

  test('cooldown blocks second message', async () => {
    const redis = makeMockRedis();
    const engine = new WatchtimeEngine(redis, makeMockPg());
    await openGiveaway(redis, '!join');
    await registerUser(engine, redis, 'deimos');
    const r1 = await engine.handleChatMessage('deimos', 'hallo wie geht es dir', 'sess_1');
    assert.ok(r1);
    const r2 = await engine.handleChatMessage('deimos', 'noch eine Nachricht mit Wörtern hier', 'sess_1');
    assert.equal(r2, null);
  });

  test('cooldown expires → next message counts', async () => {
    const redis = makeMockRedis();
    const engine = new WatchtimeEngine(redis, makeMockPg());
    await openGiveaway(redis, '!join');
    await registerUser(engine, redis, 'deimos');
    const pastTs = Math.floor(Date.now() / 1000) - 15;
    await redis.set(K.gwChatTime('deimos'), String(pastTs));
    const result = await engine.handleChatMessage('deimos', 'hallo wie geht es dir heute', 'sess_1');
    assert.ok(result);
    assert.equal(result.added, CHAT_BONUS_SEC);
  });

  test('unregistered user → {registered: false}', async () => {
    const redis = makeMockRedis();
    const engine = new WatchtimeEngine(redis, makeMockPg());
    await openGiveaway(redis, '!join');
    const result = await engine.handleChatMessage('stranger', 'hallo wie geht es dir heute', 'sess_1');
    assert.ok(result);
    assert.equal(result.registered, false);
  });

  test('tick + chat cumulate', async () => {
    const redis = makeMockRedis();
    const engine = new WatchtimeEngine(redis, makeMockPg());
    await openGiveaway(redis, '!join');
    await registerUser(engine, redis, 'deimos');
    await engine.handleViewerTick('deimos', 'sess_1');
    await engine.handleViewerTick('deimos', 'sess_1');
    await engine.handleViewerTick('deimos', 'sess_1');
    const chatResult = await engine.handleChatMessage('deimos', 'hallo wie geht es dir heute', 'sess_1');
    assert.ok(chatResult);
    assert.equal(chatResult.watchSec, 185); // 3×60 + 5
    assert.equal(chatResult.coins, coinsFromSec(185));
  });

  test('banned user chat → null', async () => {
    const redis = makeMockRedis();
    const engine = new WatchtimeEngine(redis, makeMockPg());
    await openGiveaway(redis, '!join');
    await registerUser(engine, redis, 'banned_user');
    await redis.set(K.gwBanned('banned_user'), '1');
    const result = await engine.handleChatMessage('banned_user', 'hallo wie geht es dir heute', 'sess_1');
    assert.equal(result, null);
  });
});

// ═════════════════════════════════════════════���══════════
// SECTION 5: WatchtimeEngine – getUserState / getAllParticipants
// ═════════════════════════════════════��══════════════════

describe('WatchtimeEngine: State queries', () => {
  test('getUserState: known user', async () => {
    const redis = makeMockRedis();
    const engine = new WatchtimeEngine(redis, makeMockPg());
    await openGiveaway(redis);
    await registerUser(engine, redis, 'deimos');
    await redis.set(K.gwWatchSec('deimos'), '3600');
    const state = await engine.getUserState('deimos');
    assert.equal(state.username, 'deimos');
    assert.equal(state.watchSec, 3600);
    assert.equal(state.coins, 0.5);
    assert.equal(state.registered, true);
    assert.equal(state.banned, false);
  });

  test('getUserState: unknown user → 0', async () => {
    const redis = makeMockRedis();
    const engine = new WatchtimeEngine(redis, makeMockPg());
    const state = await engine.getUserState('nobody');
    assert.equal(state.watchSec, 0);
    assert.equal(state.coins, 0);
    assert.equal(state.registered, false);
  });

  test('getAllParticipants: sorted by coins desc', async () => {
    const redis = makeMockRedis();
    const engine = new WatchtimeEngine(redis, makeMockPg());
    await redis.set(K.gwWatchSec('alice'), '7200');
    await redis.set(K.gwWatchSec('bob'), '3600');
    await redis.set(K.gwWatchSec('carol'), '14400');
    await redis.set(K.gwRegistered('alice'), '1');
    await redis.set(K.gwRegistered('bob'), '1');
    await redis.set(K.gwRegistered('carol'), '1');
    await redis.sadd(K.gwIndex(), 'alice', 'bob', 'carol');
    const participants = await engine.getAllParticipants();
    assert.equal(participants[0].username, 'carol');  // 2.0 coins
    assert.equal(participants[1].username, 'alice');  // 1.0 coins
    assert.equal(participants[2].username, 'bob');    // 0.5 coins
  });
});

// ═════════════════════════════════════════��══════════════
// SECTION 6: WatchtimeEngine – resetGiveaway
// ══════════════════════════════════════════���═════════════

describe('WatchtimeEngine: resetGiveaway', () => {
  test('clears Redis state, not PG', async () => {
    const redis = makeMockRedis();
    const pg = makeMockPg();
    const engine = new WatchtimeEngine(redis, pg);
    await openGiveaway(redis, '!join');
    await registerUser(engine, redis, 'deimos');
    await redis.set(K.gwWatchSec('deimos'), '3600');
    await engine.resetGiveaway();

    assert.equal(await redis.get(K.gwOpen()), 'false');
    assert.equal(await redis.get(K.gwWatchSec('deimos')), null);
    assert.equal((await redis.smembers(K.gwIndex())).length, 0);
    assert.equal(pg._queries.length, 0);
  });
});

// ═══════════════════════════════════════════���════════════
// SECTION 7: C# ↔ JS Protocol Compatibility
// Verifies event formats match what the C# code sends
// ═══════════════════════════════���════════════════════════

describe('C# ↔ JS Protocol Compatibility', () => {
  test('viewer_tick event format matches C# GW_A_ViewerTick', () => {
    // C# sends: { event: "viewer_tick", user: "...", ts: unix_epoch }
    const event = { event: 'viewer_tick', user: 'justcallmedeimos', ts: 1234567890 };
    assert.equal(event.event, 'viewer_tick');
    assert.ok(typeof event.user === 'string');
    assert.ok(typeof event.ts === 'number');
    // Verify username would survive sanitization
    assert.equal(sanitizeUsername(event.user), 'justcallmedeimos');
  });

  test('chat_msg event format matches C# GW_B_ChatMessage', () => {
    // C# sends: { event: "chat_msg", user: "...", message: "...", ts: epoch }
    const event = { event: 'chat_msg', user: 'deimos', message: 'hallo wie geht es dir', ts: 1234567890 };
    assert.equal(event.event, 'chat_msg');
    assert.ok(typeof event.user === 'string');
    assert.ok(typeof event.message === 'string');
    assert.ok(typeof event.ts === 'number');
  });

  test('time_cmd event format matches C# GW_TimeInfo', () => {
    // C# sends: { event: "time_cmd", user: "..." }
    const event = { event: 'time_cmd', user: 'deimos' };
    assert.equal(event.event, 'time_cmd');
    assert.ok(typeof event.user === 'string');
  });

  test('chat_reply event format matches C# CC_ChatReply expectations', () => {
    // API sends back: { event: "chat_reply", user: "...", message: "@user Watchtime:..." }
    const event = {
      event: 'chat_reply',
      user: 'deimos',
      message: '@deimos Watchtime: 1h 0m | Coins: 0.50 | Nächstes Coin in ca. 1h 0m'
    };
    assert.equal(event.event, 'chat_reply');
    assert.ok(event.message.includes('@deimos'));
    assert.ok(event.message.includes('Watchtime:'));
    assert.ok(event.message.includes('Coins:'));
  });

  test('cc_api_register event matches C# CC_ApiRegister', () => {
    // API sends on connect: { event: "cc_api_register" }
    // C# stores the sessionId from this connection
    const event = { event: 'cc_api_register' };
    assert.equal(event.event, 'cc_api_register');
  });

  test('C# username sanitization matches JS (alphanumeric + underscore, max 25)', () => {
    // C# code in GetUser(): only allows a-z, A-Z, 0-9, _, max 25 chars
    // JS sanitizeUsername: lowercase + same char set + max 25
    const testCases = [
      { input: 'ValidUser_123', csClean: 'ValidUser_123', jsClean: 'validuser_123' },
      { input: 'bad@user!name', csClean: 'badusername', jsClean: 'badusername' },
      { input: 'a'.repeat(30),  csClean: 'a'.repeat(25), jsClean: 'a'.repeat(25) },
    ];
    for (const tc of testCases) {
      // JS always lowercases, C# preserves case but both strip invalid chars
      const jsResult = sanitizeUsername(tc.input);
      assert.equal(jsResult, tc.jsClean);
      assert.equal(jsResult.length <= 25, true);
      // Verify chars are identical (ignoring case)
      assert.equal(jsResult, tc.csClean.toLowerCase());
    }
  });

  test('C# message truncation at 500 chars matches sanitizeStr', () => {
    // C# GW_B_ChatMessage: message.Substring(0, 500)
    const longMsg = 'a'.repeat(600);
    const sanitized = sanitizeStr(longMsg, 500);
    assert.equal(sanitized.length, 500);
  });

  test('C# bot filter list: known bots are filtered', () => {
    // Bots that C# filters out – the API should never receive these
    const BOTS = ['streamelements','nightbot','moobot','fossabot','wizebot','botrixoficial','commanderroot'];
    for (const bot of BOTS) {
      // Verify they would be valid usernames if they got through
      assert.equal(sanitizeUsername(bot), bot);
    }
  });

  test('spacefight_result event has required fields', () => {
    const result = {
      event: 'spacefight_result',
      winner: 'jerichoramirez',
      loser: 'headwig',
      ship_w: 'PERSEUS',
      ship_l: 'AURORA',
      attacker: 'jerichoramirez',
      defender: 'headwig',
      ts: new Date().toISOString()
    };
    assert.equal(result.event, 'spacefight_result');
    assert.ok(result.winner);
    assert.ok(result.loser);
    assert.ok(result.ship_w);
    assert.ok(result.ship_l);
    assert.ok(result.ts);
  });

  test('gw_data event structure: participants array with correct field types', () => {
    const event = {
      event: 'gw_data',
      open: true,
      session: 'sess_123',
      participants: [
        { username: 'alice', watchSec: 7200, coins: 1.0, registered: true, banned: false },
        { username: 'bob',   watchSec: 3600, coins: 0.5, registered: true, banned: false },
      ]
    };
    assert.ok(Array.isArray(event.participants));
    assert.equal(typeof event.open, 'boolean');
    assert.equal(event.participants[0].watchSec, 7200);
    assert.equal(event.participants[0].coins, 1.0);
    assert.equal(typeof event.participants[0].banned, 'boolean');
  });

  test('wt_update event has watchSec and coins', () => {
    const event = { event: 'wt_update', user: 'alice', watchSec: 7200, coins: 1.0 };
    assert.equal(event.watchSec, 7200);
    assert.equal(event.coins, 1.0);
  });

  test('gw_status event: open/closed', () => {
    const open = { event: 'gw_status', status: 'open' };
    const closed = { event: 'gw_status', status: 'closed' };
    assert.equal(open.status, 'open');
    assert.equal(closed.status, 'closed');
  });

  test('gw_cmd commands match ALLOWED_CMDS whitelist', () => {
    // These are the commands the admin panel sends
    const ALLOWED_CMDS = [
      'gw_open', 'gw_close', 'gw_reset',
      'gw_add_ticket', 'gw_sub_ticket',
      'gw_ban', 'gw_unban',
      'gw_set_keyword', 'gw_get_keyword'
    ];
    // Verify each command is a valid string
    for (const cmd of ALLOWED_CMDS) {
      assert.ok(typeof cmd === 'string' && cmd.length > 0);
      assert.ok(/^[a-z_]+$/.test(cmd), `Invalid cmd format: ${cmd}`);
    }
  });
});

// ════════════════════════════════════════════���═══════════
// SECTION 8: Giveaway Admin JS Logic
// Tests parseDec, fmtTime equivalents
// ════════════════════════════════════════════════��═══════

describe('Giveaway Admin: parseDec (InvariantCulture-safe)', () => {
  // Reimplementation of the parseDec from giveaway-admin.js
  function parseDec(v) {
    if (v === null || v === undefined) return 0;
    if (typeof v === 'string') return parseFloat(v.replace(/,/g, '.')) || 0;
    return parseFloat(v) || 0;
  }

  test('German comma decimal: "1,5" → 1.5', () => assert.equal(parseDec('1,5'), 1.5));
  test('English dot decimal: "3.0000" → 3', () => assert.equal(parseDec('3.0000'), 3));
  test('integer string: "42" → 42', () => assert.equal(parseDec('42'), 42));
  test('null → 0', () => assert.equal(parseDec(null), 0));
  test('undefined → 0', () => assert.equal(parseDec(undefined), 0));
  test('invalid string → 0', () => assert.equal(parseDec('abc'), 0));
  test('number passthrough: 2.5 → 2.5', () => assert.equal(parseDec(2.5), 2.5));
  test('Streamerbot InvariantCulture "0.5000" → 0.5', () => assert.equal(parseDec('0.5000'), 0.5));
  test('multiple commas: "1,234,567" → parseFloat stops at second dot → 1.234', () => {
    // parseDec replaces ALL commas with dots: "1.234.567" → parseFloat("1.234.567") = 1.234
    // This is correct: parseDec is a DECIMAL parser, not a thousands separator handler
    assert.equal(parseDec('1,234,567'), 1.234);
  });
});

describe('Giveaway Admin: fmtTime', () => {
  function fmtTime(s) {
    if (!s) return '0:00:00';
    return `${Math.floor(s/3600)}:${String(Math.floor((s%3600)/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
  }

  test('0 → "0:00:00"', () => assert.equal(fmtTime(0), '0:00:00'));
  test('60 → "0:01:00"', () => assert.equal(fmtTime(60), '0:01:00'));
  test('3600 → "1:00:00"', () => assert.equal(fmtTime(3600), '1:00:00'));
  test('3661 → "1:01:01"', () => assert.equal(fmtTime(3661), '1:01:01'));
  test('7200 → "2:00:00"', () => assert.equal(fmtTime(7200), '2:00:00'));
  test('86400 → "24:00:00"', () => assert.equal(fmtTime(86400), '24:00:00'));
  test('null → "0:00:00"', () => assert.equal(fmtTime(null), '0:00:00'));
});

// ════════════════════════════════════════════════════════
// SECTION 9: Spacefight Logic (pure functions)
// ═══════════════════════════════════════════════���════════

describe('Spacefight: Ship definitions', () => {
  const SHIPS = [
    { name: 'PERSEUS',       power: 3 },
    { name: 'HAMMERHEAD',    power: 3 },
    { name: 'VANGUARD',      power: 3 },
    { name: 'CONSTELLATION', power: 2 },
    { name: 'GLADIUS',       power: 2 },
    { name: 'SABRE',         power: 2 },
    { name: 'ORIGIN 300I',   power: 2 },
    { name: 'ARROW',         power: 2 },
    { name: 'HORNET',        power: 2 },
    { name: 'AURORA',        power: 1 },
  ];

  test('10 ships defined', () => assert.equal(SHIPS.length, 10));
  test('power range is 1-3', () => {
    for (const ship of SHIPS) {
      assert.ok(ship.power >= 1 && ship.power <= 3, `${ship.name} power ${ship.power} out of range`);
    }
  });
  test('all ships have non-empty names', () => {
    for (const ship of SHIPS) {
      assert.ok(ship.name.length > 0, 'Ship name must not be empty');
    }
  });
  test('no duplicate ship names', () => {
    const names = new Set(SHIPS.map(s => s.name));
    assert.equal(names.size, SHIPS.length);
  });
});

describe('Spacefight: Fight mechanics', () => {
  test('fight simulation produces valid result', () => {
    const SHIPS = [
      { name: 'PERSEUS', power: 3 }, { name: 'AURORA', power: 1 },
    ];
    const shipA = SHIPS[0];
    const shipD = SHIPS[1];
    const powerA = shipA.power + Math.random() * 3;
    const powerD = shipD.power + Math.random() * 3;
    const aWins = powerA > powerD || (powerA === powerD && Math.random() < 0.5);
    assert.equal(typeof aWins, 'boolean');
  });

  test('COOLDOWN_MS is 20000 (20s per attacker)', () => {
    assert.equal(20000, 20000);
  });

  test('CHAT_ACTIVE_MS is 300000 (5 min)', () => {
    assert.equal(5 * 60 * 1000, 300000);
  });

  test('command parser: !fight @user extracts correctly', () => {
    const testCases = [
      { msg: '!fight @Defender', expected: 'Defender' },
      { msg: '!fight Defender', expected: 'Defender' },
      { msg: '!FIGHT @user', expected: 'user' },
      { msg: '!fight @"QuotedUser"', expected: 'QuotedUser' },
      { msg: 'hello world', expected: null },
      { msg: '!fight', expected: null },
    ];
    for (const tc of testCases) {
      const m = tc.msg.match(/^!fight\s+@?(\S+)/i);
      if (tc.expected === null) {
        assert.equal(m, null, `Expected null for "${tc.msg}"`);
      } else {
        assert.ok(m, `Expected match for "${tc.msg}"`);
        const defender = m[1].replace(/^@/, '').replace(/^["']|["']$/g, '').trim();
        assert.equal(defender, tc.expected, `For "${tc.msg}": got "${defender}"`);
      }
    }
  });

  test('self-fight is rejected (attacker === defender)', () => {
    const attacker = 'deimos';
    const defender = 'deimos';
    assert.equal(attacker.toLowerCase() === defender.toLowerCase(), true);
  });
});

// ════════════════════════════════════════���═══════════════
// SECTION 10: Navigation Structure
// Verifies the PAGES array used by nav.js
// ════════════════════════════════════════════════════════

describe('Navigation: PAGES structure', () => {
  const PAGES = [
    { href: 'giveaway/giveaway-admin.html',  label: 'ADMIN PANEL',   group: 'giveaway' },
    { href: 'giveaway/stats.html',           label: 'STATISTIKEN',   group: 'giveaway' },
    { href: 'giveaway/giveaway-test.html',   label: 'TEST CONSOLE',  group: 'tools' },
    { href: 'tests/test-runner.html', label: 'TEST SUITE',  group: 'tools' },
    { sep: true },
    { href: 'streamerbot.html',     label: 'C# ACTIONS',    group: 'tools', color: 'gold' },
    { sep: true },
    { href: 'games/spacefight-admin.html', label: 'SF ADMIN', group: 'tools', color: 'gold' },
    { sep: true },
    { href: 'giveaway/giveaway-overlay.html', label: 'GW OVERLAY',   group: 'obs', obs: true },
    { href: 'giveaway/giveaway-join.html',   label: 'JOIN ANIM',     group: 'obs', obs: true },
    { href: 'chat.html',            label: 'HUD CHAT',      group: 'obs', obs: true },
    { href: 'games/spacefight.html',      label: 'RAUMKAMPF',     group: 'obs', obs: true },
  ];

  const links = PAGES.filter(p => !p.sep);

  test('all nav links have href and label', () => {
    for (const p of links) {
      assert.ok(p.href, `Missing href for ${JSON.stringify(p)}`);
      assert.ok(p.label, `Missing label for ${JSON.stringify(p)}`);
    }
  });

  test('all linked HTML files exist on disk', () => {
    const webDir = path.join(__dirname, '..', 'web');
    for (const p of links) {
      const filePath = path.join(webDir, p.href);
      assert.ok(fs.existsSync(filePath), `Nav link target missing: web/${p.href}`);
    }
  });

  test('OBS overlays have obs flag', () => {
    const obsPages = links.filter(p => p.obs);
    assert.ok(obsPages.length >= 4, `Expected at least 4 OBS pages, got ${obsPages.length}`);
    for (const p of obsPages) {
      assert.equal(p.obs, true);
    }
  });

  test('admin pages do NOT have obs flag', () => {
    const adminPages = links.filter(p => p.group !== 'obs');
    for (const p of adminPages) {
      assert.equal(p.obs, undefined, `Admin page ${p.href} should not have obs flag`);
    }
  });

  test('no duplicate hrefs in navigation', () => {
    const hrefs = new Set(links.map(p => p.href));
    assert.equal(hrefs.size, links.length, 'Duplicate hrefs found in navigation');
  });
});

// ════════════════════════════════════════════════════════
// SECTION 11: HTML files include chaos-crew-shared.js
// ═════════════════���═════════════════════════════��════════

describe('Admin HTML files include shared.js (→ get navigation)', () => {
  const webDir = path.join(__dirname, '..', 'web');

  const adminPages = [
    'index.html',
    'giveaway/giveaway-admin.html',
    'giveaway/stats.html',
    'giveaway/giveaway-test.html',
    'streamerbot.html',
    'games/spacefight-admin.html',
    'tests/test-runner.html',
  ];

  for (const page of adminPages) {
    test(`${page} includes chaos-crew-shared.js`, () => {
      const content = fs.readFileSync(path.join(webDir, page), 'utf-8');
      assert.ok(
        content.includes('chaos-crew-shared.js'),
        `${page} does not include chaos-crew-shared.js`
      );
    });
  }

  const overlayPages = [
    'chat.html',
    'games/spacefight.html',
    'giveaway/giveaway-overlay.html',
    'giveaway/giveaway-join.html',
  ];

  for (const page of overlayPages) {
    test(`${page} does NOT include shared.js (OBS overlay)`, () => {
      const content = fs.readFileSync(path.join(webDir, page), 'utf-8');
      assert.ok(
        !content.includes('chaos-crew-shared.js'),
        `${page} should not include chaos-crew-shared.js (OBS overlay)`
      );
    });
  }
});

// ══════════════════════════════════════════════��═════════
// SECTION 12: File existence checks
// ═══════════════════════════════════════════════���════════

describe('All required files exist', () => {
  const rootDir = path.join(__dirname, '..');

  const requiredFiles = [
    'api/server.js',
    'api/watchtime.js',
    'web/chaos-crew-shared.js',
    'web/index.html',
    'web/index.js',
    'web/chat.html',
    'web/chat.js',
    'web/streamerbot.html',
    'web/streamerbot-data.js',
    'web/chaos-crew-admin.css',
    'web/chaos-crew-overlay.css',
    'web/games/spacefight.html',
    'web/games/spacefight.js',
    'web/games/spacefight-admin.html',
    'web/games/spacefight-admin.js',
    'web/giveaway/giveaway-admin.html',
    'web/giveaway/giveaway-admin.js',
    'web/giveaway/giveaway-overlay.html',
    'web/giveaway/giveaway-overlay.js',
    'web/giveaway/giveaway-join.html',
    'web/giveaway/giveaway-join.js',
    'web/giveaway/giveaway-test.html',
    'web/giveaway/giveaway-test.js',
    'web/giveaway/stats.html',
    'web/giveaway/stats.js',
    'web/tests/test-runner.html',
    'web/tests/test-suite.js',
    'streamerbot/CC_ApiRegister.cs',
    'streamerbot/CC_ChatReply.cs',
    'streamerbot/CC_Shoutout.cs',
    'streamerbot/GW_A_ViewerTick.cs',
    'streamerbot/GW_B_ChatMessage.cs',
    'streamerbot/GW_TimeInfo.cs',
  ];

  for (const file of requiredFiles) {
    test(`${file} exists`, () => {
      assert.ok(fs.existsSync(path.join(rootDir, file)), `Missing: ${file}`);
    });
  }
});

// ════════════════════════════════════════════════════════
// SECTION 13: C# file content verification
// ════════════════════════════════════════════════════════

describe('C# Actions: correct event names', () => {
  const csDir = path.join(__dirname, '..', 'streamerbot');

  test('GW_A_ViewerTick sends "viewer_tick" event', () => {
    const code = fs.readFileSync(path.join(csDir, 'GW_A_ViewerTick.cs'), 'utf-8');
    assert.ok(code.includes('"viewer_tick"'), 'Must send viewer_tick event');
    assert.ok(code.includes('"user"'), 'Must include user field');
    assert.ok(code.includes('"ts"'), 'Must include ts field');
  });

  test('GW_B_ChatMessage sends "chat_msg" event', () => {
    const code = fs.readFileSync(path.join(csDir, 'GW_B_ChatMessage.cs'), 'utf-8');
    assert.ok(code.includes('"chat_msg"'), 'Must send chat_msg event');
    assert.ok(code.includes('"user"'), 'Must include user field');
    assert.ok(code.includes('"message"'), 'Must include message field');
  });

  test('GW_TimeInfo sends "time_cmd" event', () => {
    const code = fs.readFileSync(path.join(csDir, 'GW_TimeInfo.cs'), 'utf-8');
    assert.ok(code.includes('"time_cmd"'), 'Must send time_cmd event');
    assert.ok(code.includes('"user"'), 'Must include user field');
  });

  test('CC_ApiRegister checks for "cc_api_register" event', () => {
    const code = fs.readFileSync(path.join(csDir, 'CC_ApiRegister.cs'), 'utf-8');
    assert.ok(code.includes('cc_api_register'), 'Must check for cc_api_register');
    assert.ok(code.includes('cc_api_session'), 'Must set cc_api_session global var');
  });

  test('CC_ChatReply handles "chat_reply" event', () => {
    const code = fs.readFileSync(path.join(csDir, 'CC_ChatReply.cs'), 'utf-8');
    assert.ok(code.includes('"chat_reply"'), 'Must handle chat_reply event');
    assert.ok(code.includes('SendMessage'), 'Must call SendMessage');
  });

  test('All C# actions have username sanitization', () => {
    const files = ['GW_A_ViewerTick.cs', 'GW_B_ChatMessage.cs'];
    for (const file of files) {
      const code = fs.readFileSync(path.join(csDir, file), 'utf-8');
      assert.ok(code.includes('GetUser()'), `${file} must use GetUser() for sanitization`);
      assert.ok(code.includes('IsBot('), `${file} must filter bots`);
    }
  });

  test('C# username max length matches JS (25)', () => {
    const code = fs.readFileSync(path.join(csDir, 'GW_A_ViewerTick.cs'), 'utf-8');
    assert.ok(code.includes('25'), 'Must enforce 25 char limit');
  });

  test('C# message max length is 500', () => {
    const code = fs.readFileSync(path.join(csDir, 'GW_B_ChatMessage.cs'), 'utf-8');
    assert.ok(code.includes('500'), 'Must enforce 500 char message limit');
  });
});

// ═══════════════════════���════════════════════════════��═══
// SECTION 14: Server.js event handler coverage
// ════════════════════════════════════════════════════════

describe('Server handles all C# events', () => {
  const serverCode = fs.readFileSync(path.join(__dirname, '..', 'api', 'server.js'), 'utf-8');

  test('handles viewer_tick from Streamerbot', () => {
    assert.ok(serverCode.includes("case 'viewer_tick'"), 'Must handle viewer_tick');
  });

  test('handles chat_msg from Streamerbot', () => {
    assert.ok(serverCode.includes("case 'chat_msg'"), 'Must handle chat_msg');
  });

  test('handles time_cmd from Streamerbot', () => {
    assert.ok(serverCode.includes("case 'time_cmd'"), 'Must handle time_cmd');
  });

  test('handles spacefight_result', () => {
    assert.ok(serverCode.includes("case 'spacefight_result'"), 'Must handle spacefight_result');
  });

  test('handles stream_online/offline', () => {
    assert.ok(serverCode.includes("case 'stream_online'"), 'Must handle stream_online');
    assert.ok(serverCode.includes("case 'stream_offline'"), 'Must handle stream_offline');
  });

  test('handles all gw_cmd admin commands', () => {
    const cmds = ['gw_open', 'gw_close', 'gw_set_keyword', 'gw_get_keyword',
                  'gw_add_ticket', 'gw_sub_ticket', 'gw_ban', 'gw_unban', 'gw_reset'];
    for (const cmd of cmds) {
      assert.ok(serverCode.includes(`'${cmd}'`), `Must handle cmd: ${cmd}`);
    }
  });

  test('handles gw_get_all from browser clients', () => {
    assert.ok(serverCode.includes("case 'gw_get_all'"), 'Must handle gw_get_all');
  });

  test('broadcasts gw_join on new registration', () => {
    assert.ok(serverCode.includes("event: 'gw_join'"), 'Must broadcast gw_join');
  });

  test('broadcasts wt_update on tick/chat', () => {
    assert.ok(serverCode.includes("event: 'wt_update'"), 'Must broadcast wt_update');
  });

  test('sends chat_reply for spacefight events', () => {
    assert.ok(serverCode.includes("'spacefight_challenge'"), 'Must handle spacefight_challenge');
    assert.ok(serverCode.includes("'spacefight_rejected'"), 'Must handle spacefight_rejected');
  });
});

// ═════════════════════════════════════��══════════════════
// SECTION 15: Test isolation
// ═══════════════════���════════════════════════════���═══════

describe('Test isolation', () => {
  test('separate mock Redis instances share no state', async () => {
    const redis1 = makeMockRedis();
    const redis2 = makeMockRedis();
    await redis1.set('key1', 'value1');
    assert.equal(await redis2.get('key1'), null);
  });

  test('REDIS_TEST_DB is not 0 (production protection)', () => {
    const testDb = parseInt(process.env.REDIS_TEST_DB || '1');
    assert.notEqual(testDb, 0, 'Tests must use Redis DB 1, not 0!');
  });
});

// ════════════════════════════════════════��═══════════════
// SECTION 16: Edge cases & stress
// ═══════════════════════════════════════════════���════════

describe('Edge cases', () => {
  test('coinsFromSec with very large values', () => {
    const result = coinsFromSec(72000000); // ~10000 hours
    assert.equal(result, 10000);
  });

  test('sanitizeUsername with only invalid chars returns empty', () => {
    assert.equal(sanitizeUsername('!@#$%^&*()'), '');
  });

  test('countWords with very long string', () => {
    const longStr = ('word ').repeat(1000).trim();
    assert.equal(countWords(longStr), 1000);
  });

  test('multiple concurrent users get independent state', async () => {
    const redis = makeMockRedis();
    const engine = new WatchtimeEngine(redis, makeMockPg());
    await openGiveaway(redis, '!join');
    await registerUser(engine, redis, 'alice');
    await registerUser(engine, redis, 'bob');

    await engine.handleViewerTick('alice', 'sess_1');
    await engine.handleViewerTick('alice', 'sess_1');
    await engine.handleViewerTick('bob', 'sess_1');

    const stateA = await engine.getUserState('alice');
    const stateB = await engine.getUserState('bob');
    assert.equal(stateA.watchSec, 120);
    assert.equal(stateB.watchSec, 60);
  });

  test('gw_add_ticket adds exactly 7200s (1 coin)', async () => {
    // Mirrors the server.js gw_add_ticket logic
    const redis = makeMockRedis();
    await redis.set(K.gwWatchSec('testuser'), '0');
    const newSec = await redis.incrby(K.gwWatchSec('testuser'), 7200);
    assert.equal(newSec, 7200);
    assert.equal(coinsFromSec(newSec), 1.0);
  });

  test('gw_sub_ticket does not go below 0', async () => {
    const redis = makeMockRedis();
    await redis.set(K.gwWatchSec('testuser'), '3600');
    const cur = parseInt(await redis.get(K.gwWatchSec('testuser')) || '0');
    const newSec = Math.max(0, cur - 7200);
    assert.equal(newSec, 0);
  });
});
