/*
 * RDOC – Szenen-Layout (einzige Quelle aller Koordinaten)
 *
 * Diese Datei wird von ZWEI Seiten gelesen:
 *   1. scene.js im Browser – zeichnet Schilder, Kanten und Panels.
 *   2. tools/obs/build-collection.js – setzt die OBS-Quellen in genau
 *      diese Rechtecke.
 * Steht eine Zahl nur hier, koennen Rahmen und Quelle nicht auseinander-
 * laufen. Nie eine Koordinate in scene.js oder im Generator hart eintragen.
 *
 * Alle Angaben in Leinwand-Pixeln, Leinwand 2560x1440.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RDOC_LAYOUT = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var W = 2560;
  var H = 1440;

  // Reihenfolge = Standardreihenfolge in Cam-Block und Multi-Szenen.
  var ORDER = ['deimos', 'headwig', 'jericho', 'polder', 'jazzz'];
  var PEOPLE = {
    deimos:  { name: 'justcallmedeimos', short: 'Deimos',  role: 'Kommandant', scene: 'Deimos' },
    headwig: { name: 'Headwig',          short: 'Headwig', role: 'Crew',       scene: 'Headwig' },
    jericho: { name: 'Jericho',          short: 'Jericho', role: 'Crew',       scene: 'Jericho' },
    polder:  { name: 'HolderDiePolder',  short: 'Polder',  role: 'Crew',       scene: 'Polder' },
    jazzz:   { name: 'JazZz',            short: 'JazZz',   role: 'Crew',       scene: 'JazZz' }
  };

  function rect(x, y, w, h) { return { x: x, y: y, w: w, h: h }; }

  /* ── Cam-Block ────────────────────────────────────────────────
     Bedingung des Hochformat-Clips: alle fuenf Cams liegen geschlossen
     in EINEM 4:3-Rechteck. Geloest als 3x2-Raster: jede Zelle ist
     (w/3) x (w*3/8), also 8:9. Die grosse Cam belegt zwei Zellen und
     ist damit exakt 16:9; die vier anderen je eine. Zwei Reihen ergeben
     w * 3/4 Hoehe - der Block ist ohne Rest 4:3. */
  function camBlock(w, big) {
    big = big || 'deimos';
    var order = [big].concat(ORDER.filter(function (k) { return k !== big; }));
    var c = w / 3;
    var h = w * 3 / 8;
    return [
      { who: order[0], x: 0,     y: 0, w: 2 * c, h: h, big: true },
      { who: order[1], x: 2 * c, y: 0, w: c,     h: h },
      { who: order[2], x: 0,     y: h, w: c,     h: h },
      { who: order[3], x: c,     y: h, w: c,     h: h },
      { who: order[4], x: 2 * c, y: h, w: c,     h: h }
    ];
  }

  // Der Block ist in OBS eine eigene Baustein-Szene in dieser Groesse und
  // wird je Szene nur skaliert (Talk 1:1, Gaming 0.25).
  var BLOCK = { w: 1440, h: 1080 };

  /* ── Gaming / Spieler-Szene ───────────────────────────────────
     Spielbild vollflaechig. Cam-Block oben rechts deckend, Chat darunter
     und Fussleiste unten liegen halbtransparent ueber dem Spiel. */
  var GAMING = {
    block:  rect(2200, 0, 360, 270),
    chat:   rect(2200, 286, 360, 936),
    footer: rect(0, 1238, 2560, 202),
    ident:  rect(36, 1311, 500, 56),
    latest: rect(560, 1258, 500, 162),
    goal:   rect(1080, 1258, 440, 162),
    arena:  rect(1540, 1239, 640, 200)
  };

  /* ── Talk (alle fuenf Cams) ─────────────────────────────────── */
  var TALK = {
    block:  rect(80, 180, 1440, 1080),
    chat:   rect(1600, 236, 880, 704),
    latest: rect(1600, 964, 880, 296)
  };

  /* ── Talk solo / Vollbild-Cam ───────────────────────────────── */
  var SOLO = {
    plate: rect(80, 1180, 760, 180),
    chat:  rect(1760, 560, 720, 800)
  };

  /* ── Start / Pause / Ende ───────────────────────────────────── */
  var STILL = {
    chat:    rect(1700, 166, 740, 804),
    latest:  rect(1700, 1000, 740, 330),
    credits: rect(1400, 110, 1040, 1220)
  };

  /* ── Spiel-Kachel (Feed + Cam eines Spielers) ───────────────
     Eigene Baustein-Szene in Leinwandgroesse. Die Cam gehoert fest zum
     Spielbild und wandert mit, wenn die Kachel in Multi-Szenen
     verkleinert wird. */
  var TILE = { cam: rect(40, 1013, 688, 387) };

  /* ── Multi 3 / 4 / 5 ────────────────────────────────────────── */
  var MULTI = {
    multi3: {
      slots: [rect(0, 0, 1280, 720), rect(1280, 0, 1280, 720), rect(640, 720, 1280, 720)],
      who:   ['deimos', 'headwig', 'jericho'],
      chat:  rect(24, 800, 592, 616),
      ident: rect(1960, 770, 560, 56),
      latest: rect(1944, 870, 592, 240),
      goal:   rect(1944, 1134, 592, 282)
    },
    multi4: {
      slots: [rect(0, 0, 1280, 720), rect(1280, 0, 1280, 720), rect(0, 720, 1280, 720), rect(1280, 720, 1280, 720)],
      who:   ['deimos', 'headwig', 'jericho', 'polder'],
      ident: rect(1085, 692, 390, 56)
    },
    multi5: {
      slots: [rect(0, 240, 853, 480), rect(853, 240, 854, 480), rect(1707, 240, 853, 480),
              rect(0, 720, 853, 480), rect(853, 720, 854, 480)],
      who:   ['deimos', 'headwig', 'jericho', 'polder', 'jazzz'],
      chat:  rect(1723, 792, 821, 392),
      ident: rect(60, 88, 700, 64),
      latest: rect(60, 1222, 620, 196),
      goal:   rect(720, 1222, 620, 196),
      arena:  rect(1860, 1220, 640, 200)
    }
  };

  /* ── Chat-Quellen ─────────────────────────────────────────────
     chat.html ist auf 14-px-Schrift gebaut. Statt die Seite zu zoomen,
     bekommt jede Chat-Flaeche eine eigene Browserquelle in verkleinerter
     Groesse, die OBS um den Faktor k hochzieht. k bestimmt also die
     Schriftgroesse im Bild (14 px * k). */
  var CHATS = {
    spalte: { area: GAMING.chat,       k: 1.5 },
    talk:   { area: TALK.chat,         k: 1.9 },
    solo:   { area: SOLO.chat,         k: 1.9 },
    still:  { area: STILL.chat,        k: 1.9 },
    multi3: { area: MULTI.multi3.chat, k: 1.6 },
    multi5: { area: MULTI.multi5.chat, k: 1.5 }
  };
  function chatSource(key) {
    var c = CHATS[key];
    return { w: Math.round(c.area.w / c.k), h: Math.round(c.area.h / c.k), k: c.k, area: c.area };
  }

  return {
    W: W, H: H, ORDER: ORDER, PEOPLE: PEOPLE, BLOCK: BLOCK,
    GAMING: GAMING, TALK: TALK, SOLO: SOLO, STILL: STILL, TILE: TILE, MULTI: MULTI, CHATS: CHATS,
    camBlock: camBlock, chatSource: chatSource
  };
});
