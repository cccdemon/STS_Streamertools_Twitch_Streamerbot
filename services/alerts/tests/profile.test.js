'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const {
  buildProfile, buildAchievements, buildStatusLine,
  formatWatchtime, watchtimeRank, formatFollowage, tierLabel,
} = require('../profile.js');

test('formatWatchtime: minutes / hours / days', () => {
  assert.equal(formatWatchtime(0), '0m');
  assert.equal(formatWatchtime(59), '0m');
  assert.equal(formatWatchtime(60), '1m');
  assert.equal(formatWatchtime(3600), '1h 0m');
  assert.equal(formatWatchtime(3660), '1h 1m');
  assert.equal(formatWatchtime(90000), '1d 1h');   // 25h
});

test('watchtimeRank tiers by hours', () => {
  assert.equal(watchtimeRank(0).label, 'Frischling');
  assert.equal(watchtimeRank(3600).label, 'Stammgast');       // 1h
  assert.equal(watchtimeRank(10 * 3600).label, 'Veteran');
  assert.equal(watchtimeRank(50 * 3600).label, 'Urgestein');
  assert.equal(watchtimeRank(150 * 3600).label, 'Legende');
});

test('formatFollowage: null when unknown, scales tage/monate/jahre', () => {
  assert.equal(formatFollowage(0), null);
  assert.equal(formatFollowage(1), '1 Tag');
  assert.equal(formatFollowage(5), '5 Tage');
  assert.equal(formatFollowage(60), '2 Monate');
  assert.equal(formatFollowage(400), '1 Jahr 1 Mon');
});

test('tierLabel maps twitch tier codes', () => {
  assert.equal(tierLabel('1000'), 'Tier 1');
  assert.equal(tierLabel('2000'), 'Tier 2');
  assert.equal(tierLabel('3000'), 'Tier 3');
  assert.equal(tierLabel(undefined), 'Tier 1');
});

test('buildAchievements: always a watchtime rank, plus earned badges', () => {
  const a = buildAchievements({
    watchSec: 60 * 3600, isSub: true, subMonths: 7,
    giveawayWins: 2, sfWins: 3, sfLosses: 1, haulPoints: 6000, haulRank: 'Frachtprofi',
    bitsTotal: 500, followageDays: 400,
  });
  const labels = a.map((x) => x.label);
  assert.equal(a[0].label, 'Urgestein');                  // watchtime rank first
  assert.ok(labels.some((l) => l.startsWith('Abonnent')));
  assert.ok(labels.includes('2× Giveaway-Sieger'));
  assert.ok(labels.includes('Raumkampf 3–1'));
  assert.ok(labels.includes('Hauling: Frachtprofi'));
  assert.ok(labels.includes('500 Bits gespendet'));
  assert.ok(labels.includes('Über 1 Jahr Follower'));
});

test('buildAchievements: newcomer only has the rank badge', () => {
  const a = buildAchievements({ watchSec: 0 });
  assert.equal(a.length, 1);
  assert.equal(a[0].label, 'Frischling');
});

test('buildStatusLine: highest matching tier wins', () => {
  assert.equal(buildStatusLine({ watchSec: 60 * 3600, isSub: true }), 'Rückgrat der Crew — aktiver Abonnent und Dauergast.');
  assert.equal(buildStatusLine({ watchSec: 0, isSub: true }), 'Treues Crewmitglied mit Abo-Abzeichen.');
  assert.equal(buildStatusLine({ watchSec: 60 * 3600 }), 'Urgestein der Community — fast immer an Bord.');
  assert.equal(buildStatusLine({ watchSec: 12 * 3600 }), 'Aktiver Member der Community.');
  assert.equal(buildStatusLine({ watchSec: 0, giveawayWins: 1 }), 'Bekanntes Gesicht in den Crew-Games.');
  assert.equal(buildStatusLine({ watchSec: 0, followageDays: 40 }), 'Etabliertes Crewmitglied.');
  assert.equal(buildStatusLine({ watchSec: 0 }), 'Neu an Bord — willkommen, Pilot!');
});

test('buildProfile: full payload shape', () => {
  const p = buildProfile({
    login: 'CargoKid', user: 'CargoKid', avatar: 'http://x/a.png',
    followageDays: 200, isSub: true, subTier: '2000', subMonths: 5,
    bitsTotal: 1500, watchSec: 12 * 3600, coins: 6, giveawayWins: 1,
    msgs: 340, sfWins: 4, sfLosses: 2, haulPoints: 3000, haulRank: 'Kurierfahrer',
  });
  assert.equal(p.alertType, 'profile');
  assert.equal(p.login, 'cargokid');                 // lowercased
  assert.equal(p.user, 'CargoKid');
  assert.equal(p.watchtimeStr, '12h 0m');
  assert.equal(p.followageStr, '6 Monate');
  assert.ok(Array.isArray(p.fields) && p.fields.length >= 8);
  const sub = p.fields.find((f) => f.label === 'ABONNENT');
  assert.equal(sub.value, 'Ja · Tier 2 · 5 Mon');
  const hauling = p.fields.find((f) => f.label === 'HAULING');
  assert.equal(hauling.value, 'Kurierfahrer');
  assert.ok(p.statusLine.length > 0);
});

test('buildProfile: missing data degrades to dashes / Nein', () => {
  const p = buildProfile({ login: 'newbie' });
  const get = (l) => p.fields.find((f) => f.label === l).value;
  assert.equal(get('ABONNENT'), 'Nein');
  assert.equal(get('FOLLOWER SEIT'), '—');
  assert.equal(get('BITS GESPENDET'), '—');
  assert.equal(p.statusLine, 'Neu an Bord — willkommen, Pilot!');
});
