'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { formatSince, formatGoals, formatKraken, ChatCommands } = require('../twitch/commands.js');
const { ChatReplies, Cooldown, firstWord, sanitizeName } = require('../twitch/replies.js');

test('firstWord: erstes Wort klein, auch mit Tab/Mehrfachleerzeichen', () => {
  assert.equal(firstWord('  !WoW   hallo'), '!wow');
  assert.equal(firstWord('!ziele\tx'), '!ziele');
  assert.equal(firstWord('   '), null);
  assert.equal(firstWord(undefined), null);
});

test('sanitizeName: behaelt Umlaute und Unterstrich, wirft Sonderzeichen raus', () => {
  assert.equal(sanitizeName('Jörg_42<script>'), 'Jörg_42script');
  assert.equal(sanitizeName('a'.repeat(40)).length, 25);
});

test('Cooldown: zweiter Aufruf innerhalb der Sperre liefert Restzeit', () => {
  const c = new Cooldown(30_000);
  assert.equal(c.take('k', 1_000), 0);
  assert.equal(c.take('k', 11_000), 20_000);
  assert.equal(c.take('k', 31_000), 0);
  assert.equal(c.take('anderer', 11_000), 0);
});

test('formatSince: Kalenderdifferenz mit Plural', () => {
  const now = new Date(2026, 10, 8);
  assert.equal(formatSince(new Date(2024, 7, 3).toISOString(), now), 'seit 2 Jahren, 3 Monaten, 5 Tagen');
  assert.equal(formatSince(new Date(2025, 10, 7).toISOString(), now), 'seit 1 Jahr, 1 Tag');
  assert.equal(formatSince(now.toISOString(), now), 'seit heute');
  assert.equal(formatSince('kaputt', now), '');
});

test('formatGoals: nur Abo-Ziele, mit Beschreibung und Rest', () => {
  const out = formatGoals([
    { type: 'follower', current_amount: 10, target_amount: 20, description: 'Follower' },
    { type: 'subscription_count', current_amount: 37, target_amount: 50, description: 'Neue Kamera' },
  ]);
  assert.equal(out, 'Abo-Ziel „Neue Kamera“: 37 / 50 (74 %), noch 13');
});

test('formatGoals: erreicht und ohne Beschreibung', () => {
  assert.equal(
    formatGoals([{ type: 'subscription', current_amount: 60, target_amount: 50, description: '' }]),
    'Abo-Ziel: 60 / 50 (100 %), Ziel erreicht!',
  );
});

test('formatGoals: kein Abo-Ziel aktiv', () => {
  assert.equal(formatGoals([]), 'Gerade läuft kein Abo-Ziel.');
  assert.equal(formatGoals(undefined), 'Gerade läuft kein Abo-Ziel.');
  assert.equal(formatGoals([{ type: 'follower', current_amount: 1, target_amount: 2 }]), 'Gerade läuft kein Abo-Ziel.');
});

test('formatKraken: Stand unter dem Ziel', () => {
  const out = formatKraken(12345.67, 100000);
  assert.match(out, /^Ab 100\.000 € Jahresgewinn verlosen wir eine Drake Kraken\./);
  assert.match(out, /12\.345,67 € \/ 100\.000 € \(12,3 %\)/);
  assert.match(out, /financial\.raumdock\.org\/financial\/year$/);
});

test('formatKraken: Ziel erreicht', () => {
  assert.match(formatKraken(100000, 100000), /die Drake Kraken wird verlost!/);
});

test('formatKraken: Verlust zaehlt als 0 %', () => {
  assert.match(formatKraken(-500, 100000), /\(0 %\)/);
});

test('ChatReplies: !wow antwortet einmal, zweites Mal gesperrt', async () => {
  const said = [];
  const r = new ChatReplies({
    replies: [{ commands: ['!wow'], message: 'Gilde' }, { commands: ['!aus'], message: '' }],
    say: async (m) => { said.push(m); },
  });
  assert.deepEqual(r.names(), ['!wow']);
  assert.equal(r.handle('!WOW'), true);
  assert.equal(r.handle('!wow'), true);
  assert.equal(r.handle('!aus'), false);
  assert.equal(r.handle('hallo !wow'), false);
  await new Promise((res) => setImmediate(res));
  assert.deepEqual(said, ['Gilde']);
});

test('ChatCommands: erkennt nur eigene Befehle', () => {
  const c = new ChatCommands({ getBroadcaster: () => null, say: async () => {}, krakenTarget: 100000 });
  assert.equal(c.handle({ message: { text: '!fight @x' } }), false);
  assert.deepEqual(c.names(), ['!followage', '!ziele', '!kraken']);
});

test('ChatCommands: !followage im eigenen Kanal ohne Helix', async () => {
  const said = [];
  const c = new ChatCommands({
    getBroadcaster: () => ({ id: '1', login: 'kanal' }),
    say: async (m) => { said.push(m); },
    krakenTarget: 100000,
  });
  await c.followage({ chatter_user_id: '1', chatter_user_name: 'Kanal' });
  assert.deepEqual(said, ['@Kanal das hier ist dein eigener Kanal.']);
});
