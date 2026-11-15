'use strict';

// node --test tests/layout.test.js   (aus services/gamescenes/)
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../public/rdoc-layout.js');

const inside = (r, w = L.W, h = L.H) => r.x >= 0 && r.y >= 0 && r.x + r.w <= w + 1e-9 && r.y + r.h <= h + 1e-9;
const overlap = (a, b) => a.x < b.x + b.w - 1e-9 && b.x < a.x + a.w - 1e-9 && a.y < b.y + b.h - 1e-9 && b.y < a.y + a.h - 1e-9;

test('Cam-Block ist exakt 4:3 und lueckenlos gefuellt', () => {
  for (const w of [360, 1080, 1440]) {
    const cells = L.camBlock(w);
    const h = w * 3 / 4;
    assert.equal(cells.length, 5);
    const area = cells.reduce((s, c) => s + c.w * c.h, 0);
    assert.ok(Math.abs(area - w * h) < 1e-6, 'Flaeche deckt den Block');
    for (const c of cells) assert.ok(inside(c, w, h), `Zelle ${c.who} liegt im Block`);
    for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) assert.ok(!overlap(cells[i], cells[j]));
  }
});

test('Grosse Cam ist 16:9, die anderen vier sind gleich gross', () => {
  const cells = L.camBlock(L.BLOCK.w);
  assert.ok(Math.abs(cells[0].w / cells[0].h - 16 / 9) < 1e-9);
  const rest = cells.slice(1);
  for (const c of rest) { assert.equal(c.w, rest[0].w); assert.equal(c.h, rest[0].h); }
  assert.ok(rest[0].w * rest[0].h * 2 === cells[0].w * cells[0].h, 'grosse Cam = zwei Zellen');
});

test('Jede Person kann gross sein, alle fuenf bleiben im Block', () => {
  for (const big of L.ORDER) {
    const cells = L.camBlock(360, big);
    assert.equal(cells[0].who, big);
    assert.deepEqual(cells.map((c) => c.who).sort(), [...L.ORDER].sort());
  }
});

test('Block-Szene und Platzierungen sind 4:3', () => {
  assert.equal(L.BLOCK.w / L.BLOCK.h, 4 / 3);
  assert.equal(L.GAMING.block.w / L.GAMING.block.h, 4 / 3);
  assert.equal(L.TALK.block.w / L.TALK.block.h, 4 / 3);
});

test('Gaming: Block, Chat und Fussleiste liegen im Bild und ueberlappen nicht', () => {
  const G = L.GAMING;
  for (const k of ['block', 'chat', 'footer', 'ident', 'latest', 'goal', 'arena']) assert.ok(inside(G[k]), k);
  assert.ok(!overlap(G.block, G.chat));
  assert.ok(!overlap(G.chat, G.footer));
  for (const k of ['ident', 'latest', 'goal', 'arena']) assert.ok(inside({ ...G[k], x: G[k].x - G.footer.x, y: G[k].y - G.footer.y }, G.footer.w, G.footer.h), `${k} in der Fussleiste`);
  assert.ok(!overlap(G.latest, G.goal) && !overlap(G.goal, G.arena) && !overlap(G.ident, G.latest));
  assert.deepEqual([G.arena.w, G.arena.h], [640, 200], 'Arena hat das Spacefight-Feldmass');
});

test('Multi: Felder liegen im Bild, ueberlappen nicht, Standardbelegung passt', () => {
  for (const key of Object.keys(L.MULTI)) {
    const M = L.MULTI[key];
    assert.equal(M.slots.length, M.who.length);
    assert.equal(new Set(M.who).size, M.who.length);
    M.slots.forEach((r) => {
      assert.ok(inside(r), `${key} Feld`);
      assert.ok(Math.abs(r.w / r.h - 16 / 9) < 0.01, `${key} Feld ist 16:9`);
    });
    for (let i = 0; i < M.slots.length; i++) for (let j = i + 1; j < M.slots.length; j++) assert.ok(!overlap(M.slots[i], M.slots[j]));
    for (const k of ['chat', 'latest', 'goal', 'arena']) {
      if (!M[k]) continue;
      assert.ok(inside(M[k]), `${key} ${k}`);
      M.slots.forEach((r) => assert.ok(!overlap(r, M[k]), `${key} ${k} verdeckt kein Feld`));
    }
  }
});

test('Chat-Quellen: Groesse mal Faktor ergibt die Flaeche', () => {
  for (const key of Object.keys(L.CHATS)) {
    const c = L.chatSource(key);
    assert.ok(inside(c.area), key);
    assert.ok(Math.abs(c.w * c.k - c.area.w) <= c.k && Math.abs(c.h * c.k - c.area.h) <= c.k, key);
    assert.ok(c.w >= 200, `${key}: Quelle breit genug fuer chat.html`);
  }
});

test('Kachel-Cam liegt im Bild und ist 16:9', () => {
  assert.ok(inside(L.TILE.cam));
  assert.ok(Math.abs(L.TILE.cam.w / L.TILE.cam.h - 16 / 9) < 0.01);
});
