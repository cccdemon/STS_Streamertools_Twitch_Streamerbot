'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { WishPlayer } = require('../twitch/wishplayer.js');

// Nachgebautes Spotify: ein laufender Titel, Aufrufe werden mitgeschrieben.
function rig({ context = null, queue = [] } = {}) {
  const calls = [];
  const sp = { uri: 'spotify:track:radio', duration: 200_000, progress: 0, playing: true, context };
  let saved = null;
  let clock = 0;
  const api = {
    player: async () => {
      calls.push('player');
      return { is_playing: sp.playing, progress_ms: sp.progress, item: { uri: sp.uri, duration_ms: sp.duration }, context: sp.context ? { uri: sp.context } : null };
    },
    queue: async () => ({ queue }),
    playUris: async (uris) => {
      calls.push(`play:${uris[0]}`);
      sp.uri = uris[0]; sp.progress = 0; sp.duration = 180_000; sp.context = null;
    },
    playContext: async (uri, offset) => {
      calls.push(`context:${uri}:${offset}`);
      sp.uri = offset || 'spotify:track:first'; sp.progress = 0; sp.context = uri;
    },
  };
  const wp = new WishPlayer({ api, load: () => saved, save: async (s) => { saved = JSON.parse(JSON.stringify(s)); }, now: () => clock });
  return { wp, sp, calls, state: () => saved, advance: (ms) => { clock += ms; } };
}
const wish = (id, user = 'pilot') => ({ uri: `spotify:track:${id}`, title: id, artists: 'A', user, durationMs: 180_000 });

test('ohne Wuensche wird Spotify nicht gefragt', async () => {
  const r = rig();
  await r.wp.tick();
  assert.deepEqual(r.calls, []);
});

test('Wunsch wartet bis kurz vor Titelende und startet dann selbst', async () => {
  const r = rig();
  assert.equal(await r.wp.add(wish('a')), 1);
  r.sp.progress = 100_000;
  await r.wp.tick();
  assert.deepEqual(r.calls, ['player']);
  r.sp.progress = 197_000;
  await r.wp.tick();
  assert.equal(r.calls.at(-1), 'play:spotify:track:a');
  assert.equal(r.state().pending.length, 0);
  assert.equal(r.state().active.title, 'a');
});

test('mehrere Wuensche laufen in Reihenfolge, keiner geht verloren', async () => {
  const r = rig();
  await r.wp.add(wish('a'));
  await r.wp.add(wish('b'));
  assert.equal(await r.wp.add(wish('c')), 3);
  const played = [];
  for (let i = 0; i < 400 && played.length < 3; i += 1) {
    r.advance(1500);
    r.sp.progress += 1500;
    const before = r.calls.length;
    await r.wp.tick();
    for (const c of r.calls.slice(before)) if (c.startsWith('play:')) played.push(c.slice(5));
  }
  assert.deepEqual(played, ['spotify:track:a', 'spotify:track:b', 'spotify:track:c']);
});

test('pausiert: nichts wird von selbst gestartet', async () => {
  const r = rig();
  await r.wp.add(wish('a'));
  r.sp.progress = 199_000;
  r.sp.playing = false;
  await r.wp.tick();
  assert.deepEqual(r.calls, ['player']);
  assert.equal(r.state().pending.length, 1);
});

test('scheitert der Start, bleibt der Wunsch offen', async () => {
  const r = rig();
  await r.wp.add(wish('a'));
  r.sp.progress = 199_000;
  r.wp.api.playUris = async () => { throw new Error('spotify 502'); };
  await r.wp.tick();
  assert.equal(r.state().pending.length, 1);
  assert.equal(r.state().active, null);
});

test('nach dem letzten Wunsch zurueck in die Playlist, beim naechsten Titel', async () => {
  const r = rig({ context: 'spotify:playlist:p', queue: [{ uri: 'spotify:track:next' }] });
  await r.wp.add(wish('a'));
  r.sp.progress = 198_000;
  await r.wp.tick();
  assert.deepEqual(r.state().resume, { contextUri: 'spotify:playlist:p', nextUri: 'spotify:track:next' });
  r.advance(6000);
  r.sp.progress = 6000;
  await r.wp.tick(); // merkt sich den laufenden Wunsch
  r.advance(172_000);
  r.sp.progress = 178_000;
  await r.wp.tick();
  assert.equal(r.calls.at(-1), 'context:spotify:playlist:p:spotify:track:next');
  assert.deepEqual(r.state(), { pending: [], active: null, resume: null });
});

test('Wunsch uebersprungen: der naechste startet am Ende des jetzt laufenden Titels', async () => {
  const r = rig();
  await r.wp.add(wish('a'));
  await r.wp.add(wish('b'));
  r.sp.progress = 198_000;
  await r.wp.tick(); // a startet
  r.advance(6000); r.sp.progress = 6000;
  await r.wp.tick();
  r.sp.uri = 'spotify:track:autoplay'; r.sp.progress = 2000; r.sp.duration = 100_000; // Streamer skippt
  r.advance(3000);
  await r.wp.tick();
  assert.equal(r.state().active, null);
  assert.equal(r.calls.filter((c) => c.startsWith('play:')).length, 1);
  r.advance(96_000); r.sp.progress = 98_000;
  await r.wp.tick();
  assert.equal(r.calls.at(-1), 'play:spotify:track:b');
});

test('Wunsch lief aus und Spotify steht: der naechste startet trotzdem', async () => {
  const r = rig();
  await r.wp.add(wish('a'));
  await r.wp.add(wish('b'));
  r.sp.progress = 198_000;
  await r.wp.tick();
  r.advance(6000); r.sp.progress = 6000;
  await r.wp.tick();
  r.advance(200_000); r.sp.progress = 0; r.sp.playing = false; // Ende verpasst, kein Autoplay
  await r.wp.tick();
  assert.equal(r.calls.at(-1), 'play:spotify:track:b');
});

test('etaMs: Rest des laufenden Titels plus die Wuensche davor', async () => {
  const r = rig();
  await r.wp.add(wish('a'));
  await r.wp.add(wish('b'));
  const player = { item: { duration_ms: 200_000 }, progress_ms: 140_000 };
  assert.equal(r.wp.etaMs(player, 1), 60_000);
  assert.equal(r.wp.etaMs(player, 2), 60_000 + 180_000);
});
