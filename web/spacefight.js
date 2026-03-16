// ════════════════════════════════════════════════════════
// CHAOS CREW – Raumkampf Chat Game
// Trigger: !fight @username im Twitch Chat
// ════════════════════════════════════════════════════════

var params   = new URLSearchParams(location.search);
var WS_HOST  = params.get('host')    || '192.168.178.39';
var WS_PORT  = params.get('port')    || '9090';
var CHANNEL  = params.get('channel') || '';
var HOLD_MS  = 8000; // wie lange die Card sichtbar bleibt

var ws          = null;
var wsRetry     = 2000;
var queue       = [];
var isPlaying   = false;
var recentFights = {}; // cooldown: username → timestamp

var COOLDOWN_MS = 30000; // 30s Cooldown pro Angreifer

// ── Schiffsklassen ────────────────────────────────────────
var SHIPS = [
  { name: 'PERSEUS',    icon: '&#x25B2;', power: 3 },
  { name: 'HAMMERHEAD', icon: '&#x25A0;', power: 3 },
  { name: 'CONSTELLATION', icon:'&#x2666;', power: 2 },
  { name: 'ARROW',      icon: '&#x25B6;', power: 2 },
  { name: 'AURORA',     icon: '&#x25CB;', power: 1 },
  { name: 'ORIGIN 300I',icon: '&#x25CE;', power: 2 },
  { name: 'GLADIUS',    icon: '&#x25C6;', power: 2 },
  { name: 'VANGUARD',   icon: '&#x25A3;', power: 3 },
  { name: 'SABRE',      icon: '&#x25C0;', power: 2 },
  { name: 'HORNET',     icon: '&#x25CF;', power: 2 },
];

// ── Kampf-Ereignisse ──────────────────────────────────────
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

// ── WebSocket zu Streamerbot ──────────────────────────────
function connect() {
  try { ws = new WebSocket('ws://' + WS_HOST + ':' + WS_PORT); }
  catch(e) { scheduleReconnect(); return; }

  ws.onopen    = function() {
    wsRetry = 2000;
    // Session registrieren damit Streamerbot Chat-Messages weiterleitet
    ws.send(JSON.stringify({ event: 'gw_spacefight_register' }));
  };
  ws.onmessage = function(e) {
    try { handleSB(JSON.parse(e.data)); } catch(x) {}
  };
  ws.onclose = ws.onerror = function() { scheduleReconnect(); };
}

function scheduleReconnect() {
  setTimeout(connect, wsRetry);
  wsRetry = Math.min(wsRetry * 2, 15000);
}

// ── Streamerbot Message Handler ───────────────────────────
function handleSB(msg) {
  // Streamerbot schickt chat_msg Events weiter
  if (msg.event === 'chat_msg' || msg.event === 'twitch_chat') {
    var user    = msg.user || msg.username || '';
    var message = msg.message || msg.msg || '';
    parseCommand(user, message);
  }
}

// ── Twitch IRC direkt (falls kein SB) ────────────────────
var irc = null;

function connectIRC() {
  if (!CHANNEL) return;
  irc = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
  irc.onopen = function() {
    irc.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
    irc.send('PASS oauth:justinfan' + Math.floor(Math.random()*99999));
    irc.send('NICK justinfan' + Math.floor(Math.random()*99999));
    irc.send('JOIN #' + CHANNEL.toLowerCase());
  };
  irc.onmessage = function(e) {
    e.data.split('\r\n').forEach(function(line) {
      if (line.startsWith('PING')) { irc.send('PONG :tmi.twitch.tv'); return; }
      var m = line.match(/^(?:@\S+ )?:(\S+)!\S+ PRIVMSG #\S+ :(.*)$/);
      if (m) parseCommand(m[1], m[2].trim());
    });
  };
  irc.onclose = function() { setTimeout(connectIRC, 5000); };
}

// ── Command Parser ────────────────────────────────────────
function parseCommand(user, message) {
  // !fight @ziel oder !fight ziel
  var m = message.match(/^!fight\s+@?(\S+)/i);
  if (!m) return;

  var attacker = user.trim();
  var defender = m[1].replace(/^@/, '').trim();

  if (!attacker || !defender) return;
  if (attacker.toLowerCase() === defender.toLowerCase()) return; // kein Selbstmord

  // Cooldown prüfen
  var now = Date.now();
  var lastFight = recentFights[attacker.toLowerCase()] || 0;
  if (now - lastFight < COOLDOWN_MS) return;
  recentFights[attacker.toLowerCase()] = now;

  queue.push({ attacker: attacker, defender: defender });
  if (!isPlaying) next();
}

// ── Queue ─────────────────────────────────────────────────
function next() {
  if (queue.length === 0) { isPlaying = false; return; }
  isPlaying = true;
  var fight = queue.shift();
  runFight(fight.attacker, fight.defender);
}

// ── Kampf Engine ──────────────────────────────────────────
function runFight(attackerName, defenderName) {
  var shipA = SHIPS[Math.floor(Math.random() * SHIPS.length)];
  var shipD = SHIPS[Math.floor(Math.random() * SHIPS.length)];

  var hpA = 100;
  var hpD = 100;

  // Gewinner vorab bestimmen (zufällig, leichte Gewichtung nach Schiffsstärke)
  var powerA = shipA.power + Math.random() * 3;
  var powerD = shipD.power + Math.random() * 3;
  var attackerWins = powerA >= powerD;

  // Kampfrunden simulieren
  var rounds = [];
  var tmpA = hpA;
  var tmpD = hpD;

  for (var i = 0; i < 4; i++) {
    if (i % 2 === 0) {
      // Angreifer trifft Verteidiger
      var dmg = Math.floor(Math.random() * 20) + 10;
      if (!attackerWins && i >= 2) dmg = Math.floor(dmg * 0.4); // Verlierer trifft schwächer
      tmpD = Math.max(0, tmpD - dmg);
      var hit = Math.random() > 0.25;
      rounds.push({ type: hit ? 'hit_a' : 'miss', dmg: dmg, hp_a: tmpA, hp_d: tmpD });
    } else {
      // Verteidiger trifft Angreifer
      var dmg = Math.floor(Math.random() * 20) + 10;
      if (attackerWins && i >= 1) dmg = Math.floor(dmg * 0.4);
      tmpA = Math.max(0, tmpA - dmg);
      var hit = Math.random() > 0.25;
      rounds.push({ type: hit ? 'hit_d' : 'miss', dmg: dmg, hp_a: tmpA, hp_d: tmpD });
    }
  }

  // Finaler Todesstoß
  if (attackerWins) {
    tmpD = 0;
    rounds.push({ type: 'kill_a', hp_a: tmpA, hp_d: 0 });
  } else {
    tmpA = 0;
    rounds.push({ type: 'kill_d', hp_a: 0, hp_d: tmpD });
  }

  var winner = attackerWins ? attackerName : defenderName;
  var loser  = attackerWins ? defenderName : attackerName;

  showFight(attackerName, defenderName, shipA, shipD, rounds, winner, loser);

  // Ergebnis an Streamerbot zurücksenden (optional für Chatbot-Ausgabe)
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({
      event:   'spacefight_result',
      winner:  winner,
      loser:   loser,
      ship_w:  attackerWins ? shipA.name : shipD.name,
      ship_l:  attackerWins ? shipD.name : shipA.name,
    }));
  }
}

// ── Render ────────────────────────────────────────────────
function showFight(aName, dName, shipA, shipD, rounds, winner, loser) {
  var arena = document.getElementById('arena');

  var card = document.createElement('div');
  card.className = 'fight-card';
  card.innerHTML =
    '<div class="combatants">' +
      '<div class="pilot attacker">' +
        '<div class="pilot-name">' + esc(aName.toUpperCase()) + '</div>' +
        '<div class="pilot-ship">' + shipA.name + '</div>' +
      '</div>' +
      '<div class="vs-block">' +
        '<div class="vs-icon">&#x2694;</div>' +
        '<div class="vs-text">VS</div>' +
      '</div>' +
      '<div class="pilot defender">' +
        '<div class="pilot-name">' + esc(dName.toUpperCase()) + '</div>' +
        '<div class="pilot-ship">' + shipD.name + '</div>' +
      '</div>' +
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

  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      card.classList.add('enter');

      // Runden abspielen
      var delay = 500;
      rounds.forEach(function(r, i) {
        setTimeout(function() {
          updateHP(r.hp_a, r.hp_d);
          updateLog(r, aName, dName, winner, loser, i === rounds.length - 1);
        }, delay);
        delay += 900;
      });

      // Drain bar starten
      var db = document.getElementById('drain-bar');
      if (db) {
        var totalMs = delay + 1000;
        db.style.animationDuration = totalMs + 'ms';
        db.classList.add('running');
      }

      // Karte entfernen
      setTimeout(function() {
        card.classList.remove('enter');
        card.classList.add('exit');
        setTimeout(function() {
          if (card.parentNode) card.parentNode.removeChild(card);
          next();
        }, 380);
      }, delay + 1200);
    });
  });
}

function updateHP(hpA, hpD) {
  var barA = document.getElementById('hp-a');
  var barD = document.getElementById('hp-d');
  var lblA = document.getElementById('hp-a-lbl');
  var lblD = document.getElementById('hp-d-lbl');
  if (barA) barA.style.width = Math.max(0, hpA) + '%';
  if (barD) barD.style.width = Math.max(0, hpD) + '%';
  if (lblA) lblA.textContent = Math.max(0, hpA);
  if (lblD) lblD.textContent = Math.max(0, hpD);
}

function updateLog(round, aName, dName, winner, loser, isFinal) {
  var log = document.getElementById('clog');
  if (!log) return;

  if (isFinal) {
    var tpl = EVENTS_WIN[Math.floor(Math.random() * EVENTS_WIN.length)];
    var isAWin = winner === aName;
    var html = '<span class="winner ' + (isAWin ? 'cyan' : 'gold') + '">' +
      tpl.replace('{W}', esc(winner.toUpperCase()))
         .replace('{L}', esc(loser.toUpperCase())) +
      '</span>';
    log.innerHTML = html;
    return;
  }

  var text = '';
  if (round.type === 'hit_a') {
    var tpl = EVENTS_HIT[Math.floor(Math.random() * EVENTS_HIT.length)];
    text = '<span class="hit-a">' + esc(
      tpl.replace('{A}', aName.toUpperCase())
         .replace('{D}', dName.toUpperCase())
         .replace('{DMG}', round.dmg)
    ) + '</span>';
  } else if (round.type === 'hit_d') {
    var tpl = EVENTS_HIT[Math.floor(Math.random() * EVENTS_HIT.length)];
    text = '<span class="hit-d">' + esc(
      tpl.replace('{A}', dName.toUpperCase())
         .replace('{D}', aName.toUpperCase())
         .replace('{DMG}', round.dmg)
    ) + '</span>';
  } else {
    var tpl = EVENTS_MISS[Math.floor(Math.random() * EVENTS_MISS.length)];
    text = esc(tpl.replace('{A}', aName.toUpperCase()).replace('{D}', dName.toUpperCase()));
  }
  log.innerHTML = text;
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Test Mode: ?test=1 ────────────────────────────────────
if (params.get('test') === '1') {
  var testFights = [
    { attacker: 'JerichoRamirez', defender: 'HEADWiG' },
    { attacker: 'jazZz',          defender: 'HolderDiePolder' },
  ];
  var ti = 0;
  function testNext() {
    if (ti < testFights.length) {
      queue.push(testFights[ti++]);
      if (!isPlaying) next();
      setTimeout(testNext, 12000);
    }
  }
  setTimeout(testNext, 1000);
}

// ── Init ──────────────────────────────────────────────────
connect();
if (CHANNEL) connectIRC();
