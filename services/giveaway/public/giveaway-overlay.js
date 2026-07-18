// ════════════════════════════════════════════════════════
// CHAOS CREW – Giveaway Overlay JS
// Winner-only overlay: only renders when a winner is announced.
// ════════════════════════════════════════════════════════

var ws            = null;
var wsRetry       = 2000;
var winnerTimeout = null;

var _q      = new URLSearchParams(location.search);
var OV_TEAM = _q.get('team') || '';
var OV_KEY  = _q.get('key')  || '';

function safeParseLocal(s) {
  try { return JSON.parse(s); } catch (e) { return null; }
}

function connect() {
  var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  try { ws = new WebSocket(proto + '//' + location.host + '/giveaway/overlay-ws'); }
  catch(e) { scheduleReconnect(); return; }

  ws.onopen = function() {
    wsRetry = 2000;
    ws.send(JSON.stringify({ event: 'overlay_subscribe', teamId: OV_TEAM, key: OV_KEY }));
  };
  ws.onmessage = function(e) {
    var msg = safeParseLocal(e.data);
    if (msg) handle(msg);
  };
  ws.onclose = ws.onerror = function() { scheduleReconnect(); };
}

function scheduleReconnect() {
  setTimeout(connect, wsRetry);
  wsRetry = Math.min(wsRetry * 2, 15000);
}

function handle(msg) {
  if (!msg || msg.event !== 'gw_overlay') return;
  if (msg.winner) showWinner(msg.winner, msg.coins || 0);
  else document.getElementById('winner-overlay').className = '';
}

function showWinner(name, tickets) {
  var wo = document.getElementById('winner-overlay');
  document.getElementById('ov-winner-name').textContent    = String(name).toUpperCase();
  document.getElementById('ov-winner-tickets').textContent = tickets + ' Tickets';
  wo.className = 'show';
  if (winnerTimeout) clearTimeout(winnerTimeout);
  winnerTimeout = setTimeout(function(){ wo.className = ''; }, 30000);
}

connect();
