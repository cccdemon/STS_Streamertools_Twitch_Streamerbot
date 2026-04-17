// ════════════════════════════════════════════════════════
// CHAOS CREW – Raumkampf v3
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
  { name: 'PERSEUS',       power: 3 },
  { name: 'HAMMERHEAD',    power: 3 },
  { name: 'VANGUARD',      power: 3 },
  { name: 'CONSTELLATION', power: 2 },
  { name: 'GLADIUS',       power: 2 },
  { name: 'SABRE',         power: 2 },
  { name: 'ORIGIN 300I',   power: 2 },
  { name: 'ARROW',         power: 2 },
  { name: 'HORNET',        power: 2 },
  { name: 'AURORA',        power: 1 },
];

var EVENTS_HIT = [
  '{A} feuert Railgun auf {D}! -{DMG} HP',
  '{A} trifft mit Laser-Salve! -{DMG} HP',
  '{A} umgeht Schilde von {D}! -{DMG} HP',
  '{A} zielt auf Triebwerk! -{DMG} HP',
  '{A} dreht auf und feuert! -{DMG} HP',
];
var EVENTS_MISS = [
  '{D} weicht aus! Verfehlt.',
  '{D} aktiviert ECM! Gestoert.',
  'Schuss geht ins Leere.',
  '{D} dreht hinter Mond!',
];
var EVENTS_WIN = [
  '{W} GEWINNT! {L} treibt antriebslos.',
  'SIEG: {W}! {L} kaputt.',
  '{W} vernichtet {L}! GG.',
  '{W} secured the kill! {L} down.',
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
    saveResult(result);
  });
}

// ── API – Ergebnis speichern ──────────────────────────────
function saveResult(result) {
  fetch('/api/spacefight', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result)
  }).catch(function(e) {
    console.warn('[SF] API save error:', e.message);
  });
}

// ── API – Wall of Fame laden ──────────────────────────────
function loadWoF(cb) {
  fetch('/api/spacefight/leaderboard?limit=10')
    .then(function(r){ return r.json(); })
    .then(cb)
    .catch(function(){ cb([]); });
}

function loadPlayerRank(username, cb) {
  fetch('/api/spacefight/player/' + encodeURIComponent(username.toLowerCase()))
    .then(function(r){ return r.json(); })
    .then(cb)
    .catch(function(){ cb(null); });
}

// ── Wall of Fame anzeigen ─────────────────────────────────
function showWoF(highlightUser) {
  var wof = document.getElementById('wof');
  if (!wof) return;

  if (wofTimer) clearTimeout(wofTimer);
  wofTimer = setTimeout(hideWoF, WOF_SHOW_SECS * 1000);

  wofVisible = true;
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
      rows +=
        '<div class="wof-row' + (isHL ? ' wof-highlight' : '') + '">' +
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

// ── Render ────────────────────────────────────────────────
function showFight(aName, dName, shipA, shipD, rounds, winner, loser, onDone) {
  var arena = document.getElementById('arena');
  var card  = document.createElement('div');
  card.className = 'fight-card';
  card.innerHTML =
    '<div class="combatants">' +
      '<div class="pilot attacker"><div class="pilot-name">' + esc(aName.toUpperCase()) + '</div>' +
        '<div class="pilot-ship">' + esc(shipA.name) + '</div></div>' +
      '<div class="vs-block"><div class="vs-icon">&#x2694;</div><div class="vs-text">VS</div></div>' +
      '<div class="pilot defender"><div class="pilot-name">' + esc(dName.toUpperCase()) + '</div>' +
        '<div class="pilot-ship">' + esc(shipD.name) + '</div></div>' +
    '</div>' +
    '<div class="hp-row">' +
      '<span class="hp-label fc-hp-a-lbl">100</span>' +
      '<div class="hp-bar-wrap"><div class="hp-bar attacker fc-hp-a" style="width:100%"></div></div>' +
      '<span class="hp-label" style="color:rgba(200,220,232,0.2)">HP</span>' +
      '<div class="hp-bar-wrap reversed"><div class="hp-bar defender fc-hp-d" style="width:100%"></div></div>' +
      '<span class="hp-label fc-hp-d-lbl">100</span>' +
    '</div>' +
    '<div class="combat-log fc-clog">KAMPF BEGINNT...</div>' +
    '<div class="drain-bar fc-drain-bar"></div>';

  arena.appendChild(card);

  requestAnimationFrame(function() { requestAnimationFrame(function() {
    card.classList.add('enter');
    var delay = 500;
    rounds.forEach(function(r, i) {
      setTimeout(function() {
        updateHP(card, r.hp_a, r.hp_d);
        updateLog(card, r, aName, dName, winner, loser, i === rounds.length - 1);
      }, delay);
      delay += 900;
    });

    var db = card.querySelector('.fc-drain-bar');
    if (db) { db.style.animationDuration = (delay+1000)+'ms'; db.classList.add('running'); }

    setTimeout(function() {
      card.classList.remove('enter');
      card.classList.add('exit');
      setTimeout(function() {
        if (card.parentNode) card.parentNode.removeChild(card);
        if (typeof onDone === 'function') onDone();
        setTimeout(function() { showWoF(winner); }, 500);
        nextFight();
      }, 380);
    }, delay + 1200);
  }); });
}

function updateHP(card, hpA, hpD) {
  var bA = card.querySelector('.fc-hp-a');
  var bD = card.querySelector('.fc-hp-d');
  if (bA) bA.style.width = Math.max(0,hpA)+'%';
  if (bD) bD.style.width = Math.max(0,hpD)+'%';
  var lA = card.querySelector('.fc-hp-a-lbl');
  var lD = card.querySelector('.fc-hp-d-lbl');
  if (lA) lA.textContent = Math.max(0,hpA);
  if (lD) lD.textContent = Math.max(0,hpD);
}

function updateLog(card, round, aName, dName, winner, loser, isFinal) {
  var log = card.querySelector('.fc-clog');
  if (!log) return;
  if (isFinal) {
    var tpl = EVENTS_WIN[Math.floor(Math.random()*EVENTS_WIN.length)];
    var isAWin = winner === aName;
    log.innerHTML = '<span class="winner '+(isAWin?'cyan':'gold')+'">'+
      tpl.replace('{W}',esc(winner.toUpperCase())).replace('{L}',esc(loser.toUpperCase()))+'</span>';
    return;
  }
  var tpl, text;
  if (round.type === 'hit_a') {
    tpl  = EVENTS_HIT[Math.floor(Math.random()*EVENTS_HIT.length)];
    text = '<span class="hit-a">'+esc(tpl.replace('{A}',aName.toUpperCase()).replace('{D}',dName.toUpperCase()).replace('{DMG}',round.dmg))+'</span>';
  } else if (round.type === 'hit_d') {
    tpl  = EVENTS_HIT[Math.floor(Math.random()*EVENTS_HIT.length)];
    text = '<span class="hit-d">'+esc(tpl.replace('{A}',dName.toUpperCase()).replace('{D}',aName.toUpperCase()).replace('{DMG}',round.dmg))+'</span>';
  } else if (round.type === 'miss_a') {
    tpl  = EVENTS_MISS[Math.floor(Math.random()*EVENTS_MISS.length)];
    text = esc(tpl.replace('{A}',aName.toUpperCase()).replace('{D}',dName.toUpperCase()));
  } else {
    tpl  = EVENTS_MISS[Math.floor(Math.random()*EVENTS_MISS.length)];
    text = esc(tpl.replace('{A}',dName.toUpperCase()).replace('{D}',aName.toUpperCase()));
  }
  log.innerHTML = text;
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
