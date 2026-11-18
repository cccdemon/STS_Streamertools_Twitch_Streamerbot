'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseTrackQuery, pickTrack, describeTrack, computeEta, formatEta } = require('../twitch/spotify.js');
const { WindowLimit, SongRequests, playlistName, streamSession } = require('../twitch/songrequest.js');

test('parseTrackQuery erkennt Track-Links und URIs', () => {
  assert.deepEqual(
    parseTrackQuery('https://open.spotify.com/intl-de/track/4uLU6hMCjMI75M1A2tKUQC?si=abc'),
    { uri: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC' },
  );
  assert.deepEqual(parseTrackQuery('spotify:track:4uLU6hMCjMI75M1A2tKUQC'), { uri: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC' });
});

test('parseTrackQuery nimmt sonst den Text als Suche, leer ist null', () => {
  assert.deepEqual(parseTrackQuery('  Daft Punk   One More Time '), { query: 'Daft Punk One More Time' });
  assert.equal(parseTrackQuery('   '), null);
  assert.equal(parseTrackQuery(undefined), null);
  assert.equal(parseTrackQuery('x'.repeat(300)).query.length, 100);
});

const t = (name, explicit) => ({ uri: `spotify:track:${name}`, name, explicit, artists: [{ name: 'A' }, { name: 'B' }] });

test('pickTrack nimmt den ersten nicht expliziten Treffer', () => {
  assert.equal(pickTrack([t('x', true), t('y', false)], false).name, 'y');
  assert.equal(pickTrack([t('x', true)], false), null);
  assert.equal(pickTrack([t('x', true)], true).name, 'x');
  assert.equal(pickTrack([], false), null);
});

test('describeTrack: Titel und Interpreten', () => {
  assert.equal(describeTrack(t('Song', false)), '„Song“ von A, B');
});

test('WindowLimit: drei Wuensche je Zuschauer in zwei Minuten', () => {
  const lim = new WindowLimit(3, 120_000);
  assert.equal(lim.take('u', 0), 0);
  assert.equal(lim.take('u', 1000), 0);
  assert.equal(lim.take('u', 2000), 0);
  assert.equal(lim.take('u', 3000), 117_000);
  assert.equal(lim.take('v', 3000), 0);
  assert.equal(lim.take('u', 120_000), 0);
});

const q = (id, min) => ({ uri: `spotify:track:${id}`, duration_ms: min * 60_000 });

test('computeEta: Restzeit des laufenden Titels plus alles davor', () => {
  const eta = computeEta(60_000, 240_000, [q('a', 3), q('b', 2), q('wunsch', 4)], 'spotify:track:wunsch');
  assert.deepEqual(eta, { position: 3, etaMs: 180_000 + 300_000 });
});

test('computeEta: als Naechstes = nur die Restzeit; nicht gefunden = null', () => {
  assert.deepEqual(computeEta(200_000, 240_000, [q('wunsch', 3)], 'spotify:track:wunsch'), { position: 1, etaMs: 40_000 });
  assert.equal(computeEta(0, 240_000, [q('a', 3)], 'spotify:track:wunsch'), null);
});

test('formatEta: gleich, Minuten, Stunden', () => {
  assert.equal(formatEta(40_000), 'gleich');
  assert.equal(formatEta(7 * 60_000 + 20_000), 'in etwa 7 Minuten');
  assert.equal(formatEta(90_000), 'in etwa 2 Minuten');
  assert.equal(formatEta(75 * 60_000), 'in etwa 1 Std. 15 Min.');
});

test('playlistName: Streamtitel_Datum, Titel gekuerzt, leerer Titel faellt zurueck', () => {
  const d = new Date('2026-11-09T19:30:00Z');
  assert.equal(playlistName('Star Citizen: Kraken-Jagd', d), 'Star Citizen: Kraken-Jagd_09.11.2026');
  assert.equal(playlistName('', d), 'RDOC Stream_09.11.2026');
  assert.equal(playlistName('x'.repeat(200), d).length, 80 + '_09.11.2026'.length);
});

test('streamSession: live = Stream-ID, offline = Tag', () => {
  const now = new Date('2026-11-09T23:30:00Z'); // in Berlin schon der 10.
  assert.deepEqual(
    streamSession({ id: '123', title: 'Live', started_at: '2026-11-09T18:00:00Z' }, 'Kanaltitel', now),
    { key: 'stream:123', title: 'Live', date: new Date('2026-11-09T18:00:00Z') },
  );
  assert.deepEqual(streamSession(null, 'Kanaltitel', now), { key: 'tag:10.11.2026', title: 'Kanaltitel', date: now });
});

const chat = (text) => ({ message: { text }, chatter_user_id: '1', chatter_user_login: 'pilot', chatter_user_name: 'Pilot' });

test('SongRequests.handle: nur !sr, !songrequest und !song', () => {
  const said = [];
  const sr = new SongRequests({ getBroadcaster: () => null, say: async (m) => { said.push(m); } });
  assert.equal(sr.handle(chat('hallo zusammen')), false);
  assert.equal(sr.handle(chat('!srx test')), false);
  assert.equal(sr.handle(chat('!sr Daft Punk')), true);
  assert.equal(sr.handle(chat('!SongRequest Daft Punk')), true);
  assert.equal(sr.handle(chat('!song')), true);
});

test('!sr ohne Spotify-Verbindung antwortet statt zu schweigen', async () => {
  const said = [];
  const sr = new SongRequests({ getBroadcaster: () => null, say: async (m) => { said.push(m); } });
  await sr.request(chat('!sr Daft Punk'), ' Daft Punk');
  assert.deepEqual(said, ['@Pilot Songwünsche sind gerade nicht verfügbar.']);
});
