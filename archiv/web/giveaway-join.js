// ════════════════════════════════════════════════════════
// CHAOS CREW – Giveaway Join Animation JS
// ════════════════════════════════════════════════════════

var params   = new URLSearchParams(location.search);
var WS_HOST  = params.get('host') || '192.168.178.39';
var WS_PORT  = params.get('port') || '9090';
var HOLD_MS  = 4200;

var ws          = null;
var wsRetry     = 2000;
var queue       = [];
var isPlaying   = false;
var totalJoined = 0;

var STATUS_LINES = [
  'BETRITT DIE WARTESCHLANGE',
  'MELDET SICH FREIWILLIG',
  'NIMMT POSITION EIN',
  'REGISTRIERUNG LAEUFT',
  'SLOT WIRD GESICHERT',
  'ZUGANG BESTAETIGT',
  'TICKET WIRD AUSGESTELLT',
  'IDENTITAET VERIFIZIERT'
];

function connect() {
  try { ws = new WebSocket('ws://' + WS_HOST + ':' + WS_PORT); }
  catch(e) { scheduleReconnect(); return; }
  ws.onopen = function() {
    wsRetry = 2000;
    ws.send(JSON.stringify({ event: 'gw_join_register' }));
  };
  ws.onmessage = function(e) {
    try { handle(JSON.parse(e.data)); } catch(x) {}
  };
  ws.onclose = ws.onerror = function() { scheduleReconnect(); };
}

function scheduleReconnect() {
  setTimeout(connect, wsRetry);
  wsRetry = Math.min(wsRetry * 2, 15000);
}

function handle(msg) {
  if (msg && msg.event === 'gw_join') {
    totalJoined++;
    queue.push({ user: msg.user, nr: totalJoined });
    if (!isPlaying) next();
  }
}

function next() {
  if (queue.length === 0) { isPlaying = false; return; }
  isPlaying = true;
  var item = queue.shift();
  showCard(item.user, item.nr);
}

function showCard(username, nr) {
  var container = document.getElementById('container');
  var card = document.createElement('div');
  card.className = 'join-card';

  var nrStr      = '#' + pad(nr, 3);
  var statusText = STATUS_LINES[Math.floor(Math.random() * STATUS_LINES.length)];

  card.innerHTML =
    '<div class="queue-nr">' + nrStr + '</div>' +
    '<div class="divider"></div>' +
    '<div class="join-text">' +
      '<div class="join-username">' + esc(username) + '</div>' +
      '<div class="join-status" id="jst' + nr + '"></div>' +
    '</div>' +
    '<div class="queue-bar">' + buildBar(nr) + ' <span class="queue-count">' + nr + '</span></div>' +
    '<div class="ticket-badge">TICKET +1</div>' +
    '<div class="drain-bar" id="jdb' + nr + '"></div>';

  container.appendChild(card);

  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      card.classList.add('enter');

      setTimeout(function() {
        var el = document.getElementById('jst' + nr);
        if (el) typewriter(el, statusText, 38, null);

        var db = document.getElementById('jdb' + nr);
        if (db) {
          db.style.animationDuration = HOLD_MS + 'ms';
          db.classList.add('running');
        }

        setTimeout(function() {
          card.classList.remove('enter');
          card.classList.add('exit');
          setTimeout(function() {
            if (card.parentNode) card.parentNode.removeChild(card);
            next();
          }, 320);
        }, HOLD_MS);

      }, 420);
    });
  });
}

function typewriter(el, text, speed, cb) {
  var i = 0;
  function tick() {
    if (i <= text.length) {
      el.innerHTML = text.slice(0, i) + '<span class="cur"></span>';
      i++;
      setTimeout(tick, speed);
    } else {
      el.innerHTML = text + '...';
      if (cb) cb();
    }
  }
  tick();
}

function buildBar(n) {
  var filled = Math.min(n, 16);
  var s = '[';
  for (var i = 0; i < 16; i++) {
    if (i < filled - 1)      s += '-';
    else if (i === filled-1) s += '>';
    else                     s += '.';
  }
  return s + ']';
}

function pad(n, len) {
  var s = String(n);
  while (s.length < len) s = '0' + s;
  return s;
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Test mode: ?test=1
if (params.get('test') === '1') {
  var testUsers = ['JerichoRamirez','HEADWiG','jazZz','HolderDiePolder','JustCallMeDeimos'];
  var ti = 0;
  function testNext() {
    if (ti < testUsers.length) {
      totalJoined++;
      queue.push({ user: testUsers[ti++], nr: totalJoined });
      if (!isPlaying) next();
      setTimeout(testNext, 1800);
    }
  }
  setTimeout(testNext, 600);
}

connect();
