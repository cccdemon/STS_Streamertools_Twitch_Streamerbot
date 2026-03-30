// ════════════════════════════════════════════════════════
// CHAOS CREW – Giveaway Test Console JS
// Angepasst fuer Dezimal-Tickets und neue Ticket-Logik
// ════════════════════════════════════════════════════════

var SECS_PER_TICKET = 7200; // 2h = 1 Ticket
var SECS_PER_MSG    = 5;    // +5s pro Chat-Nachricht
var ws = null;

// ── WebSocket ─────────────────────────────────────────────
function connect() {
  var host = CC.validate.sanitize(document.getElementById('host').value, 'host');
  var port = CC.validate.getInputVal('port', 'port', 9090);
  if (ws) { ws.onclose=null; ws.close(); }
  try {
    ws = new WebSocket('ws://' + host + ':' + port);
    ws.onopen    = function() { setStatus(true);  addLog('Verbunden mit ' + host + ':' + port, 'info'); };
    ws.onmessage = function(e) {
      // Tickets in Antworten als Dezimalzahl formatieren
      var raw = e.data;
      try {
        var msg = JSON.parse(raw);
        if (msg.event === 'gw_data' && Array.isArray(msg.participants)) {
          msg.participants.forEach(function(p) {
            if (p.tickets !== undefined) {
              var t = parseFloat(p.tickets);
              p.tickets = isNaN(t) ? p.tickets : Math.round(t * 10000) / 10000;
            }
          });
          addLog('<- ' + JSON.stringify(msg), 'recv');
          showTicketSummary(msg.participants);
          return;
        }
      } catch(x) {}
      addLog('<- ' + pretty(raw), 'recv');
    };
    ws.onerror   = function()  { addLog('WebSocket Fehler', 'err'); };
    ws.onclose   = function()  { setStatus(false); addLog('Verbindung getrennt', 'info'); };
  } catch(e) { addLog('Verbindungsfehler: ' + e.message, 'err'); }
}

function disconnect() {
  if (ws) { ws.onclose=null; ws.close(); ws=null; }
  setStatus(false);
  addLog('Manuell getrennt', 'info');
}

function send(obj) {
  if (!ws || ws.readyState !== 1) { addLog('Nicht verbunden!', 'err'); return; }
  if (!CC.validate.validateWsPayload(obj)) { addLog('Payload blockiert', 'err'); return; }
  var json = JSON.stringify(obj);
  ws.send(json);
  addLog('-> ' + pretty(json), 'send');
}

function sendManual() {
  var raw = document.getElementById('manual-json').value.trim();
  var parsed = CC.validate.safeJsonParse(raw);
  if (!parsed) { addLog('Ungültiges JSON', 'err'); return; }
  send(parsed);
}

function formatJson() {
  try {
    var raw = document.getElementById('manual-json').value;
    document.getElementById('manual-json').value = JSON.stringify(JSON.parse(raw), null, 2);
  } catch(e) {}
}

// ── Keyword ───────────────────────────────────────────────
function sendKeyword() {
  var kw = document.getElementById('kw-input').value.trim();
  send({ event:'gw_cmd', cmd:'gw_set_keyword', keyword:kw });
}

// ── Ticket-Rechner ────────────────────────────────────────
function calcTickets() {
  var sec  = parseInt(document.getElementById('calc-sec').value)  || 0;
  var msgs = parseInt(document.getElementById('calc-msgs').value) || 0;
  var watchSec  = sec + (msgs * SECS_PER_MSG);
  var tickets   = watchSec / SECS_PER_TICKET;
  var el = document.getElementById('calc-result');
  el.textContent = fmtTickets(tickets) + ' T ' +
    '(' + fmtTime(sec) + ' + ' + msgs + ' Msgs x 5s = ' + fmtTime(watchSec) + ')';
  addLog('Rechner: ' + sec + 's + ' + msgs + ' Msgs = ' + fmtTime(watchSec) +
    ' = ' + fmtTickets(tickets) + ' Tickets', 'info');
}

// ── Watchtime simulieren (via add_ticket mit watchSec-Äquivalent) ──
function simWatchtime() {
  var user = document.getElementById('watch-user').value.trim();
  var sec  = parseInt(document.getElementById('watch-sec').value) || 0;
  if (!user || sec <= 0) return;

  // Wie viele manuelle Tickets entspricht das?
  var tickets = sec / SECS_PER_TICKET;
  var fullTickets = Math.floor(tickets);
  var remainder   = tickets - fullTickets;

  addLog('Watchtime Sim: ' + fmtTime(sec) + ' = ' + fmtTickets(tickets) + ' Tickets fuer ' + user, 'info');

  // Ganze Tickets als manuelle Adds
  var delay = 0;
  for (var i = 0; i < fullTickets; i++) {
    (function(d){ setTimeout(function(){ send({ event:'gw_cmd', cmd:'gw_add_ticket', user:user }); }, d); })(delay);
    delay += 100;
  }

  // Rest-Info anzeigen
  var el = document.getElementById('watch-result');
  el.textContent = fmtTickets(tickets) + ' T (' + fmtTime(sec) + ')';

  setTimeout(function() {
    send({ event:'gw_get_all' });
  }, delay + 300);
}

// ── Chat-Msgs simulieren ──────────────────────────────────
function simChatMsgs() {
  var user  = document.getElementById('chat-user').value.trim();
  var count = parseInt(document.getElementById('chat-count').value) || 1;
  if (!user) return;

  var watchSec = count * SECS_PER_MSG;
  var tickets  = watchSec / SECS_PER_TICKET;
  addLog('Chat Sim: ' + count + ' Msgs x 5s = +' + fmtTime(watchSec) +
    ' Watchtime = +' + fmtTickets(tickets) + ' T fuer ' + user, 'info');

  // Sendet als gw_data-update direkt – da wir Streamerbot nicht direkt triggern können,
  // zeigen wir nur was passieren würde und senden danach gw_get_all
  var delay = 0;
  var batchSize = Math.min(count, 20); // max 20 senden um nicht zu spammen
  for (var i = 0; i < batchSize; i++) {
    (function(d){ setTimeout(function(){
      send({ event:'chat_msg', user:user });
    }, d); })(delay);
    delay += 150;
  }
  if (count > batchSize) {
    addLog('Hinweis: Nur ' + batchSize + '/' + count + ' Msgs gesendet (Limit)', 'info');
  }
  setTimeout(function(){ send({ event:'gw_get_all' }); }, delay + 300);
}

function simChatMsgs720() {
  // 720 Msgs * 5s = 3600s = 0.5 Ticket
  var user = document.getElementById('chat-user').value.trim() || 'TestViewer';
  addLog('720 Chat-Msgs Simulation: 720 x 5s = 3600s = 0.5 Ticket fuer ' + user, 'info');
  addLog('HINWEIS: Diese Msgs muessen durch Streamerbot GW_B_ChatMessage verarbeitet werden.', 'info');
  addLog('Direkt testbar: Manuell 1 Ticket adden entspricht 7200s Watchtime.', 'info');

  // 1 manuelles halbes-Ticket = wir addieren 1 ganzes und erklären
  addLog('Fuer 0.5T-Test: +1 Ticket manuel = 7200s setzen, dann watchSec manuell auf 3600 reduzieren nicht moeglich.', 'info');
  addLog('Alternative: Ticket-Rechner nutzen zur Verifikation der Formel.', 'info');
  document.getElementById('calc-sec').value  = '3600';
  document.getElementById('calc-msgs').value = '0';
  calcTickets();
}

// ── Tickets manuell ───────────────────────────────────────
function sendCmd(cmd, inputId) {
  var user = document.getElementById(inputId).value.trim();
  if (!user) return;
  send({ event:'gw_cmd', cmd:cmd, user:user });
}

// ── Overlays ──────────────────────────────────────────────
function testWinner() {
  var name = document.getElementById('ov-winner').value.trim();
  if (!name) return;
  send({
    event:'gw_overlay', open:true, total:5, tickets:3.5,
    top5:[{ name:name, tickets:1.5 }, { name:'TestViewer2', tickets:0.5 }],
    winner:name
  });
  addLog('Gewinner-Test: ' + name + ' (mit Dezimal-Tickets)', 'info');
}

function testClearWinner() {
  send({ event:'gw_overlay', open:true, total:5, tickets:3.5, top5:[], winner:null });
  addLog('Gewinner geloescht', 'info');
}

function testJoinAnimation() {
  var user = document.getElementById('join-user').value.trim() || 'TestViewer';
  send({ event:'gw_join', user:user });
  addLog('Join-Animation: ' + user, 'info');
}

function testSpacefight() {
  var attacker = document.getElementById('sf-attacker').value.trim() || 'JerichoRamirez';
  var defender = document.getElementById('sf-defender').value.trim() || 'HEADWiG';
  var ships = ['PERSEUS','HAMMERHEAD','ARROW','GLADIUS','SABRE','HORNET'];
  var shipA = ships[Math.floor(Math.random() * ships.length)];
  var shipD = ships[Math.floor(Math.random() * ships.length)];
  var attackerWins = Math.random() > 0.5;
  var result = {
    event:    'spacefight_result',
    winner:   attackerWins ? attacker : defender,
    loser:    attackerWins ? defender : attacker,
    ship_w:   attackerWins ? shipA : shipD,
    ship_l:   attackerWins ? shipD : shipA,
    attacker: attacker,
    defender: defender,
    ts:       new Date().toISOString()
  };
  // WS-Event an Streamerbot
  send(result);
  // Direkt in API speichern (OBS-Check wird umgangen)
  var apiHost = window.location.hostname || '192.168.178.34';
  var apiPort = 3000;
  fetch('http://' + apiHost + ':' + apiPort + '/api/spacefight', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result)
  }).then(function(r) {
    addLog('SF API: ' + (r.ok ? 'gespeichert' : 'Fehler ' + r.status), r.ok ? 'info' : 'err');
  }).catch(function(e) {
    addLog('SF API Fehler: ' + e.message, 'err');
  });
  addLog('Raumkampf-Sim: ' + attacker + ' vs ' + defender + ' → Sieger: ' + (attackerWins ? attacker : defender), 'info');
}

// ── Stream Simulation ─────────────────────────────────────
function simStream() {
  var users = document.getElementById('sim-users').value
    .split(',').map(function(u){ return u.trim(); }).filter(Boolean);
  var ticks = parseInt(document.getElementById('sim-ticks').value) || 3;
  if (!users.length) return;

  addLog('--- Stream Sim: ' + users.length + ' User x ' + ticks + ' Tickets ---', 'info');

  var delay = 0;
  setTimeout(function(){ send({ event:'gw_cmd', cmd:'gw_open' }); }, delay);
  delay += 300;

  users.forEach(function(user) {
    for (var t = 0; t < ticks; t++) {
      (function(d){ setTimeout(function(){
        send({ event:'gw_cmd', cmd:'gw_add_ticket', user:user });
      }, d); })(delay);
      delay += 120;
    }
  });

  setTimeout(function() {
    send({ event:'gw_get_all' });
    addLog('--- Simulation abgeschlossen ---', 'info');
  }, delay + 400);
}

function simStreamWithChat() {
  var users = document.getElementById('sim-users').value
    .split(',').map(function(u){ return u.trim(); }).filter(Boolean);
  if (!users.length) return;

  addLog('--- Stream Sim MIT Chat-Msgs ---', 'info');
  addLog('Jeder User: 1 Ticket Watchtime + 10 Chat-Msgs (+50s Watchtime)', 'info');

  var delay = 0;
  setTimeout(function(){ send({ event:'gw_cmd', cmd:'gw_open' }); }, delay);
  delay += 300;

  users.forEach(function(user) {
    // 1 Ticket via manuell add
    (function(d){ setTimeout(function(){
      send({ event:'gw_cmd', cmd:'gw_add_ticket', user:user });
    }, d); })(delay);
    delay += 150;

    // 10 Chat-Msgs (jede +5s = 50s gesamt)
    for (var m = 0; m < 10; m++) {
      (function(d){ setTimeout(function(){
        send({ event:'chat_msg', user:user });
      }, d); })(delay);
      delay += 200; // > 150ms damit Cooldown nicht greift
    }
    delay += 200;
  });

  setTimeout(function() {
    send({ event:'gw_get_all' });
    addLog('--- Simulation mit Chat abgeschlossen ---', 'info');
  }, delay + 400);
}

// ── Ticket Summary nach gw_data ───────────────────────────
function showTicketSummary(participants) {
  if (!participants || !participants.length) return;
  var active = participants.filter(function(p){ return !p.banned; });
  var total  = active.reduce(function(s,p){ return s + (parseFloat(p.tickets)||0); }, 0);
  addLog('SUMMARY: ' + active.length + ' Teilnehmer | ' +
    fmtTickets(total) + ' Tickets gesamt', 'info');
  active.sort(function(a,b){ return (parseFloat(b.tickets)||0) - (parseFloat(a.tickets)||0); })
    .slice(0,5).forEach(function(p, i) {
      var t = parseFloat(p.tickets) || 0;
      var chance = total > 0 ? ((t / total) * 100).toFixed(1) : '0.0';
      addLog('  #' + (i+1) + ' ' + (p.display||p.key) + ': ' +
        fmtTickets(t) + ' T (' + chance + '%) | ' + fmtTime(parseInt(p.watchSec)||0), 'info');
    });
}

// ── Utils ─────────────────────────────────────────────────
function fmtTickets(t) {
  var val = parseFloat(t) || 0;
  // Trailingnullen entfernen, aber min 1 Dezimalstelle
  var s = val.toFixed(4).replace(/0+$/, '').replace(/\.$/, '.0');
  return s;
}

function fmtTime(s) {
  s = parseInt(s) || 0;
  var h = Math.floor(s / 3600);
  var m = Math.floor((s % 3600) / 60);
  var sec = s % 60;
  return h + ':' + pad2(m) + ':' + pad2(sec);
}

function addLog(msg, type) {
  var el  = document.getElementById('log');
  var now = new Date();
  var ts  = pad2(now.getHours()) + ':' + pad2(now.getMinutes()) + ':' + pad2(now.getSeconds());
  var div = document.createElement('div');
  div.innerHTML = '<span class="log-ts">[' + ts + ']</span><span class="log-' + type + '">' + escHtml(msg) + '</span>';
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
  while (el.children.length > 300) el.removeChild(el.firstChild);
}

function clearLog() { document.getElementById('log').innerHTML = ''; }

function setStatus(on) {
  var el = document.getElementById('status');
  el.className   = on ? 'on' : 'off';
  el.textContent = on ? 'ONLINE' : 'OFFLINE';
}

function pretty(json) {
  try { return JSON.stringify(JSON.parse(json)); } catch(e) { return json; }
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function pad2(n) { return n < 10 ? '0' + n : String(n); }

connect();
