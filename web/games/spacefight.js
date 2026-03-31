// ════════════════════════════════════════════════════════
// CHAOS CREW – Raumkampf v2
// Features:
//  - !fight @user nur wenn Gegner im Chat aktiv (5 Min)
//  - Nur wenn Stream läuft (Streamerbot meldet streaming=true)
//  - Ergebnisse in Redis via API
//  - Wall of Fame (Best Space Pilot)
// ════════════════════════════════════════════════════════
'use strict';

var params   = new URLSearchParams(location.search);
var WS_HOST  = (window.CC && CC.validate) ? CC.validate.sanitize(params.get('host') || '192.168.178.39', 'host') : (params.get('host') || '192.168.178.39');
var WS_PORT  = parseInt(params.get('port') || '9090');
// API_HOST: per ?apihost= explizit setzen (empfohlen wenn WS_HOST != LXC-IP)
// Fallback: gleicher Host wie Seitenaufruf (funktioniert wenn Seite vom LXC geladen wird)
var API_HOST = params.get('apihost') || window.location.hostname || '192.168.178.34';
var API_PORT = parseInt(params.get('apiport') || '3000');
var CHANNEL  = params.get('channel') || '';
var TEST_MODE  = params.get('test') === '1';
var FORCE_LIVE = params.get('forcelive') === '1';

var COOLDOWN_MS      = 30000;   // 30s pro Angreifer
var CHAT_ACTIVE_MS   = 5 * 60 * 1000; // 5 Min = "im Chat"
var WOF_SHOW_SECS    = 15;      // Wall of Fame Anzeigedauer

var ws          = null;
var wsRetry     = 2000;
var irc         = null;
var queue       = [];
var isPlaying   = false;
var recentFights   = {};   // attacker.lower → timestamp
var pendingChallenges = {}; // defender.lower → {attacker, defender, ts, timeout}
var CHALLENGE_TIMEOUT = 30000; // 30s zum Annehmen
var chatActive   = {};   // username.lower → last message timestamp
var streamLive   = TEST_MODE || FORCE_LIVE; // im Test/Force-Modus immer live
var wofVisible   = false;
var wofTimer     = null;
var wofRank      = null; // Rang des zuletzt gesehenen Kämpfers

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
  '{D} aktiviert ECM! Gestört.',
  'Schuss geht ins Leere.',
  '{D} dreht hinter Mond!',
];
var EVENTS_WIN = [
  '{W} GEWINNT! {L} treibt antriebslos.',
  'SIEG: {W}! {L} kaputt.',
  '{W} vernichtet {L}! GG.',
  '{W} secured the kill! {L} down.',
];

// ── Streamerbot WS ────────────────────────────────────────
function connect() {
  if (TEST_MODE && !params.get('host')) return; // TEST_MODE ohne expliziten host: kein WS
  try { ws = new WebSocket('ws://' + WS_HOST + ':' + WS_PORT); }
  catch(e) { scheduleReconnect(); return; }

  ws.onopen = function() {
    wsRetry = 2000;
    ws.send(JSON.stringify({ event: 'gw_spacefight_register' }));
    ws.send(JSON.stringify({ event: 'sf_status_request' }));
  };
  ws.onmessage = function(e) {
    var msg = (window.CC && CC.validate) ? CC.validate.safeJsonParse(e.data) : safeParseLocal(e.data);
    if (!msg) return;
    handleSB(msg);
  };
  ws.onclose = ws.onerror = function() { scheduleReconnect(); };
}

function scheduleReconnect() {
  if (TEST_MODE) return; // Im Test-Modus kein Reconnect-Spam
  setTimeout(connect, wsRetry);
  wsRetry = Math.min(wsRetry * 2, 15000);
}

function safeParseLocal(s) {
  try { return JSON.parse(s); } catch(e) { return null; }
}

function handleSB(msg) {
  // Accept/Decline Commands
  if (msg.event === 'fight_accept') {
    acceptChallenge(msg.defender || msg.user || '');
    return;
  }
  if (msg.event === 'fight_decline') {
    declineChallenge(msg.defender || msg.user || '');
    return;
  }
  // Direkter Fight-Command vom SF_ChatForwarder
  if (msg.event === 'fight_cmd') {
    var attacker = msg.attacker || '';
    var defender = msg.defender || '';
    if (attacker && defender) {
      chatActive[defender.toLowerCase()] = Date.now(); // Gegner als aktiv markieren
      chatActive[attacker.toLowerCase()] = Date.now();
      parseCommand(attacker, '!fight @' + defender);
    }
    return;
  }
  // Chat-Message → aktive User tracken + Command prüfen
  if (msg.event === 'chat_msg' || msg.event === 'twitch_chat') {
    var u = (msg.user || msg.username || '').toLowerCase();
    if (u) chatActive[u] = Date.now();
    parseCommand(msg.user || msg.username || '', msg.message || msg.msg || '');
  }
  // Stream-Status von Streamerbot
  if (msg.event === 'sf_status' || msg.event === 'stream_status') {
    streamLive = !!msg.live || !!msg.streaming;
  }
  // OBS streaming status via gw_data
  if (msg.event === 'gw_data') {
    streamLive = true; // wenn WS funktioniert und Daten kommen = wahrscheinlich live
  }
}

// ── Twitch IRC ────────────────────────────────────────────
function connectIRC() {
  if (!CHANNEL && !TEST_MODE) return;
  var ch = CHANNEL || 'justcallmedeimos';
  irc = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
  irc.onopen = function() {
    irc.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
    irc.send('PASS oauth:justinfan' + Math.floor(Math.random()*99999));
    irc.send('NICK justinfan' + Math.floor(Math.random()*99999));
    irc.send('JOIN #' + ch.toLowerCase());
  };
  irc.onmessage = function(e) {
    e.data.split('\r\n').forEach(function(line) {
      if (line.startsWith('PING')) { irc.send('PONG :tmi.twitch.tv'); return; }
      var m = line.match(/^(?:@\S+ )?:(\S+)!\S+ PRIVMSG #\S+ :(.*)$/);
      if (m) {
        var user = m[1];
        var msg  = m[2].trim();
        chatActive[user.toLowerCase()] = Date.now();
        if (/^!ja$/i.test(msg)) {
          acceptChallenge(user);
        } else if (/^!nein$/i.test(msg)) {
          declineChallenge(user);
        } else {
          parseCommand(user, msg);
        }
      }
    });
  };
  irc.onclose = function() { setTimeout(connectIRC, 5000); };
}

// ── Chat-Präsenz-Check ────────────────────────────────────
function isInChat(username) {
  if (TEST_MODE || FORCE_LIVE) return true;
  var last = chatActive[username.toLowerCase()];
  return last && (Date.now() - last < CHAT_ACTIVE_MS);
}

// ── Command Parser ────────────────────────────────────────
function parseCommand(user, message) {
  var m = message.match(/^!fight\s+@?(\S+)/i);
  if (!m) return;

  var attacker = (user || '').trim();
  var defender = m[1].replace(/^@/, '').trim();

  if (!attacker || !defender) return;
  if (attacker.toLowerCase() === defender.toLowerCase()) return;

  // Stream muss laufen (bei Simulation/Test/ForceLive immer durchlassen)
  if (!streamLive && !TEST_MODE && !FORCE_LIVE && !window._sfSimMode) {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({
        event:    'spacefight_rejected',
        reason:   'stream_offline',
        attacker: attacker,
        defender: defender
      }));
    }
    return;
  }

  // Gegner muss im Chat aktiv sein
  if (!isInChat(defender)) {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({
        event: 'spacefight_rejected',
        reason: 'not_in_chat',
        attacker: attacker,
        defender: defender
      }));
    }
    return;
  }

  // Cooldown
  var now = Date.now();
  if ((now - (recentFights[attacker.toLowerCase()] || 0)) < COOLDOWN_MS) return;
  recentFights[attacker.toLowerCase()] = now;

  // Challenge senden – Defender muss annehmen
  var defLower = defender.toLowerCase();
  if (pendingChallenges[defLower]) {
    // Bereits eine offene Challenge gegen diesen Defender
    return;
  }

  // Challenge speichern
  var challengeTimeout = setTimeout(function() {
    if (pendingChallenges[defLower]) {
      delete pendingChallenges[defLower];
      // Timeout-Meldung an Streamerbot
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({
          event: 'spacefight_rejected',
          reason: 'challenge_timeout',
          attacker: attacker,
          defender: defender
        }));
      }
    }
  }, CHALLENGE_TIMEOUT);

  pendingChallenges[defLower] = {
    attacker: attacker,
    defender: defender,
    timeout:  challengeTimeout
  };

  // Challenge-Event an Streamerbot (postet im Chat)
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({
      event:    'spacefight_challenge',
      attacker: attacker,
      defender: defender
    }));
  }
}

// ── Challenge annehmen/ablehnen ───────────────────────────
function acceptChallenge(defender) {
  var defLower = defender.toLowerCase();
  var challenge = pendingChallenges[defLower];
  if (!challenge) return;

  clearTimeout(challenge.timeout);
  delete pendingChallenges[defLower];

  // Cooldown für Angreifer setzen
  recentFights[challenge.attacker.toLowerCase()] = Date.now();

  queue.push({ attacker: challenge.attacker, defender: challenge.defender });
  if (!isPlaying) nextFight();
}

function declineChallenge(defender) {
  var defLower = defender.toLowerCase();
  var challenge = pendingChallenges[defLower];
  if (!challenge) return;

  clearTimeout(challenge.timeout);
  var attacker = challenge.attacker;
  delete pendingChallenges[defLower];

  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({
      event:    'spacefight_rejected',
      reason:   'challenge_declined',
      attacker: attacker,
      defender: defender
    }));
  }
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
  var aWins  = powerA >= powerD;

  var rounds = [], tmpA = 100, tmpD = 100;

  for (var i = 0; i < 4; i++) {
    if (i % 2 === 0) {
      var dmg = Math.floor(Math.random() * 20) + 10;
      if (!aWins && i >= 2) dmg = Math.floor(dmg * 0.4);
      tmpD = Math.max(0, tmpD - dmg);
      rounds.push({ type: Math.random() > 0.25 ? 'hit_a' : 'miss', dmg: dmg, hp_a: tmpA, hp_d: tmpD });
    } else {
      var dmg = Math.floor(Math.random() * 20) + 10;
      if (aWins && i >= 1) dmg = Math.floor(dmg * 0.4);
      tmpA = Math.max(0, tmpA - dmg);
      rounds.push({ type: Math.random() > 0.25 ? 'hit_d' : 'miss', dmg: dmg, hp_a: tmpA, hp_d: tmpD });
    }
  }
  aWins ? rounds.push({ type:'kill_a', hp_a:tmpA, hp_d:0 })
        : rounds.push({ type:'kill_d', hp_a:0, hp_d:tmpD });

  var winner = aWins ? aName : dName;
  var loser  = aWins ? dName : aName;
  var shipW  = aWins ? shipA.name : shipD.name;
  var shipL  = aWins ? shipD.name : shipA.name;

  // Ergebnis – wird erst nach Animationsende gesendet
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
    // Callback nach Animationsende
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(result));
    saveResult(result);
  });
}

// ── API – Ergebnis speichern ──────────────────────────────
function saveResult(result) {
  var url = 'http://' + API_HOST + ':' + API_PORT + '/api/spacefight';
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result)
  }).then(function(r) {
    if (!r.ok) console.warn('[SF] API save failed:', r.status, url);
  }).catch(function(e) {
    console.warn('[SF] API save error:', e.message, url);
  });
}

// ── API – Wall of Fame laden ──────────────────────────────
function loadWoF(cb) {
  var url = 'http://' + API_HOST + ':' + API_PORT + '/api/spacefight/leaderboard?limit=10';
  fetch(url).then(function(r){ return r.json(); }).then(cb).catch(function(){ cb([]); });
}

function loadPlayerRank(username, cb) {
  var url = 'http://' + API_HOST + ':' + API_PORT + '/api/spacefight/player/' + encodeURIComponent(username.toLowerCase());
  fetch(url).then(function(r){ return r.json(); }).then(cb).catch(function(){ cb(null); });
}

// ── Wall of Fame anzeigen ─────────────────────────────────
function showWoF(highlightUser) {
  var wof = document.getElementById('wof');
  if (!wof) return;

  // Timer SOFORT starten – unabhängig vom API-Fetch
  if (wofTimer) clearTimeout(wofTimer);
  wofTimer = setTimeout(hideWoF, WOF_SHOW_SECS * 1000);

  // Sofort einblenden mit Lade-Indikator
  wofVisible = true;
  document.getElementById('wof-list').innerHTML = '<div class="wof-empty">Lade...</div>';
  var rankEl = document.getElementById('wof-player-rank');
  if (rankEl) rankEl.style.display = 'none';
  wof.classList.remove('wof-out');
  wof.classList.add('wof-in');

  // Daten nachladen und einfügen
  loadWoF(function(data) {
    // Prüfen ob WoF noch sichtbar (könnte inzwischen geschlossen worden sein)
    if (!wofVisible) return;

    var rows = '';
    (data || []).forEach(function(p, i) {
      var isHL = highlightUser && p.username.toLowerCase() === highlightUser.toLowerCase();
      rows +=
        '<div class="wof-row' + (isHL ? ' wof-highlight' : '') + '">' +
          '<span class="wof-rank">' + (i===0?'👑':(i===1?'⭐':'#'+(i+1))) + '</span>' +
          '<span class="wof-name">' + esc(p.display || p.username) + '</span>' +
          '<span class="wof-wins">' + (p.wins||0) + 'W</span>' +
          '<span class="wof-losses">' + (p.losses||0) + 'L</span>' +
          '<span class="wof-ratio">' + (p.ratio||'0%') + '</span>' +
        '</div>';
    });
    if (!rows) rows = '<div class="wof-empty">Noch keine Kämpfe</div>';
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
  // Rank verstecken für nächsten Aufruf
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
      '<span class="hp-label" id="hp-a-lbl">100</span>' +
      '<div class="hp-bar-wrap"><div class="hp-bar attacker" id="hp-a" style="width:100%"></div></div>' +
      '<span class="hp-label" style="color:rgba(200,220,232,0.2)">HP</span>' +
      '<div class="hp-bar-wrap reversed"><div class="hp-bar defender" id="hp-d" style="width:100%"></div></div>' +
      '<span class="hp-label" id="hp-d-lbl">100</span>' +
    '</div>' +
    '<div class="combat-log" id="clog">KAMPF BEGINNT...</div>' +
    '<div class="drain-bar" id="drain-bar"></div>';

  arena.appendChild(card);

  requestAnimationFrame(function() { requestAnimationFrame(function() {
    card.classList.add('enter');
    var delay = 500;
    rounds.forEach(function(r, i) {
      setTimeout(function() {
        updateHP(r.hp_a, r.hp_d);
        updateLog(r, aName, dName, winner, loser, i === rounds.length - 1);
      }, delay);
      delay += 900;
    });

    var db = document.getElementById('drain-bar');
    if (db) { db.style.animationDuration = (delay+1000)+'ms'; db.classList.add('running'); }

    // Nach Ende: Ergebnis senden + Wall of Fame anzeigen
    setTimeout(function() {
      card.classList.remove('enter');
      card.classList.add('exit');
      setTimeout(function() {
        if (card.parentNode) card.parentNode.removeChild(card);
        // Callback: Ergebnis an Streamerbot + API (nach Animationsende)
        if (typeof onDone === 'function') onDone();
        // WoF kurz nach dem Kampf anzeigen
        setTimeout(function() { showWoF(winner); }, 500);
        nextFight();
      }, 380);
    }, delay + 1200);
  }); });
}

function updateHP(hpA, hpD) {
  var bA = document.getElementById('hp-a');
  var bD = document.getElementById('hp-d');
  if (bA) bA.style.width = Math.max(0,hpA)+'%';
  if (bD) bD.style.width = Math.max(0,hpD)+'%';
  var lA = document.getElementById('hp-a-lbl');
  var lD = document.getElementById('hp-d-lbl');
  if (lA) lA.textContent = Math.max(0,hpA);
  if (lD) lD.textContent = Math.max(0,hpD);
}

function updateLog(round, aName, dName, winner, loser, isFinal) {
  var log = document.getElementById('clog');
  if (!log) return;
  if (isFinal) {
    var tpl = EVENTS_WIN[Math.floor(Math.random()*EVENTS_WIN.length)];
    var isAWin = winner === aName;
    log.innerHTML = '<span class="winner '+(isAWin?'cyan':'gold')+'">'+
      tpl.replace('{W}',esc(winner.toUpperCase())).replace('{L}',esc(loser.toUpperCase()))+'</span>';
    return;
  }
  var text = '';
  if (round.type === 'hit_a') {
    var tpl = EVENTS_HIT[Math.floor(Math.random()*EVENTS_HIT.length)];
    text = '<span class="hit-a">'+esc(tpl.replace('{A}',aName.toUpperCase()).replace('{D}',dName.toUpperCase()).replace('{DMG}',round.dmg))+'</span>';
  } else if (round.type === 'hit_d') {
    var tpl = EVENTS_HIT[Math.floor(Math.random()*EVENTS_HIT.length)];
    text = '<span class="hit-d">'+esc(tpl.replace('{A}',dName.toUpperCase()).replace('{D}',aName.toUpperCase()).replace('{DMG}',round.dmg))+'</span>';
  } else {
    var tpl = EVENTS_MISS[Math.floor(Math.random()*EVENTS_MISS.length)];
    text = esc(tpl.replace('{A}',aName.toUpperCase()).replace('{D}',dName.toUpperCase()));
  }
  log.innerHTML = text;
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Test Mode ─────────────────────────────────────────────
if (TEST_MODE) {
  streamLive = true;
  window._sfSimMode = true;
  // Simuliere aktive User im Chat
  ['JerichoRamirez','HEADWiG','jazZz','HolderDiePolder'].forEach(function(u){
    chatActive[u.toLowerCase()] = Date.now();
  });
  var testFights = [
    { attacker:'JerichoRamirez', defender:'HEADWiG' },
    { attacker:'jazZz',          defender:'HolderDiePolder' },
  ];
  var ti = 0;
  function testNext() {
    if (ti < testFights.length) {
      queue.push(testFights[ti++]);
      if (!isPlaying) nextFight();
      setTimeout(testNext, 14000);
    }
  }
  setTimeout(testNext, 1000);
}

// ── Init ──────────────────────────────────────────────────
if (!window._sfUnitTests) {
  connect();
  if (CHANNEL) connectIRC();
}
