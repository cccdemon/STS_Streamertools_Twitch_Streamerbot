// ════════════════════════════════════════════════════════
// RDOC – Raumkampf v3
// Features:
//  - Spiel muss per Admin-Panel aktiviert werden
//  - !fight @user via Streamerbot → Bridge → Spacefight → Overlay
//  - 15s Cooldown pro Angreifer
//  - Ergebnisse via API persistiert (PostgreSQL)
//  - Wall of Fame (Best Space Pilot)
// ════════════════════════════════════════════════════════
'use strict';

var params     = new URLSearchParams(location.search);
var TEST_MODE  = params.get('test') === '1';
var FORCE_LIVE = params.get('forcelive') === '1';

var COOLDOWN_MS   = 15000;
var WOF_SHOW_SECS = 15;

var ws          = null;
var wsRetry     = 2000;
var reconnectTimer = null;
var queue       = [];
var isPlaying   = false;
var recentFights = {};
var gameActive   = TEST_MODE || FORCE_LIVE;
var wofVisible   = false;
var wofTimer     = null;

// ── Schiffsklassen ────────────────────────────────────────
var SHIPS = [
  { name: 'VALKYRIE', power: 3 },
  { name: 'BASTION',  power: 3 },
  { name: 'WRAITH',   power: 2 },
  { name: 'RAPTOR',   power: 2 },
];

// ── WebSocket ─────────────────────────────────────────────
function connect() {
  if (TEST_MODE) return;
  var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  try { ws = new WebSocket(proto + '//' + location.host + '/spacefight/ws'); }
  catch(e) { scheduleReconnect(); return; }

  ws.onopen = function() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    wsRetry = 2000;
    ws.send(JSON.stringify({ event: 'cc_identify', role: 'spacefight-overlay' }));
    ws.send(JSON.stringify({ event: 'sf_status_request' }));
  };
  ws.onmessage = function(e) {
    var msg;
    try { msg = JSON.parse(e.data); } catch(x) { return; }
    if (!msg) return;
    handleMsg(msg);
  };
  ws.onclose = ws.onerror = function() { scheduleReconnect(); };
}

function scheduleReconnect() {
  if (TEST_MODE) return;
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(function() {
    reconnectTimer = null;
    connect();
  }, wsRetry);
  wsRetry = Math.min(wsRetry * 2, 15000);
}

function handleMsg(msg) {
  if (msg.event === 'sf_game_status') {
    gameActive = !!msg.active;
    return;
  }
  if (msg.event === 'fight_cmd') {
    var attacker = msg.attacker || '';
    var defender = msg.defender || '';
    if (attacker && defender) startFight(attacker, defender);
    return;
  }
}

// ── Fight Logic ───────────────────────────────────────────
function startFight(attacker, defender) {
  if (!attacker || !defender) return;
  if (attacker.toLowerCase() === defender.toLowerCase()) return;
  if (!gameActive && !TEST_MODE && !FORCE_LIVE && !window._sfSimMode) return;

  var now = Date.now();
  if ((now - (recentFights[attacker.toLowerCase()] || 0)) < COOLDOWN_MS) return;
  recentFights[attacker.toLowerCase()] = now;

  queue.push({ attacker: attacker, defender: defender });
  if (!isPlaying) nextFight();
}

// ── Queue ─────────────────────────────────────────────────
function nextFight() {
  if (!queue.length) { isPlaying = false; return; }
  isPlaying = true;
  var f = queue.shift();
  runFight(f.attacker, f.defender);
}

// ── Kampf Engine ──────────────────────────────────────────
function runFight(aName, dName) {
  var shipA = SHIPS[Math.floor(Math.random() * SHIPS.length)];
  var shipD = SHIPS[Math.floor(Math.random() * SHIPS.length)];

  var powerA = shipA.power + Math.random() * 3;
  var powerD = shipD.power + Math.random() * 3;
  var aWins  = powerA > powerD || (powerA === powerD && Math.random() < 0.5);

  var rounds = [], tmpA = 100, tmpD = 100;

  for (var i = 0; i < 4; i++) {
    var dmg;
    if (i % 2 === 0) {
      dmg = Math.floor(Math.random() * 20) + 10;
      if (!aWins && i >= 2) dmg = Math.floor(dmg * 0.4);
      tmpD = Math.max(0, tmpD - dmg);
      rounds.push({ type: Math.random() > 0.25 ? 'hit_a' : 'miss_a', dmg: dmg, hp_a: tmpA, hp_d: tmpD });
    } else {
      dmg = Math.floor(Math.random() * 20) + 10;
      if (aWins && i >= 2) dmg = Math.floor(dmg * 0.4);
      tmpA = Math.max(0, tmpA - dmg);
      rounds.push({ type: Math.random() > 0.25 ? 'hit_d' : 'miss_d', dmg: dmg, hp_a: tmpA, hp_d: tmpD });
    }
  }
  aWins ? rounds.push({ type:'kill_a', hp_a:tmpA, hp_d:0 })
        : rounds.push({ type:'kill_d', hp_a:0, hp_d:tmpD });

  var winner = aWins ? aName : dName;
  var loser  = aWins ? dName : aName;
  var shipW  = aWins ? shipA.name : shipD.name;
  var shipL  = aWins ? shipD.name : shipA.name;

  var result = {
    event:    'spacefight_result',
    winner:   winner,
    loser:    loser,
    ship_w:   shipW,
    ship_l:   shipL,
    attacker: aName,
    defender: dName,
    ts:       new Date().toISOString()
  };

  showFight(aName, dName, shipA, shipD, rounds, winner, loser, function() {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(result));
  });
}

// ── API – Wall of Fame laden ──────────────────────────────
function loadWoF(cb) {
  fetch('api/spacefight/leaderboard?limit=10')
    .then(function(r){ return r.json(); })
    .then(cb)
    .catch(function(){ cb([]); });
}

function loadPlayerRank(username, cb) {
  fetch('api/spacefight/player/' + encodeURIComponent(username.toLowerCase()))
    .then(function(r){ return r.json(); })
    .then(cb)
    .catch(function(){ cb(null); });
}

// ── Wall of Fame anzeigen ─────────────────────────────────
// The station ident is shown only while the overlay actually has
// something on screen: a duel in progress, or the Bestenliste. The
// arena is transparent the rest of the time, and a permanently visible
// signet is the mark sitting in the stream around the clock.
function syncIdent() {
  var el = document.getElementById('sf-ident');
  if (!el) return;
  var on = !!arenaState || wofVisible;
  el.classList.toggle('sf-ident-on', on);
}

function showWoF(highlightUser) {
  var wof = document.getElementById('wof');
  if (!wof) return;

  if (wofTimer) clearTimeout(wofTimer);
  wofTimer = setTimeout(hideWoF, WOF_SHOW_SECS * 1000);

  wofVisible = true;
  syncIdent();
  document.getElementById('wof-list').innerHTML = '<div class="wof-empty">Lade...</div>';
  var rankEl = document.getElementById('wof-player-rank');
  if (rankEl) rankEl.style.display = 'none';
  wof.classList.remove('wof-out');
  wof.classList.add('wof-in');

  loadWoF(function(data) {
    if (!wofVisible) return;

    var rows = '';
    (data || []).forEach(function(p, i) {
      var isHL = highlightUser && p.username.toLowerCase() === highlightUser.toLowerCase();
      // Rank 1 carries Copper; the viewer's own row carries the Patina
      // structure rule. Both are also labelled, so neither is colour alone.
      var cls = (i === 0 ? ' wof-first' : '') + (isHL ? ' wof-highlight' : '');
      rows +=
        '<div class="wof-row' + cls + '">' +
          '<span class="wof-rank">' + (i===0?'1':(i===1?'2':'#'+(i+1))) + '</span>' +
          '<span class="wof-name">' + esc(p.display || p.username) + '</span>' +
          '<span class="wof-wins">' + (p.wins||0) + 'W</span>' +
          '<span class="wof-losses">' + (p.losses||0) + 'L</span>' +
          '<span class="wof-ratio">' + (p.ratio||'0') + '%</span>' +
        '</div>';
    });
    if (!rows) rows = '<div class="wof-empty">Noch keine Kaempfe</div>';
    document.getElementById('wof-list').innerHTML = rows;

    if (highlightUser) {
      loadPlayerRank(highlightUser, function(player) {
        if (!wofVisible) return;
        var rankEl = document.getElementById('wof-player-rank');
        if (rankEl && player) {
          rankEl.textContent = '#' + player.rank + ' – ' + (player.display || highlightUser) +
            ' | ' + (player.wins||0) + 'W / ' + (player.losses||0) + 'L';
          rankEl.style.display = 'block';
        }
      });
    }
  });
}

function hideWoF() {
  var wof = document.getElementById('wof');
  if (!wof) return;
  wofVisible = false;
  syncIdent();
  wof.classList.remove('wof-in');
  wof.classList.add('wof-out');
  if (wofTimer) { clearTimeout(wofTimer); wofTimer = null; }
  var rankEl = document.getElementById('wof-player-rank');
  if (rankEl) rankEl.style.display = 'none';
}

function toggleWoF() {
  if (wofVisible) hideWoF();
  else showWoF(null);
}

// ── Arena Renderer (pixel-ship combat) ────────────────────
// Layered scene drawn each frame in a single RAF loop:
//   Canvas: starfield (3 parallax layers) + projectiles + explosion sparks + screen shake
//   DOM:    ship sprites (GPU-translated <img>), name labels, HP bars
// Ship art is loaded from public/assets/ships/<slug>.png. High-resolution
// cutouts are rendered as a single smooth frame; legacy 12-frame sheets are
// still supported as a fallback so the overlay never breaks.

var ARENA_W = 640, ARENA_H = 200;
var SHIP_FRAME = 32, SHIP_SCALE = 3.5, SHIP_DISPLAY = SHIP_FRAME * SHIP_SCALE; // 112

// The ship box lives in TWO places - the transform here and the .ship /
// .ship-sprite box in rdoc-overlay.css - and they must agree, because the
// renderer positions by centre (drawX - SHIP_DISPLAY/2). They drifted once
// already: SHIP_SCALE went 2 -> 3.5 for the high-resolution roster and the
// stylesheet stayed at 64px, which put every ship, label and HP bar 24px
// off. Publishing the constant to CSS makes this file the single owner.
document.documentElement.style.setProperty('--ov-ship', SHIP_DISPLAY + 'px');
// Centre-to-centre distance between the two combatants. Their home
// positions are derived from the arena centre below, so the fight stays
// centred by construction - tune the duel's width here, nothing else.
var SHIP_SEPARATION = 200;
var FRAMES_IDLE   = [0,1,2,3];
var FRAMES_THRUST = [4,5,6];
var FRAME_HIT     = 7;
var FRAMES_DEAD   = [8,9,10,11];
var FRAME_IDLE_MS = 120, FRAME_DEAD_MS = 80;

// ── Arena palette ────────────────────────────────────────────
// Every colour the canvas paints, from the kit's tokens.js. The
// arena used to run on an off-brand cyan/orange pair (#00d4ff /
// #f0a500) plus a fire ramp of its own.
//
//   Attacker = Copper, defender = Patina. Two data series, the two
//   brand accents, 180 degrees apart - the only pairing that
//   separates at 640x200 over live video.
//   An explosion is a STATE, so it takes the functional colours:
//   Warning at the core, Error at the edge.
//   Stars are Steel: structure that must never compete with a ship.
var PAL = {
  copper:    '#C48A4A',
  patina:    '#4FB5B5',
  ink:       '#F2F2F0',
  steel:     '#76828D',
  graphite:  '#2B3135',
  space:     '#121416',
  warning:   '#EBCF52',
  error:     '#EE6E76',
  success:   '#63C271'
};
// Side -> series colour. One lookup, so the two series can never
// drift apart between the projectile, the spark and the sprite.
function sideColor(side) { return side === 'attacker' ? PAL.copper : PAL.patina; }

var spriteCache = {}; // shipName(lower) -> { ready, image, frames, isPlaceholder }

function shipSlug(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function loadSpriteSheet(shipName) {
  var key = shipSlug(shipName);
  if (spriteCache[key]) return spriteCache[key];
  var entry = { ready: false, image: null, frames: 12, isPlaceholder: false, isCutout: false };
  spriteCache[key] = entry;
  var img = new Image();
  img.onload = function() {
    entry.image = img;
    entry.isCutout = (img.width / img.height) < 4;
    entry.frames = entry.isCutout ? 1 : Math.max(1, Math.floor(img.width / SHIP_FRAME));
    entry.ready = true;
  };
  img.onerror = function() {
    entry.image = makePlaceholderSheet(shipName);
    entry.frames = 12;
    entry.isPlaceholder = true;
    entry.ready = true;
  };
  img.src = 'assets/ships/' + key + '.png';
  return entry;
}

function makePlaceholderSheet(shipName) {
  // Procedural pixel-ship: a deterministic chevron silhouette for a
  // class whose sprite sheet is missing. The name hash used to pick a
  // free HUE, which put every colour of the wheel on screen. It now
  // picks a HULL from the palette neutrals and keeps the accent
  // fixed, so an unshipped class can never introduce an off-brand
  // colour - it just reads as a grey ship with a brand cockpit.
  var h = 0, s = String(shipName);
  for (var i = 0; i < s.length; i++) { h = ((h<<5)-h + s.charCodeAt(i))|0; }
  var HULLS = [PAL.steel, PAL.graphite, PAL.ink];
  var hull   = HULLS[(h >>> 0) % HULLS.length];
  var hullDk = PAL.graphite;
  var glow   = PAL.patina;   // cockpit
  var thrust = PAL.copper;   // engine

  var c = document.createElement('canvas');
  c.width = SHIP_FRAME * 12; c.height = SHIP_FRAME;
  var ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  function drawShip(fx, jitter, thrustOn, hitFlash, deadStage) {
    var ox = fx * SHIP_FRAME;
    if (deadStage > 0) {
      // explosion frames: expanding ring of pixels
      var cx = ox + 16, cy = 16;
      var rings = deadStage; // 1..4
      // Warning ring, Error at the outermost stage - the same state
      // pair the canvas explosion uses. No hsl() fire ramp.
      ctx.fillStyle = rings >= 3 ? PAL.error : PAL.warning;
      for (var a = 0; a < 24; a++) {
        var ang = (a/24) * Math.PI * 2;
        var rad = rings * 3 + (a % 2);
        var px = Math.round(cx + Math.cos(ang)*rad);
        var py = Math.round(cy + Math.sin(ang)*rad);
        if (px >= ox && px < ox+SHIP_FRAME && py >= 0 && py < SHIP_FRAME) {
          ctx.fillRect(px, py, 2, 2);
        }
      }
      if (rings <= 2) {
        ctx.fillStyle = PAL.warning;
        ctx.fillRect(cx-2, cy-2, 4, 4);
      }
      return;
    }
    // body: chevron pointing right
    ctx.fillStyle = hullDk;
    ctx.fillRect(ox+6, 12+jitter, 18, 8);
    ctx.fillStyle = hull;
    ctx.fillRect(ox+8, 13+jitter, 14, 6);
    // nose
    ctx.fillStyle = hull;
    ctx.fillRect(ox+22, 14+jitter, 4, 4);
    ctx.fillRect(ox+26, 15+jitter, 2, 2);
    // wings
    ctx.fillStyle = hullDk;
    ctx.fillRect(ox+10, 8+jitter,  6, 4);
    ctx.fillRect(ox+10, 20+jitter, 6, 4);
    // cockpit
    ctx.fillStyle = glow;
    ctx.fillRect(ox+14, 14+jitter, 3, 3);
    // thruster
    if (thrustOn) {
      ctx.fillStyle = thrust;
      ctx.fillRect(ox+2, 14+jitter, 5, 4);
      ctx.fillStyle = 'rgba(242,242,240,0.85)';   /* Off White */
      ctx.fillRect(ox+4, 15+jitter, 2, 2);
    } else {
      ctx.fillStyle = thrust;
      ctx.fillRect(ox+5, 15+jitter, 2, 2);
    }
    if (hitFlash) {
      ctx.fillStyle = 'rgba(242,242,240,0.85)';   /* Off White */
      ctx.fillRect(ox+6, 12+jitter, 18, 8);
    }
  }

  // 0..3 idle (subtle thruster jitter)
  drawShip(0, 0, false, false, 0);
  drawShip(1, 0, true,  false, 0);
  drawShip(2, 0, false, false, 0);
  drawShip(3, 0, true,  false, 0);
  // 4..6 thrust forward
  drawShip(4, 0, true, false, 0);
  drawShip(5, 0, true, false, 0);
  drawShip(6, 0, true, false, 0);
  // 7 hit flash
  drawShip(7, 0, false, true, 0);
  // 8..11 explosion
  drawShip(8,  0, false, false, 1);
  drawShip(9,  0, false, false, 2);
  drawShip(10, 0, false, false, 3);
  drawShip(11, 0, false, false, 4);
  return c;
}

// ── Render state ─────────────────────────────────────────
var arenaState = null;

function newShipState(side, displayName, shipName, homeX, homeY) {
  return {
    side: side, // 'attacker' | 'defender'
    name: displayName,
    shipName: shipName,
    sprite: loadSpriteSheet(shipName),
    x: homeX + (side === 'attacker' ? -ARENA_W : ARENA_W) * 0.6, // start off-screen
    y: homeY,
    homeX: homeX, homeY: homeY,
    targetX: homeX, targetY: homeY,
    bobPhase: Math.random() * Math.PI * 2,
    rot: 0,
    hp: 100, hpDisplay: 100,
    mode: 'idle', modeUntil: 0,
    frame: 0, frameTimer: 0,
    el: null, hpEl: null
  };
}

function buildShipDom(arena, ship) {
  var d = document.createElement('div');
  d.className = 'ship ' + ship.side;
  var label = '<div class="ship-label">' + esc(ship.name.toUpperCase()) +
              '<span class="ship-class">' + esc(ship.shipName) + '</span></div>';
  var spriteEl = '<div class="ship-sprite"></div>';
  var hp = '<div class="ship-hp-wrap"><div class="ship-hp"></div></div>';
  d.innerHTML = label + spriteEl + hp;
  arena.appendChild(d);
  ship.el      = d;
  ship.spriteEl = d.querySelector('.ship-sprite');
  ship.hpEl    = d.querySelector('.ship-hp');
  return d;
}

function spawnProjectile(state, fromShip, toShip, willHit) {
  var startX = fromShip.x + (fromShip.side === 'attacker' ? 22 : -22);
  var startY = fromShip.y;
  var travelMs = 320;
  var endX = toShip.x + (toShip.side === 'attacker' ? 22 : -22);
  var endY = toShip.y;
  if (!willHit) {
    // miss: aim past the target
    endY += (Math.random() < 0.5 ? -1 : 1) * (18 + Math.random()*8);
    endX += (fromShip.side === 'attacker' ? 80 : -80);
    travelMs = 480;
  }
  state.projectiles.push({
    x: startX, y: startY,
    vx: (endX - startX) / travelMs,
    vy: (endY - startY) / travelMs,
    color: sideColor(fromShip.side),
    life: travelMs + 200, age: 0, trail: []
  });
  // Muzzle flash: same series colour, not a lightened variant of it.
  // A tint ladder is the start of a gradient.
  state.flashes.push({ x: startX, y: startY, color: sideColor(fromShip.side), life: 110, age: 0 });
}

function spawnImpact(state, ship, dmg) {
  var n = Math.min(28, 10 + Math.floor(dmg * 0.6));
  for (var i = 0; i < n; i++) {
    var ang = Math.random() * Math.PI * 2;
    var spd = 0.04 + Math.random() * 0.14;
    state.sparks.push({
      x: ship.x, y: ship.y,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd,
      life: 380 + Math.random()*220, age: 0,
      color: sideColor(ship.side)
    });
  }
  state.shake = Math.min(6, state.shake + 1.2 + dmg * 0.06);
}

function spawnExplosion(state, ship) {
  for (var i = 0; i < 36; i++) {
    var ang = Math.random() * Math.PI * 2;
    var spd = 0.05 + Math.random() * 0.22;
    state.sparks.push({
      x: ship.x, y: ship.y,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd - 0.02,
      life: 600 + Math.random()*400, age: 0,
      // A kill is a state: Warning core, Error edge. No fire ramp.
      color: i < 18 ? PAL.warning : PAL.error
    });
  }
  state.shake = 6;
}

function initStarfield() {
  var stars = [];
  for (var i = 0; i < 80; i++) {
    var depth = i % 3; // 0 = far, 2 = near
    stars.push({
      x: Math.random() * ARENA_W,
      y: Math.random() * ARENA_H,
      depth: depth,
      v: 8 + depth * 22, // px/sec
      size: depth === 2 ? 2 : 1,
      alpha: 0.25 + depth * 0.25
    });
  }
  return stars;
}

function arenaTick(state, dt) {
  // ─ stars ─
  var s = state.stars;
  for (var i = 0; i < s.length; i++) {
    s[i].x -= s[i].v * dt / 1000;
    if (s[i].x < -2) { s[i].x = ARENA_W + 2; s[i].y = Math.random() * ARENA_H; }
  }

  // ─ ships ─
  var now = state.now;
  [state.shipA, state.shipD].forEach(function(ship) {
    // mode timeout
    if (ship.modeUntil && now > ship.modeUntil && ship.mode !== 'dead') {
      ship.mode = 'idle'; ship.modeUntil = 0;
    }
    // ease toward target
    var k = (ship.mode === 'thrust') ? 0.22 : 0.08;
    ship.x += (ship.targetX - ship.x) * k;
    ship.y += (ship.targetY - ship.y) * k;
    // idle bob
    ship.bobPhase += dt * 0.003;
    var bob = Math.sin(ship.bobPhase) * 3;
    ship.drawY = ship.y + bob;
    ship.drawX = ship.x;
    // frame advance
    ship.frameTimer += dt;
    var frames, frameMs;
    if (ship.mode === 'dead')      { frames = FRAMES_DEAD;   frameMs = FRAME_DEAD_MS; }
    else if (ship.mode === 'thrust'){ frames = FRAMES_THRUST; frameMs = FRAME_IDLE_MS; }
    else if (ship.mode === 'hit')   { frames = [FRAME_HIT];   frameMs = 200; }
    else                            { frames = FRAMES_IDLE;   frameMs = FRAME_IDLE_MS; }
    while (ship.frameTimer >= frameMs) {
      ship.frameTimer -= frameMs;
      ship.frameIdx = (ship.frameIdx + 1) % frames.length;
    }
    if (ship.mode === 'dead' && ship.frameIdx >= frames.length - 1) {
      ship.frameIdx = frames.length - 1; // hold last frame
    }
    ship.frame = frames[ship.frameIdx];
  });

  // ─ projectiles ─
  for (var p = state.projectiles.length - 1; p >= 0; p--) {
    var pr = state.projectiles[p];
    pr.age += dt;
    pr.x += pr.vx * dt;
    pr.y += pr.vy * dt;
    pr.trail.push({ x: pr.x, y: pr.y });
    if (pr.trail.length > 6) pr.trail.shift();
    if (pr.age > pr.life) state.projectiles.splice(p, 1);
  }

  // ─ flashes / sparks ─
  for (var f = state.flashes.length - 1; f >= 0; f--) {
    state.flashes[f].age += dt;
    if (state.flashes[f].age > state.flashes[f].life) state.flashes.splice(f, 1);
  }
  for (var k2 = state.sparks.length - 1; k2 >= 0; k2--) {
    var sp = state.sparks[k2];
    sp.age += dt;
    sp.x += sp.vx * dt;
    sp.y += sp.vy * dt;
    sp.vy += 0.00006 * dt; // light gravity
    if (sp.age > sp.life) state.sparks.splice(k2, 1);
  }

  // ─ shake decay ─
  state.shake *= Math.pow(0.86, dt / 16);
  if (state.shake < 0.05) state.shake = 0;
}

function arenaDraw(state) {
  var ctx = state.ctx;
  ctx.clearRect(0, 0, ARENA_W, ARENA_H);

  var sx = (Math.random() - 0.5) * state.shake;
  var sy = (Math.random() - 0.5) * state.shake;
  ctx.save();
  ctx.translate(sx, sy);

  // stars
  var s = state.stars;
  for (var i = 0; i < s.length; i++) {
    // Steel 118,130,141 - the starfield is structure and must never
    // read brighter than a ship.
    ctx.fillStyle = 'rgba(118,130,141,' + s[i].alpha + ')';
    ctx.fillRect(s[i].x | 0, s[i].y | 0, s[i].size, s[i].size);
  }

  // projectile trails + heads
  var pr = state.projectiles;
  for (var p = 0; p < pr.length; p++) {
    var P = pr[p];
    for (var t = 0; t < P.trail.length; t++) {
      var a = (t + 1) / P.trail.length;
      ctx.globalAlpha = a * 0.6;
      ctx.fillStyle = P.color;
      ctx.fillRect(P.trail[t].x | 0, P.trail[t].y | 0, 2, 2);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = PAL.ink;
    ctx.fillRect((P.x | 0) - 1, (P.y | 0) - 1, 3, 3);
    ctx.fillStyle = P.color;
    ctx.fillRect((P.x | 0) - 2, (P.y | 0), 5, 1);
  }

  // muzzle flashes
  for (var f = 0; f < state.flashes.length; f++) {
    var F = state.flashes[f];
    var t2 = 1 - F.age / F.life;
    ctx.globalAlpha = Math.max(0, t2);
    ctx.fillStyle = F.color;
    var r = 2 + t2 * 4;
    ctx.fillRect((F.x|0) - r, (F.y|0) - r, r*2, r*2);
  }

  // sparks
  for (var k2 = 0; k2 < state.sparks.length; k2++) {
    var SP = state.sparks[k2];
    var lt = 1 - SP.age / SP.life;
    if (lt <= 0) continue;
    ctx.globalAlpha = lt;
    ctx.fillStyle = SP.color;
    ctx.fillRect(SP.x | 0, SP.y | 0, 2, 2);
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // sync DOM ships
  [state.shipA, state.shipD].forEach(function(ship) {
    if (!ship.el) return;
    var tx = Math.round(ship.drawX - SHIP_DISPLAY/2 + sx);
    var ty = Math.round(ship.drawY - SHIP_DISPLAY/2 + sy);
    ship.el.style.transform = 'translate3d(' + tx + 'px,' + ty + 'px,0)';
    // High-resolution cutouts use contain; legacy sheets are frame-cropped.
    if (ship.sprite && ship.sprite.ready && ship.spriteEl) {
      if (!ship.spriteSrc) {
        var img = ship.sprite.image;
        var sheetW = img.width || (SHIP_FRAME * (ship.sprite.frames || 12));
        ship.spriteSrc = (img instanceof HTMLCanvasElement) ? img.toDataURL() : img.src;
        ship.spriteEl.style.backgroundImage = 'url(' + ship.spriteSrc + ')';
        if (ship.sprite.isCutout) {
          ship.spriteEl.classList.add('ship-cutout');
          ship.spriteEl.style.backgroundSize = 'contain';
          ship.spriteEl.style.backgroundPosition = 'center';
        } else {
          ship.spriteEl.style.backgroundSize = (sheetW * SHIP_SCALE) + 'px ' + (SHIP_FRAME * SHIP_SCALE) + 'px';
        }
      }
      if (!ship.sprite.isCutout) {
        var maxFrame = (ship.sprite.frames || 12) - 1;
        var fr = Math.min(ship.frame, maxFrame);
        ship.spriteEl.style.backgroundPosition = '-' + (fr * SHIP_DISPLAY) + 'px 0';
      }
    }
    // hit-flash class
    if (ship.mode === 'hit') ship.el.classList.add('hit');
    else                     ship.el.classList.remove('hit');
    if (ship.mode === 'dead') ship.el.classList.add('dead');
    // hp bar
    if (ship.hpEl) {
      ship.hpDisplay += (ship.hp - ship.hpDisplay) * 0.18;
      ship.hpEl.style.width = Math.max(0, ship.hpDisplay) + '%';
      if (ship.hpDisplay < 30) ship.hpEl.classList.add('low');
    }
  });
}

function startArenaLoop(state) {
  var last = performance.now();
  function frame(now) {
    if (state.stopped) return;
    var dt = Math.min(50, now - last);
    last = now;
    state.now = now;
    arenaTick(state, dt);
    arenaDraw(state);
    state.raf = requestAnimationFrame(frame);
  }
  state.raf = requestAnimationFrame(frame);
}

// ── showFight (consumes existing rounds array) ───────────
function showFight(aName, dName, shipA, shipD, rounds, winner, loser, onDone) {
  var arena  = document.getElementById('arena');
  var canvas = document.getElementById('sf-canvas');
  if (!canvas || !arena) { if (onDone) onDone(); nextFight(); return; }

  var state = {
    ctx: canvas.getContext('2d'),
    stars: initStarfield(),
    shipA: newShipState('attacker', aName, shipA.name, (ARENA_W - SHIP_SEPARATION) / 2, ARENA_H / 2),
    shipD: newShipState('defender', dName, shipD.name, (ARENA_W + SHIP_SEPARATION) / 2, ARENA_H / 2),
    projectiles: [],
    flashes: [],
    sparks: [],
    shake: 0,
    stopped: false,
    raf: 0,
    now: performance.now()
  };
  state.shipA.frameIdx = 0;
  state.shipD.frameIdx = 0;
  state.ctx.imageSmoothingEnabled = false;

  // build DOM ships
  buildShipDom(arena, state.shipA);
  buildShipDom(arena, state.shipD);

  // fade overlay (only used at exit)
  var fade = document.createElement('div');
  fade.className = 'sf-arena-fade';
  arena.appendChild(fade);

  // arena state shared
  arenaState = state;
  syncIdent();
  startArenaLoop(state);

  // schedule round events
  var introMs = 600;
  var roundMs = 900;
  var timeouts = [];
  rounds.forEach(function(r, i) {
    var at = introMs + i * roundMs;
    var isFinal = i === rounds.length - 1;
    timeouts.push(setTimeout(function() { runRound(state, r, isFinal, aName, dName, winner, loser); }, at));
  });

  var endAt = introMs + rounds.length * roundMs + 400;
  timeouts.push(setTimeout(function() {
    fade.classList.add('exit');
  }, endAt));

  timeouts.push(setTimeout(function() {
    state.stopped = true;
    if (state.raf) cancelAnimationFrame(state.raf);
    // clean DOM
    if (state.shipA.el && state.shipA.el.parentNode) state.shipA.el.parentNode.removeChild(state.shipA.el);
    if (state.shipD.el && state.shipD.el.parentNode) state.shipD.el.parentNode.removeChild(state.shipD.el);
    if (fade.parentNode) fade.parentNode.removeChild(fade);
    state.ctx.clearRect(0, 0, ARENA_W, ARENA_H);
    arenaState = null;
    syncIdent();
    if (typeof onDone === 'function') onDone();
    setTimeout(function() { showWoF(winner); }, 500);
    nextFight();
  }, endAt + 600));
}

function runRound(state, round, isFinal, aName, dName, winner, loser) {
  var shipA = state.shipA, shipD = state.shipD;
  if (isFinal) {
    var winA = winner === aName;
    var winShip  = winA ? shipA : shipD;
    var loseShip = winA ? shipD : shipA;
    loseShip.mode = 'dead';
    loseShip.modeUntil = state.now + 5000;
    loseShip.frameIdx = 0;
    loseShip.hp = 0;
    spawnExplosion(state, loseShip);
    // winner flexes: thrust + slight forward push
    winShip.mode = 'thrust';
    winShip.modeUntil = state.now + 600;
    winShip.targetX = winShip.homeX + (winShip.side === 'attacker' ? 30 : -30);
    setTimeout(function() {
      winShip.targetX = winShip.homeX;
      winShip.mode = 'idle';
    }, 600);
    return;
  }

  var attackerSide = (round.type === 'hit_a' || round.type === 'miss_a') ? 'attacker' : 'defender';
  var willHit      = (round.type === 'hit_a' || round.type === 'hit_d');
  var shooter = attackerSide === 'attacker' ? shipA : shipD;
  var target  = attackerSide === 'attacker' ? shipD : shipA;

  // shooter thrusts forward briefly
  shooter.mode = 'thrust';
  shooter.modeUntil = state.now + 260;
  shooter.frameIdx = 0;
  shooter.targetX = shooter.homeX + (shooter.side === 'attacker' ? 22 : -22);
  setTimeout(function() {
    shooter.targetX = shooter.homeX;
  }, 260);

  spawnProjectile(state, shooter, target, willHit);

  // schedule impact / dodge after projectile travel (~320ms hit, ~480ms miss)
  var travelMs = willHit ? 320 : 480;
  setTimeout(function() {
    if (willHit) {
      target.mode = 'hit';
      target.modeUntil = state.now + 200;
      target.frameIdx = 0;
      // recoil: small kick away from shooter
      var kick = 18;
      var dir  = target.side === 'attacker' ? -1 : 1;
      target.targetX = target.homeX + dir * kick;
      setTimeout(function() { target.targetX = target.homeX; }, 220);
      // HP drop using authoritative round.hp values
      shipA.hp = Math.max(0, round.hp_a);
      shipD.hp = Math.max(0, round.hp_d);
      spawnImpact(state, target, round.dmg);
    } else {
      // miss: target swerves vertically
      var swerve = (Math.random() < 0.5 ? -1 : 1) * 16;
      target.targetY = target.homeY + swerve;
      setTimeout(function() { target.targetY = target.homeY; }, 280);
    }
  }, travelMs);
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Test Mode ─────────────────────────────────────────────
if (TEST_MODE) {
  gameActive = true;
  window._sfSimMode = true;
  var testFights = [
    { attacker:'JerichoRamirez', defender:'HEADWiG' },
    { attacker:'jazZz',          defender:'HolderDiePolder' },
  ];
  var ti = 0;
  function testNext() {
    if (ti < testFights.length) {
      startFight(testFights[ti].attacker, testFights[ti].defender);
      ti++;
      setTimeout(testNext, 14000);
    }
  }
  setTimeout(testNext, 1000);
}

// ── Init ──────────────────────────────────────────────────
if (!window._sfUnitTests) {
  connect();
}
