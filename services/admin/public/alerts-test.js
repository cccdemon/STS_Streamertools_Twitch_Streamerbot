// ════════════════════════════════════════════════════════
// CHAOS CREW – Alert Test Console JS
// Verbindet auf /alerts/ws (via Caddy) und sendet
// { event:'cc_test', alertType, ... } an den Alert-Service,
// der den Test-Alert an alle Overlays (overlay.html) fanned.
// ════════════════════════════════════════════════════════

var ws = null;
var wsRetry = 2000;
var wsRetryTimer = null;

// ── WebSocket ─────────────────────────────────────────────
function connectWS() {
  var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  var url = proto + '//' + location.host + '/alerts/ws';
  if (ws) { ws.onclose = null; ws.close(); }
  try {
    ws = new WebSocket(url);
    ws.onopen = function() {
      wsRetry = 2000;
      if (wsRetryTimer) { clearTimeout(wsRetryTimer); wsRetryTimer = null; }
      setStatus(true);
      log('Verbunden: ' + url, 'info');
      ws.send(JSON.stringify({ event: 'cc_identify', role: 'alerts-test' }));
    };
    ws.onmessage = function(e) { log('<- ' + pretty(e.data), 'recv'); };
    ws.onerror = function() { log('WebSocket Fehler', 'err'); };
    ws.onclose = function() {
      setStatus(false);
      log('Verbindung getrennt – reconnect in ' + (wsRetry / 1000) + 's', 'info');
      wsRetryTimer = setTimeout(connectWS, wsRetry);
      wsRetry = Math.min(wsRetry * 2, 15000);
    };
  } catch(e) { log('Fehler: ' + e.message, 'err'); }
}

function reconnect() {
  if (wsRetryTimer) { clearTimeout(wsRetryTimer); wsRetryTimer = null; }
  connectWS();
}

function disconnect() {
  if (wsRetryTimer) { clearTimeout(wsRetryTimer); wsRetryTimer = null; }
  if (ws) { ws.onclose = null; ws.close(); ws = null; }
  setStatus(false);
}

function send(obj) {
  if (!ws || ws.readyState !== 1) { log('Nicht verbunden!', 'err'); return; }
  ws.send(JSON.stringify(obj));
  log('-> ' + pretty(JSON.stringify(obj)), 'send');
}

// ── Test-Alert feuern ─────────────────────────────────────
function val(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }

function fire(type, extra) {
  var msg = {
    event:   'cc_test',
    alertType: type,
    user:    val('t-user') || 'TestPilot',
    avatar:  val('t-avatar'),
    amount:  parseInt(val('t-amount'), 10) || 0,
    tier:    val('t-tier') || '1000',
    months:  parseInt(val('t-months'), 10) || 0,
    level:   parseInt(val('t-level'), 10) || 1,
    game:    val('t-game'),
  };
  if (extra) Object.assign(msg, extra);
  send(msg);
}

function fireReward(reward) {
  fire('redeem', { reward: reward });
}

// ── Log helpers ───────────────────────────────────────────
function setStatus(on) {
  var s = document.getElementById('status');
  if (!s) return;
  s.textContent = on ? 'ONLINE' : 'OFFLINE';
  s.className = 'badge ' + (on ? 'on' : 'off');
}

function pretty(s) { try { return JSON.stringify(JSON.parse(s)); } catch(e) { return s; } }

function pad2(n) { return (n < 10 ? '0' : '') + n; }

function log(msg, type) {
  var el = document.getElementById('log');
  if (!el) return;
  var now = new Date();
  var ts = pad2(now.getHours()) + ':' + pad2(now.getMinutes()) + ':' + pad2(now.getSeconds());
  var div = document.createElement('div');
  div.innerHTML = '<span class="log-ts">[' + ts + ']</span>' +
                  '<span class="log-' + (type || 'info') + '">' + escHtml(msg) + '</span>';
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
  while (el.children.length > 500) el.removeChild(el.firstChild);
}

function clearLog() { var el = document.getElementById('log'); if (el) el.innerHTML = ''; }

// ── Boot ──────────────────────────────────────────────────
connectWS();
