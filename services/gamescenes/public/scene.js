// ════════════════════════════════════════════════════════
// RDOC – Szenen-Rahmen
//
// scene.html?s=<szene>[&p=<person>][&l=<kennung>][&min=<minuten>][&demo=1]
//
//   gaming | player   Schilder auf dem Cam-Block (p = grosse Cam)
//   footer            Fussleiste: Signet, Zuletzt, Ziel (l = Kennung)
//   talk              Hintergrund-Sterne, Schilder, Zuletzt
//   solo | cam        Eckmarken und Namensschild (p = Person)
//   tile              Kante und Schild der Spiel-Kachel (p = Person)
//   multi3|4|5        Signet und Panels der Multi-Szenen
//   start|pause|ende  Standbilder, deckend
//
// Alle Koordinaten kommen aus rdoc-layout.js. Hier steht keine.
// Texte gehen ausschliesslich ueber textContent ins DOM: Namen aus der
// Session-API stammen von Zuschauern.
// ════════════════════════════════════════════════════════
(function () {
  'use strict';

  var L = window.RDOC_LAYOUT;
  var q = new URLSearchParams(location.search);
  var S = (q.get('s') || 'gaming').toLowerCase();
  var P = L.PEOPLE[(q.get('p') || '').toLowerCase()] ? q.get('p').toLowerCase() : 'deimos';
  var DEMO = q.get('demo') === '1';
  var root = document.getElementById('root');
  var SIGNET = document.getElementById('signet').innerHTML;

  function fit() { document.documentElement.style.setProperty('--sc-fit', window.innerWidth / L.W); }
  fit();
  window.addEventListener('resize', fit);

  // ── DOM-Helfer ──────────────────────────────────────────
  function el(cls, r, text, parent) {
    var d = document.createElement('div');
    d.className = cls;
    if (r) {
      d.style.left = r.x + 'px'; d.style.top = r.y + 'px';
      if (r.w != null) d.style.width = r.w + 'px';
      if (r.h != null) d.style.height = r.h + 'px';
    }
    if (text != null) d.textContent = text;
    (parent || root).appendChild(d);
    return d;
  }
  function child(parent, tag, cls, text) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (text != null) d.textContent = text;
    parent.appendChild(d);
    return d;
  }
  function shift(r, dx, dy) { return { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h }; }
  function scaleRect(r, k, ox, oy) { return { x: ox + r.x * k, y: oy + r.y * k, w: r.w * k, h: r.h * k }; }

  function ident(r, label, cls) {
    var size = r.h;
    var d = el('ident ' + (cls || ''), { x: r.x, y: r.y, w: r.w, h: size });
    var s = child(d, 'span', 'signet');
    s.style.width = size + 'px'; s.style.height = size + 'px';
    s.innerHTML = SIGNET; // statisches Markup aus dem <template>, keine Fremddaten
    child(d, 'span', '', 'RDOC // ' + label);
    return d;
  }

  function ticks(r) {
    var t = 26;
    [[0, 0, '2px 0 0 2px'], [r.w - t, 0, '2px 2px 0 0'], [0, r.h - t, '0 0 2px 2px'], [r.w - t, r.h - t, '0 2px 2px 0']]
      .forEach(function (c) { el('tick', { x: r.x + c[0], y: r.y + c[1] }).style.borderWidth = c[2]; });
  }

  // Namensschild unten links in einer Cam-Zelle. Schriftgroesse folgt der
  // Zelle, mit Untergrenze: im Gaming-Block ist eine Gast-Zelle 120 px breit.
  function plate(cell, withRole) {
    var who = L.PEOPLE[cell.who];
    var fs = Math.max(15, Math.min(40, Math.round(cell.w / 20)));
    var d = el('plate', null);
    d.style.left = cell.x + 'px';
    d.style.bottom = (L.H - cell.y - cell.h) + 'px';
    d.style.fontSize = fs + 'px';
    child(d, 'b', '', cell.w >= 600 ? who.name : who.short);
    if (withRole && cell.w >= 600) child(d, 'i', '', who.role);
    return d;
  }

  function blockCells(area, big) {
    var k = area.w / L.BLOCK.w;
    return L.camBlock(L.BLOCK.w, big).map(function (c) {
      var r = scaleRect(c, k, area.x, area.y);
      r.who = c.who; r.big = c.big;
      return r;
    });
  }
  function drawBlock(area, big) {
    blockCells(area, big).forEach(function (c) {
      if (DEMO) el('demo', c, 'Cam');
      el('edge', c);
      plate(c, true);
    });
  }

  function stars(n, avoid) {
    var s = 7;
    function rnd() { s = (s * 16807) % 2147483647; return s / 2147483647; }
    for (var i = 0; i < n; i++) {
      var x = rnd() * L.W, y = rnd() * L.H, z = 1 + Math.round(rnd() * 3), o = 0.25 + rnd() * 0.5;
      if (avoid && x > avoid.x - 4 && x < avoid.x + avoid.w + 4 && y > avoid.y - 4 && y < avoid.y + avoid.h + 4) continue;
      el('star', { x: x, y: y, w: z, h: z }).style.opacity = o;
    }
  }

  function chatTag(area) {
    if (DEMO) el('demo dark', area, 'Chat-Quelle');
    el('eyb tag', { x: area.x, y: area.y - 44 }, 'Chat');
  }

  // ── Daten (Zuletzt, Ziel, Credits) ──────────────────────
  // Relativ zur Seite: /gamescenes/scene.html -> /alerts/api/... durch Caddy.
  var API = '../alerts/api/';
  var listeners = { session: [], goals: [] };
  function poll(kind, path, ms) {
    function run() {
      fetch(API + path, { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { if (j) listeners[kind].forEach(function (fn) { fn(j); }); })
        .catch(function () { /* Panel behaelt den letzten Stand */ });
    }
    run();
    setInterval(run, ms);
  }
  function startData() {
    if (listeners.session.length) poll('session', 'session', 15000);
    if (listeners.goals.length) poll('goals', 'goals', 60000);
  }

  function latestPanel(r, cls) {
    var p = el('panel ' + (cls || ''), r);
    child(p, 'div', 'eyb', 'Zuletzt');
    var rows = {};
    [['follow', 'Follow'], ['sub', 'Abo'], ['cheer', 'Cheer']].forEach(function (k) {
      var row = child(p, 'div', 'kv');
      child(row, 'i', '', k[1]);
      rows[k[0]] = child(row, 'span', '', '—');
    });
    listeners.session.push(function (j) {
      var l = j.latest || {};
      rows.follow.textContent = l.follow ? l.follow.user : '—';
      rows.sub.textContent = l.sub ? l.sub.user : '—';
      rows.cheer.textContent = l.cheer ? l.cheer.user + ' · ' + l.cheer.amount : '—';
    });
    return p;
  }

  function goalPanel(r, cls) {
    var p = el('panel ' + (cls || ''), r);
    var head = child(p, 'div', 'eyb', 'Ziel');
    var row = child(p, 'div', 'kv');
    var name = child(row, 'span', '', 'Kein Ziel aktiv');
    var num = child(row, 'span', '', '');
    var fill = child(child(p, 'div', 'bar'), 'div');
    fill.style.width = '0%';
    listeners.goals.push(function (j) {
      var g = (j.goals || [])[0];
      if (!g) { head.textContent = 'Ziel'; name.textContent = 'Kein Ziel aktiv'; num.textContent = ''; fill.style.width = '0%'; return; }
      head.textContent = g.label;
      name.textContent = g.description || g.label;
      num.textContent = g.current + ' / ' + g.target;
      fill.style.width = (g.target > 0 ? Math.min(100, Math.round(g.current / g.target * 100)) : 0) + '%';
    });
    return p;
  }

  // ── Szenen ──────────────────────────────────────────────
  var G = L.GAMING, T = L.TALK, SO = L.SOLO, ST = L.STILL;
  var scenes = {};

  scenes.gaming = scenes.player = function () {
    if (DEMO) el('demo dark', { x: 0, y: 0, w: L.W, h: L.H }, S === 'player' ? 'Feed ' + L.PEOPLE[P].short : 'Spielbild');
    drawBlock(G.block, S === 'player' ? P : 'deimos');
    // Kein "Chat"-Schild: zwischen Cam-Block und Chat ist kein Platz dafuer,
    // und die Spalte erklaert sich selbst.
    if (DEMO) el('demo dark', G.chat, 'Chat-Quelle');
  };

  scenes.footer = function () {
    ident(G.ident, q.get('l') || 'Gaming', 'glass');
    latestPanel(G.latest, 'glass compact');
    goalPanel(G.goal, 'glass compact');
    if (DEMO) el('demo dark', G.arena, 'Spacefight-Arena');
  };

  scenes.talk = function () {
    stars(90, T.block);
    ident({ x: 80, y: 60, w: 600, h: 72 }, 'Talk');
    el('sub', { x: 1040, y: 82 }, 'Crew-Runde');
    drawBlock(T.block, 'deimos');
    ticks({ x: T.block.x - 12, y: T.block.y - 12, w: T.block.w + 24, h: T.block.h + 24 });
    chatTag(T.chat);
    latestPanel(T.latest);
    el('rule', { x: 80, y: 1320, w: 2400 });
    el('sub', { x: 80, y: 1350 }, 'justcallmedeimos · raumdock.org');
  };

  function fullCam(eyebrow, label, withChat) {
    if (DEMO) el('demo', { x: 0, y: 0, w: L.W, h: L.H }, 'Cam ' + L.PEOPLE[P].short);
    ticks({ x: 40, y: 40, w: L.W - 80, h: L.H - 80 });
    var p = el('panel', { x: SO.plate.x, y: SO.plate.y, h: SO.plate.h });
    child(p, 'div', 'eyb', eyebrow);
    child(p, 'div', 'name-xl', L.PEOPLE[P].name);
    ident({ x: 80, y: 70, w: 600, h: 72 }, label);
    if (withChat) chatTag(SO.chat);
  }
  scenes.solo = function () { P = 'deimos'; fullCam(L.PEOPLE.deimos.role, 'Talk', true); };
  scenes.cam = function () { fullCam(L.PEOPLE[P].role, 'Cam', false); };

  scenes.tile = function () {
    if (DEMO) el('demo dark', { x: 0, y: 0, w: L.W, h: L.H }, 'Feed ' + L.PEOPLE[P].short);
    if (DEMO) el('demo', L.TILE.cam, 'Cam');
    // Die Kachel wird in Multi-Szenen auf bis zu ein Drittel verkleinert:
    // Kante und Schrift sind dafuer bewusst kraeftig.
    var e = el('edge', { x: 0, y: 0, w: L.W, h: L.H });
    e.style.borderWidth = '3px';
    el('edge', L.TILE.cam).style.borderWidth = '3px';
    var c = L.TILE.cam;
    var d = el('plate', null);
    d.style.left = (c.x + c.w + 20) + 'px';
    d.style.bottom = (L.H - c.y - c.h) + 'px';
    d.style.fontSize = '64px';
    child(d, 'b', '', L.PEOPLE[P].name);
  };

  function multi(key) {
    var M = L.MULTI[key];
    if (DEMO) M.slots.forEach(function (r, i) { el('demo dark', r, 'Kachel ' + L.PEOPLE[M.who[i]].short); });
    if (key !== 'multi4') stars(60, null);
    ident(M.ident, 'Multi', key === 'multi4' ? 'solid' : '');
    if (key === 'multi5') el('sub', { x: 1500, y: 104 }, 'Alle Bodycams · Live');
    if (M.chat) chatTag(M.chat);
    if (M.latest) latestPanel(M.latest, 'compact');
    if (M.goal) goalPanel(M.goal, 'compact');
    if (DEMO && M.arena) el('demo dark', M.arena, 'Spacefight-Arena');
  }
  scenes.multi3 = function () { multi('multi3'); };
  scenes.multi4 = function () { multi('multi4'); };
  scenes.multi5 = function () { multi('multi5'); };

  function still(label, line1, line2) {
    root.classList.add('opaque');
    stars(160, null);
    ident({ x: 120, y: 110, w: 900, h: 96 }, label);
    el('big', { x: 120, y: 420 }, line1);
    el('rule', { x: 120, y: 590, w: 1180 });
    el('sub', { x: 120, y: 625 }, line2);
    el('sub', { x: 120, y: 1290 }, 'justcallmedeimos · raumdock.org');
  }

  scenes.start = function () {
    still('Start', 'Stream startet', 'Andocken läuft');
    // Der Countdown ist das eine Kupfer-Ereignis dieser Ansicht.
    var c = el('count', { x: 112, y: 760 }, '');
    var st = el('state ok', { x: 124, y: 990 }, '');
    var left = Math.max(0, Math.round((parseFloat(q.get('min')) || 5) * 60));
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function tick() {
      c.textContent = pad(Math.floor(left / 60)) + ':' + pad(left % 60);
      st.textContent = left > 0 ? 'Status: Vorlauf' : 'Status: bereit';
      if (left > 0) left--;
    }
    tick();
    setInterval(tick, 1000);
    chatTag(ST.chat);
    latestPanel(ST.latest);
  };

  scenes.pause = function () {
    still('Pause', 'Kurze Pause', 'Gleich wieder im Anflug');
    goalPanel({ x: 120, y: 800, w: 1180, h: 220 });
    chatTag(ST.chat);
    latestPanel(ST.latest);
  };

  scenes.ende = function () {
    // Kurz halten: rechts daneben steht das Credits-Panel ab x=1400.
    still('Ende', 'Danke, Crew', 'Bis zum nächsten Einsatz');
    var p = el('panel', ST.credits);
    child(p, 'div', 'eyb', 'Heute an Bord');
    var view = child(p, 'div', 'cred-view');
    var list = child(view, 'div', 'cred');
    function render(j) {
      var c = (j && j.credits) || {};
      list.textContent = '';
      function block(title, items) {
        if (!items || !items.length) return;
        child(list, 'h4', '', title);
        items.forEach(function (t) { child(list, 'div', '', t); });
      }
      block('Follower', c.follow);
      block('Abos', c.sub);
      block('Geschenkte Abos', (c.gift || []).map(function (g) { return g.user + ' · ' + g.amount; }));
      block('Cheers', (c.cheer || []).map(function (g) { return g.user + ' · ' + g.amount; }));
      block('Raids', (c.raid || []).map(function (g) { return g.user + ' · ' + g.amount; }));
      block('Crew', L.ORDER.filter(function (k) { return k !== 'deimos'; }).map(function (k) { return L.PEOPLE[k].name; }));
      // Nur rollen, wenn die Liste nicht ins Panel passt.
      var over = list.scrollHeight > view.clientHeight;
      list.classList.toggle('roll', over);
      if (over) {
        list.style.setProperty('--sc-roll', Math.round(list.scrollHeight / 40) + 's');
        list.style.setProperty('--sc-from', view.clientHeight + 'px');
      }
    }
    render(null);
    listeners.session.push(render);
  };

  (scenes[S] || scenes.gaming)();
  startData();
})();
