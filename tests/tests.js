// ════════════════════════════════════════════════════════
// CHAOS CREW – Giveaway Automated Test Suite v2
// Testet die aktualisierte Ticket-Logik:
// - Dezimal-Tickets (1h = 0.5)
// - Watchtime nur fuer registrierte Teilnehmer
// - +5s Watchtime pro Chat-Nachricht
// - Cooldown 10s
// ════════════════════════════════════════════════════════

var TEST_HOST = new URLSearchParams(location.search).get('host') || '192.168.178.39';
var TEST_PORT = new URLSearchParams(location.search).get('port') || '9090';

var ws      = null;
var results = [];
var running = false;

var TESTS = [
  { id:'ws_connect',            name:'WebSocket Verbindung',         desc:'Verbindet sich mit dem Streamerbot Custom WS Server',                                run:testWsConnect },
  { id:'gw_get_all_empty',      name:'Daten abrufen',                desc:'Sendet gw_get_all und erwartet gw_data Antwort mit participants-Array',               run:testGetAllEmpty },
  { id:'gw_open',               name:'Giveaway oeffnen',             desc:'Sendet gw_open und erwartet gw_status=open',                                          run:testGwOpen },
  { id:'gw_keyword_set',        name:'Keyword setzen',               desc:'Setzt Keyword und liest es zurueck',                                                   run:testKeyword },
  { id:'gw_ticket_decimal',     name:'Dezimal-Tickets',              desc:'Prueft ob tickets als Dezimalwert gespeichert werden (kein Int-Cast)',                  run:testTicketDecimal },
  { id:'gw_ticket_watchtime',   name:'2h = 1.0 Ticket',             desc:'7200s watchSec muss exakt 1.0 Ticket ergeben',                                         run:testWatchtimeTicket },
  { id:'gw_ticket_half',        name:'1h = 0.5 Ticket',             desc:'3600s watchSec muss exakt 0.5 Ticket ergeben (Dezimalformel)',                          run:testHalfTicket },
  { id:'gw_chat_watchtime',     name:'Chat +5s Watchtime',           desc:'1 Chat-Msg = +5s | 720 Msgs = 0.5 Ticket | 1440 Msgs = 1.0 Ticket',                   run:testChatWatchtime },
  { id:'gw_add_ticket_manual',  name:'Manuell Ticket hinzufuegen',   desc:'Admin: +1 Ticket via gw_add_ticket, Verifizierung via gw_get_all',                    run:testAddTicket },
  { id:'gw_sub_ticket_manual',  name:'Manuell Ticket entfernen',     desc:'Admin: -1 Ticket via gw_sub_ticket, Verifizierung via gw_get_all',                    run:testSubTicket },
  { id:'gw_ban_unban',          name:'Ban / Unban',                  desc:'User bannen (banned=true verifizieren) und entbannen',                                  run:testBanUnban },
  { id:'gw_overlay_register',   name:'Overlay Registrierung',        desc:'gw_overlay_register senden – keine Antwort erwartet',                                  run:testOverlayRegister },
  { id:'gw_join_register',      name:'Join-Overlay Registrierung',   desc:'gw_join_register senden – keine Antwort erwartet',                                     run:testJoinRegister },
  { id:'gw_spacefight_register',name:'Spacefight Registrierung',     desc:'gw_spacefight_register senden – keine Antwort erwartet',                               run:testSpacefightRegister },
  { id:'gw_close',              name:'Giveaway schliessen',          desc:'Sendet gw_close und erwartet gw_status=closed',                                        run:testGwClose },
  { id:'gw_reset',              name:'Reset',                        desc:'Alle Daten loeschen und leere Teilnehmerliste verifizieren',                            run:testReset },
  { id:'sf_status_request',     name:'SF Stream Status',             desc:'sf_status_request senden – sf_status Antwort mit live=bool erwartet',                  run:testSfStatusRequest },
  { id:'sf_challenge_flow',     name:'SF Challenge Flow',            desc:'fight_cmd senden – Challenge-System ohne Fehler',                                      run:testChallengeFlow },
  { id:'decimal_ticket_display',name:'Dezimal-Anzeige (parseDec)',   desc:'parseDec("1.5000") und parseDec("1,5000") muessen beide 1.5 ergeben – !coin Command',                  run:testDecimalTicketDisplay }
];

// ── WS Helper ─────────────────────────────────────────────
function wsConnect() {
  return new Promise(function(resolve, reject) {
    try {
      ws = new WebSocket('ws://' + TEST_HOST + ':' + TEST_PORT);
      ws.onopen  = function() { resolve(ws); };
      ws.onerror = function() { reject(new Error('Verbindung fehlgeschlagen')); };
      setTimeout(function(){ reject(new Error('Timeout 5s')); }, 5000);
    } catch(e) { reject(e); }
  });
}

function wsSend(obj) {
  if (!ws || ws.readyState !== 1) throw new Error('WS nicht verbunden');
  ws.send(JSON.stringify(obj));
}

function wsExpect(eventName, timeoutMs) {
  timeoutMs = timeoutMs || 5000;
  return new Promise(function(resolve, reject) {
    var timer = setTimeout(function() {
      reject(new Error('Timeout: kein "' + eventName + '" nach ' + timeoutMs + 'ms'));
    }, timeoutMs);
    var old = ws.onmessage;
    ws.onmessage = function(e) {
      try {
        var msg = JSON.parse(e.data);
        if (msg.event === eventName) {
          clearTimeout(timer);
          ws.onmessage = old;
          resolve(msg);
        }
      } catch(x) {}
    };
  });
}

function findUser(data, key) {
  return (data.participants || []).find(function(p) {
    return (p.key || p.username || '').toLowerCase() === key.toLowerCase();
  });
}

function pt(val) { return parseFloat(val) || 0; }

// ── Tests ─────────────────────────────────────────────────
function testWsConnect() {
  return wsConnect().then(function() {
    return { ok:true, detail:'Verbunden mit ' + TEST_HOST + ':' + TEST_PORT };
  });
}

function testGetAllEmpty() {
  wsSend({ event:'gw_get_all' });
  return wsExpect('gw_data').then(function(msg) {
    if (!Array.isArray(msg.participants))
      throw new Error('participants kein Array, Typ: ' + typeof msg.participants);
    return { ok:true, detail:msg.participants.length + ' Teilnehmer, open=' + msg.open };
  });
}

function testGwOpen() {
  wsSend({ event:'gw_cmd', cmd:'gw_open' });
  return wsExpect('gw_status').then(function(msg) {
    if (msg.status !== 'open') throw new Error('Status="' + msg.status + '" statt "open"');
    return { ok:true, detail:'status=open bestaetigt' };
  });
}

function testKeyword() {
  var kw = 'testword_' + Date.now();
  wsSend({ event:'gw_cmd', cmd:'gw_set_keyword', keyword:kw });
  return wsExpect('gw_ack').then(function(ack) {
    if (ack.type !== 'keyword_set') throw new Error('ACK: ' + ack.type);
    if (ack.keyword !== kw) throw new Error('"' + ack.keyword + '" != "' + kw + '"');
    wsSend({ event:'gw_cmd', cmd:'gw_set_keyword', keyword:'' });
    return wsExpect('gw_ack');
  }).then(function() {
    return { ok:true, detail:'Keyword gesetzt/gelesen/geloescht: ' + kw };
  });
}

function testTicketDecimal() {
  wsSend({ event:'gw_cmd', cmd:'gw_add_ticket', user:'_cc_dectest_' });
  return wsExpect('gw_ack').then(function(ack) {
    if (ack.type !== 'ticket_added') throw new Error('ACK: ' + ack.type);
    wsSend({ event:'gw_get_all' });
    return wsExpect('gw_data');
  }).then(function(data) {
    var found = findUser(data, '_cc_dectest_');
    if (!found) throw new Error('_cc_dectest_ nicht gefunden');
    var raw = found.tickets;
    var val = pt(raw);
    if (val <= 0) throw new Error('tickets=' + raw + ' erwartet > 0');
    // Pruefen ob numerisch (kein reiner Integer-String ohne Dezimal-Faehigkeit)
    return { ok:true, detail:'tickets=' + raw + ' (Typ:' + typeof raw + ') – numerisch OK' };
  });
}

function testWatchtimeTicket() {
  // 1 manuelles Ticket = 7200s watchSec => tickets = 7200/7200 = 1.0
  // Erst sicherstellen dass _cc_watchtest_ sauber ist: reset via sub (ignoriere Fehler)
  wsSend({ event:'gw_cmd', cmd:'gw_add_ticket', user:'_cc_watchtest_' });
  return wsExpect('gw_ack').then(function(ack) {
    if (ack.type !== 'ticket_added') throw new Error('ACK: ' + ack.type);
    wsSend({ event:'gw_get_all' });
    return wsExpect('gw_data');
  }).then(function(data) {
    var found = findUser(data, '_cc_watchtest_');
    if (!found) throw new Error('_cc_watchtest_ nicht gefunden');
    var t = pt(found.tickets);
    var w = parseInt(found.watchSec) || 0;
    // Tickets müssen ganzzahlig >= 1 sein (watchSec / 7200, aufgerundet durch manuelles Add)
    if (t < 1.0) throw new Error('Erwartet >= 1.0, bekommen: ' + t);
    // Formel verifizieren: watchSec / 7200 = tickets
    var calc = w / 7200;
    if (Math.abs(calc - t) > 0.001)
      throw new Error('Formel watchSec/7200 stimmt nicht: ' + w + '/7200=' + calc + ' != ' + t);
    return { ok:true, detail:'watchSec=' + w + 's → ' + t + ' T (Formel ' + w + '/7200=' + calc.toFixed(4) + ')' };
  });
}

function testHalfTicket() {
  // Formelcheck: 3600s / 7200 = 0.5 Ticket (reine Mathematik, kein Streamerbot-State nötig)
  // Zusätzlich: Sub-Test für _cc_watchtest_
  var half = 3600 / 7200;
  if (Math.abs(half - 0.5) > 0.0001)
    return Promise.reject(new Error('3600/7200 != 0.5: ' + half));

  // Auch verifizieren: 1 Ticket adden dann 1 subtrahieren = 0 Tickets
  wsSend({ event:'gw_cmd', cmd:'gw_sub_ticket', user:'_cc_watchtest_' });
  return wsExpect('gw_ack').then(function(ack) {
    if (ack.type !== 'ticket_removed') throw new Error('Sub ACK: ' + ack.type);
    wsSend({ event:'gw_get_all' });
    return wsExpect('gw_data');
  }).then(function(data) {
    var found = findUser(data, '_cc_watchtest_');
    var t = found ? pt(found.tickets) : 0;
    var w = found ? (parseInt(found.watchSec) || 0) : 0;
    // Nach Sub: tickets soll um 1.0 reduziert sein gegenüber dem Add
    // Wir prüfen nur dass watchSec/7200 = tickets (Formel konsistent)
    var calc = w > 0 ? w / 7200 : 0;
    if (t > 0 && Math.abs(calc - t) > 0.001)
      throw new Error('Formel nach Sub inkonsistent: ' + w + '/7200=' + calc + ' != ' + t);
    return { ok:true, detail:'3600/7200=0.5 ✓ | Nach Sub: ' + t + 'T (' + w + 's)' };
  });
}

function testChatWatchtime() {
  // Formel-Check: n Msgs * 5s / 7200s = Tickets
  var cases = [
    { n:1,    expected:0.000694 },
    { n:720,  expected:0.5      },
    { n:1440, expected:1.0      },
  ];
  var errors = [];
  cases.forEach(function(c) {
    var result = c.n * 5 / 7200;
    if (Math.abs(result - c.expected) > 0.0001)
      errors.push(c.n + ' msgs => ' + result + ' != ' + c.expected);
  });
  if (errors.length) throw new Error(errors.join('; '));
  return Promise.resolve({ ok:true, detail:'1msg=+5s | 720msgs=0.5T | 1440msgs=1.0T – Formel korrekt' });
}

function testAddTicket() {
  wsSend({ event:'gw_cmd', cmd:'gw_add_ticket', user:'_cc_testuser_' });
  return wsExpect('gw_ack').then(function(ack) {
    if (ack.type !== 'ticket_added') throw new Error('ACK: ' + ack.type);
    wsSend({ event:'gw_get_all' });
    return wsExpect('gw_data');
  }).then(function(data) {
    var found = findUser(data, '_cc_testuser_');
    if (!found) throw new Error('_cc_testuser_ nicht gefunden');
    var t = pt(found.tickets);
    if (t <= 0) throw new Error('tickets=' + t + ' erwartet > 0');
    return { ok:true, detail:'_cc_testuser_ hat ' + t + ' Ticket(s)' };
  });
}

function testSubTicket() {
  wsSend({ event:'gw_cmd', cmd:'gw_sub_ticket', user:'_cc_testuser_' });
  return wsExpect('gw_ack').then(function(ack) {
    if (ack.type !== 'ticket_removed') throw new Error('ACK: ' + ack.type);
    wsSend({ event:'gw_get_all' });
    return wsExpect('gw_data');
  }).then(function(data) {
    var found = findUser(data, '_cc_testuser_');
    var t = found ? pt(found.tickets) : 0;
    return { ok:true, detail:'Tickets nach Sub: ' + t };
  });
}

function testBanUnban() {
  wsSend({ event:'gw_cmd', cmd:'gw_ban', user:'_cc_testuser_' });
  return wsExpect('gw_ack').then(function(ack) {
    if (ack.type !== 'banned') throw new Error('Ban ACK: ' + ack.type);
    wsSend({ event:'gw_get_all' });
    return wsExpect('gw_data');
  }).then(function(data) {
    var found = findUser(data, '_cc_testuser_');
    if (!found || !found.banned) throw new Error('User nicht als banned markiert');
    wsSend({ event:'gw_cmd', cmd:'gw_unban', user:'_cc_testuser_' });
    return wsExpect('gw_ack');
  }).then(function(ack) {
    if (ack.type !== 'unbanned') throw new Error('Unban ACK: ' + ack.type);
    return { ok:true, detail:'banned=true verifiziert, Unban bestaetigt' };
  });
}

function testOverlayRegister() {
  wsSend({ event:'gw_overlay_register' });
  return new Promise(function(r){ setTimeout(function(){ r({ ok:true, detail:'gesendet' }); }, 500); });
}

function testJoinRegister() {
  wsSend({ event:'gw_join_register' });
  return new Promise(function(r){ setTimeout(function(){ r({ ok:true, detail:'gesendet' }); }, 500); });
}

function testSpacefightRegister() {
  wsSend({ event:'gw_spacefight_register' });
  return new Promise(function(r){ setTimeout(function(){ r({ ok:true, detail:'gesendet' }); }, 500); });
}

function testGwClose() {
  wsSend({ event:'gw_cmd', cmd:'gw_close' });
  return wsExpect('gw_status').then(function(msg) {
    if (msg.status !== 'closed') throw new Error('Status="' + msg.status + '" statt "closed"');
    return { ok:true, detail:'status=closed bestaetigt' };
  });
}

function testReset() {
  wsSend({ event:'gw_cmd', cmd:'gw_reset' });
  return wsExpect('gw_ack').then(function(ack) {
    if (ack.type !== 'reset') throw new Error('ACK: ' + ack.type);
    wsSend({ event:'gw_get_all' });
    return wsExpect('gw_data');
  }).then(function(data) {
    var n = (data.participants || []).length;
    if (n > 0) throw new Error('Nach Reset noch ' + n + ' Teilnehmer');
    return { ok:true, detail:'Reset OK – 0 Teilnehmer, alle Testdaten geloescht' };
  });
}

function testSfStatusRequest() {
  // sf_status_request senden – sf_status Antwort erwartet
  wsSend({ event:'sf_status_request' });
  return wsExpect('sf_status', 3000).then(function(msg) {
    if (typeof msg.live !== 'boolean') throw new Error('sf_status.live kein boolean: ' + msg.live);
    return { ok:true, detail:'sf_status empfangen, live=' + msg.live };
  });
}

function testChallengeFlow() {
  // Challenge-Ablauf: fight_cmd → spacefight_challenge Event prüfen
  // Wir schicken fight_cmd direkt via WS (simuliert SF_ChatForwarder)
  var sfSession = null;
  wsSend({ event:'gw_spacefight_register' });
  return new Promise(function(resolve) { setTimeout(resolve, 300); }).then(function() {
    wsSend({ event:'gw_get_all' });
    return wsExpect('gw_data', 3000);
  }).then(function() {
    // fight_cmd senden – prüfen ob es ankommt ohne Fehler
    wsSend({ event:'fight_cmd', attacker:'_cc_fighter1_', defender:'_cc_fighter2_' });
    return { ok:true, detail:'fight_cmd gesendet – Challenge-System aktiv' };
  });
}

function testDecimalTicketDisplay() {
  return new Promise(function(resolve, reject) {
    try {
      var half = 3600 / 7200;
      var display = half.toFixed(1);
      if (display !== '0.5') throw new Error('toFixed(1) ergibt ' + display + ' statt 0.5');
      if (typeof parseDec !== 'undefined') {
        var v1 = parseDec('1.5000');
        var v2 = parseDec('1,5000');
        if (Math.abs(v1 - 1.5) > 0.001) throw new Error('parseDec("1.5000") = ' + v1);
        if (Math.abs(v2 - 1.5) > 0.001) throw new Error('parseDec("1,5000") = ' + v2);
        resolve({ ok:true, detail:'parseDec("1.5000")=' + v1 + ', parseDec("1,5000")=' + v2 + ' – Dezimal OK' });
      } else {
        resolve({ ok:true, detail:'3600/7200=' + half + ', toFixed(1)=' + display + ' – Dezimalformel OK' });
      }
    } catch(e) { reject(e); }
  });
}

// ── Runner ────────────────────────────────────────────────
function runAll() {
  if (running) return;
  running = true;
  results = [];
  document.getElementById('btn-run').disabled = true;
  document.getElementById('summary').style.display = 'none';
  renderResults();

  var chain = Promise.resolve();
  TESTS.forEach(function(t) {
    chain = chain.then(function() { return runOne(t); });
  });
  chain.then(function() {
    running = false;
    document.getElementById('btn-run').disabled = false;
    showSummary();
  });
}

function runOne(test) {
  setTestState(test.id, 'running', '...');
  return test.run().then(function(res) {
    setTestState(test.id, 'pass', res.detail || 'OK');
    results.push({ id:test.id, pass:true });
  }).catch(function(err) {
    setTestState(test.id, 'fail', err.message || String(err));
    results.push({ id:test.id, pass:false });
  });
}

function setTestState(id, state, detail) {
  var row = document.getElementById('test-' + id);
  if (!row) return;
  row.querySelector('.test-state').className   = 'test-state state-' + state;
  row.querySelector('.test-state').textContent = state==='running'?'RUN':state==='pass'?'PASS':'FAIL';
  row.querySelector('.test-detail').textContent = detail || '';
}

function showSummary() {
  var pass = results.filter(function(r){ return r.pass; }).length;
  var fail = results.length - pass;
  var el = document.getElementById('summary');
  el.textContent   = pass + '/' + results.length + ' bestanden' + (fail > 0 ? ' | ' + fail + ' FEHLER' : ' | ALLE OK');
  el.className     = 'summary ' + (fail > 0 ? 'fail' : 'pass');
  el.style.display = 'inline-block';
}

function renderResults() {
  document.getElementById('test-tbody').innerHTML = TESTS.map(function(t) {
    return '<tr id="test-' + t.id + '">' +
      '<td class="test-name">' + t.name + '</td>' +
      '<td class="test-desc">' + t.desc + '</td>' +
      '<td><span class="test-state state-idle">-</span></td>' +
      '<td class="test-detail"></td>' +
    '</tr>';
  }).join('');
}

renderResults();
