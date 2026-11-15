'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeEvent, summarize } = require('../session.js');

test('normalizeEvent: nimmt bekannte Typen und saeubert', () => {
  const e = normalizeEvent({ type: 'CHEER', user: ' Nova<script> ', amount: '500' }, 42);
  assert.deepEqual(e, { type: 'cheer', user: 'Novascript', amount: 500, ts: 42 });
});

test('normalizeEvent: verwirft unbekannte Typen und leere Namen', () => {
  assert.equal(normalizeEvent({ type: 'redeem', user: 'a' }), null);
  assert.equal(normalizeEvent({ type: 'follow', user: '<>' }), null);
  assert.equal(normalizeEvent(null), null);
});

test('normalizeEvent: Betrag bleibt in Grenzen', () => {
  assert.equal(normalizeEvent({ type: 'cheer', user: 'a', amount: -5 }).amount, 0);
  assert.equal(normalizeEvent({ type: 'cheer', user: 'a', amount: 1e12 }).amount, 1e7);
});

test('summarize: latest zeigt das juengste Ereignis je Art', () => {
  const s = summarize([
    { type: 'follow', user: 'A' },
    { type: 'follow', user: 'B' },
    { type: 'sub', user: 'C' },
    { type: 'subbomb', user: 'D', amount: 5 },
    { type: 'cheer', user: 'E', amount: 100 },
    { type: 'raid', user: 'F', amount: 42 },
  ]);
  assert.deepEqual(s.latest.follow, { user: 'B' });
  assert.deepEqual(s.latest.sub, { user: 'D' });
  assert.deepEqual(s.latest.cheer, { user: 'E', amount: 100 });
  assert.deepEqual(s.latest.raid, { user: 'F', amount: 42 });
});

test('summarize: Credits ohne Dubletten, Betraege summiert', () => {
  const s = summarize([
    { type: 'follow', user: 'A' },
    { type: 'follow', user: 'a' },
    { type: 'cheer', user: 'E', amount: 100 },
    { type: 'cheer', user: 'e', amount: 50 },
    { type: 'subgift', user: 'G' },
    { type: 'subbomb', user: 'G', amount: 5 },
    { type: 'resub', user: 'C' },
  ]);
  assert.deepEqual(s.credits.follow, ['A']);
  assert.deepEqual(s.credits.cheer, [{ user: 'E', amount: 150 }]);
  assert.deepEqual(s.credits.gift, [{ user: 'G', amount: 6 }]);
  assert.deepEqual(s.credits.sub, ['C']);
});

test('summarize: leere und kaputte Eingaben', () => {
  const s = summarize([null, { type: 'x', user: 'a' }, { type: 'follow' }]);
  assert.deepEqual(s.latest, { follow: null, sub: null, cheer: null, raid: null });
  assert.deepEqual(summarize(undefined).credits.follow, []);
});
