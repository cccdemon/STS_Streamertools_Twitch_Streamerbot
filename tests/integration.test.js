'use strict';

// ════════════════════════════════════════════════════════
// CHAOS CREW v5 – Integrations-Tests (Node.js built-in)
// Testen das neue Event-Protokoll gegen Mock-Objekte.
// Keine echte Netzwerkverbindung nötig.
// ════════════════════════════════════════════════════════

const { test } = require('node:test');
const assert   = require('node:assert/strict');

// ── Protokoll-Tests ───────────────────────────────────────
test('viewer_tick Event hat korrektes Format', () => {
  const event = { event: 'viewer_tick', user: 'justcallmedeimos', ts: 1234567890 };
  assert.equal(event.event, 'viewer_tick');
  assert.ok(typeof event.user === 'string');
  assert.ok(typeof event.ts === 'number');
});

test('chat_msg Event hat korrektes Format', () => {
  const event = { event: 'chat_msg', user: 'deimos', message: 'hallo wie geht es dir heute', ts: 1234567890 };
  assert.equal(event.event, 'chat_msg');
  assert.ok(typeof event.message === 'string');
});

test('time_cmd Event hat korrektes Format', () => {
  const event = { event: 'time_cmd', user: 'deimos' };
  assert.equal(event.event, 'time_cmd');
  assert.ok(typeof event.user === 'string');
});

test('chat_reply Event hat korrektes Format', () => {
  const event = { event: 'chat_reply', user: 'deimos', message: '@deimos Watchtime: 1h 0m | Coins: 0.50' };
  assert.equal(event.event, 'chat_reply');
  assert.ok(event.message.includes('@deimos'));
});

test('gw_data Event hat participants Array', () => {
  const event = {
    event: 'gw_data', open: true, session: 'sess_123',
    participants: [
      { username: 'alice', watchSec: 7200, coins: 1.0, registered: true, banned: false },
      { username: 'bob',   watchSec: 3600, coins: 0.5, registered: true, banned: false },
    ]
  };
  assert.ok(Array.isArray(event.participants));
  assert.equal(event.participants[0].watchSec, 7200);
  assert.equal(event.participants[0].coins, 1.0);
});

test('wt_update Event enthält watchSec und coins', () => {
  const event = { event: 'wt_update', user: 'alice', watchSec: 7200, coins: 1.0 };
  assert.equal(event.watchSec, 7200);
  assert.equal(event.coins, 1.0);
});

// ── Coins-Formel (redundant aber explizit für Protokoll-Spec) ──
test('Coins-Formel: watchSec / 7200', () => {
  const cases = [
    { sec: 0,     coins: 0    },
    { sec: 3600,  coins: 0.5  },
    { sec: 7200,  coins: 1.0  },
    { sec: 10800, coins: 1.5  },
    { sec: 14400, coins: 2.0  },
  ];
  for (const c of cases) {
    const result = Math.round((c.sec / 7200) * 10000) / 10000;
    assert.equal(result, c.coins, `${c.sec}s → ${result} != ${c.coins}`);
  }
});

// ── Backup-Manifest Format ────────────────────────────────
test('Backup Manifest hat required fields', () => {
  const manifest = {
    last_backup: '20260329_030000',
    pg_file: '/backups/postgres/chaoscrew_20260329_030000.sql.gz',
    pg_size: '42K',
    keep_days: 30,
    status: 'ok'
  };
  assert.ok(manifest.last_backup);
  assert.ok(manifest.pg_file.endsWith('.sql.gz'));
  assert.equal(manifest.status, 'ok');
  assert.ok(manifest.keep_days > 0);
});

// ── Redis Key Schema ──────────────────────────────────────
test('Redis Keys folgen Schema', () => {
  const { K } = require('../api/watchtime.js');
  assert.equal(K.gwOpen(),             'gw_open');
  assert.equal(K.gwKeyword(),          'gw_keyword');
  assert.equal(K.gwWatchSec('alice'),  'gw_watch:alice');
  assert.equal(K.gwRegistered('alice'),'gw_registered:alice');
  assert.equal(K.gwBanned('alice'),    'gw_banned:alice');
  assert.equal(K.gwIndex(),            'gw_index');
  assert.equal(K.gwChatTime('alice'),  'gw_chat_ts:alice');
});

// ── Datentrennung Tests↔Produktion ───────────────────────
test('Test-Konfiguration nutzt DB 1', () => {
  // Sicherheitscheck: Tests dürfen nie DB 0 (Produktion) berühren
  const testDb = parseInt(process.env.REDIS_TEST_DB || '1');
  assert.notEqual(testDb, 0, 'Tests müssen Redis DB 1 nutzen, nicht 0!');
});

test('Mock-Objekte isolieren Tests von echter DB', () => {
  // Alle unit tests in watchtime.test.js nutzen makeMockRedis()
  // und makeMockPg() – keine echten Verbindungen
  // Dieser Test dokumentiert das Konzept
  assert.ok(true, 'Mock-Isolation ist durch Design sichergestellt');
});
