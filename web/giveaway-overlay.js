// ════════════════════════════════════════════════════════
// CHAOS CREW – Giveaway Overlay JS
// ════════════════════════════════════════════════════════

var params  = new URLSearchParams(location.search);
var WS_HOST = params.get('host') || '192.168.178.39';
var WS_PORT = params.get('port') || '9090';

var ws            = null;
var wsRetry       = 2000;
var winnerTimeout = null;

function connect() {
  try { ws = new WebSocket('ws://' + WS_HOST + ':' + WS_PORT); }
  catch(e) { scheduleReconnect(); return; }

  ws.onopen = function() {
    wsRetry = 2000;
    ws.send(JSON.stringify({ event: 'gw_overlay_register' }));
    ws.send(JSON.stringify({ event: 'gw_get_all' }));
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

setInterval(function() {
  if (ws && ws.readyState === 1)
    ws.send(JSON.stringify({ event: 'gw_get_all' }));
}, 15000);

function handle(msg) {
  if (!msg || !msg.event) return;

  if (msg.event === 'gw_data') {
    renderFromData(msg);
    return;
  }

  if (msg.event === 'gw_overlay') {
    var overlay = document.getElementById('overlay');
    overlay.className = msg.open ? 'visible' : '';

    var st = document.getElementById('ov-status');
    st.textContent = msg.open ? 'OPEN' : 'CLOSED';
    st.className   = 'ov-status ' + (msg.open ? 'open' : 'closed');

    document.getElementById('ov-total').textContent   = msg.total   || 0;
    document.getElementById('ov-tickets').textContent = msg.tickets || 0;

    var top5html = '';
    var top5 = msg.top5 || [];
    for (var i = 0; i < top5.length; i++) {
      top5html += '<div class="ov-row">' +
        '<span class="ov-row-name">' + (i+1) + '. ' + esc(top5[i].name||'') + '</span>' +
        '<span class="ov-row-tickets">' + (top5[i].tickets||0) + ' T</span>' +
        '</div>';
    }
    document.getElementById('ov-top5').innerHTML = top5html;

    if (msg.winner) showWinner(msg.winner, msg.tickets || 0);
    else document.getElementById('winner-overlay').className = '';
    return;
  }

  if (msg.event === 'gw_status') {
    var isOpen = msg.status === 'open';
    var overlay = document.getElementById('overlay');
    overlay.className = isOpen ? 'visible' : '';
    var st = document.getElementById('ov-status');
    st.textContent = isOpen ? 'OPEN' : 'CLOSED';
    st.className   = 'ov-status ' + (isOpen ? 'open' : 'closed');
    return;
  }
}

function renderFromData(data) {
  var participants = data.participants || [];
  var active = participants.filter(function(p){ return !p.banned; });

  var overlay = document.getElementById('overlay');
  overlay.className = data.open ? 'visible' : '';

  var st = document.getElementById('ov-status');
  st.textContent = data.open ? 'OPEN' : 'CLOSED';
  st.className   = 'ov-status ' + (data.open ? 'open' : 'closed');

  var total   = active.length;
  var tickets = active.reduce(function(s,p){ return s + (parseInt(p.tickets)||0); }, 0);

  document.getElementById('ov-total').textContent   = total;
  document.getElementById('ov-tickets').textContent = tickets;

  active.sort(function(a,b){ return (parseInt(b.tickets)||0) - (parseInt(a.tickets)||0); });
  var top5 = active.slice(0,5);
  var html = '';
  for (var i = 0; i < top5.length; i++) {
    html += '<div class="ov-row">' +
      '<span class="ov-row-name">' + (i+1) + '. ' + esc(top5[i].display||top5[i].key||'') + '</span>' +
      '<span class="ov-row-tickets">' + (top5[i].tickets||0) + ' T</span>' +
      '</div>';
  }
  document.getElementById('ov-top5').innerHTML = html;
}

function showWinner(name, tickets) {
  var wo = document.getElementById('winner-overlay');
  document.getElementById('ov-winner-name').textContent    = name.toUpperCase();
  document.getElementById('ov-winner-tickets').textContent = tickets + ' Tickets';
  wo.className = 'show';
  if (winnerTimeout) clearTimeout(winnerTimeout);
  winnerTimeout = setTimeout(function(){ wo.className = ''; }, 30000);
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

connect();
