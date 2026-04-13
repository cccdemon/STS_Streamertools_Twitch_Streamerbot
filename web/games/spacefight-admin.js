// ════════════════════════════════════════════════════════
// CHAOS CREW – Raumkampf Admin JS
// ════════════════════════════════════════════════════════
'use strict';

// ── State ────────────────────────────────────────────────
var gameActive = false;
var sfWs = null;
var sfWsRetry = 1000;
var sfWsReconnectTimer = null;

var CFG = {
  apiHost:  localStorage.getItem('sf_apihost') || window.location.hostname || '192.168.178.34',
  apiPort:  localStorage.getItem('sf_apiport') || '9091',
  wofLimit: localStorage.getItem('sf_woflimit') || '10',
};

function apiUrl(path) {
  return 'http://' + CFG.apiHost + ':' + CFG.apiPort + path;
}
function wsUrl() {
  return 'ws://' + CFG.apiHost + ':' + CFG.apiPort;
}

function esc(s) {
  return (window.CC && CC.validate && typeof CC.validate.escHtml === 'function')
    ? CC.validate.escHtml(s)
    : String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Init ─────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', function() {
  document.getElementById('cfg-apihost').value  = CFG.apiHost;
  document.getElementById('cfg-apiport').value  = CFG.apiPort;
  document.getElementById('cfg-wof-limit').value = CFG.wofLimit;
  connectWS();
  loadLeaderboard();
  loadHistory();
  setInterval(loadLeaderboard, 30000);
  setInterval(loadHistory, 30000);
});

// ── WebSocket ────────────────────────────────────────────
function connectWS() {
  if (sfWs) { sfWs.onclose = null; sfWs.close(); }
  try { sfWs = new WebSocket(wsUrl()); }
  catch(e) { scheduleReconnect(); return; }

  sfWs.onopen = function() {
    sfWsRetry = 1000;
    if (sfWsReconnectTimer) { clearTimeout(sfWsReconnectTimer); sfWsReconnectTimer = null; }
    setWsBadge(true);
    send({ event: 'cc_identify', role: 'spacefight-admin' });
    send({ event: 'sf_status_request' });
  };
  sfWs.onmessage = function(e) {
    var msg;
    if (window.CC && CC.validate) msg = CC.validate.safeJsonParse(e.data);
    else { try { msg = JSON.parse(e.data); } catch(x) { return; } }
    if (msg) handleMsg(msg);
  };
  sfWs.onclose = sfWs.onerror = function() {
    setWsBadge(false);
    scheduleReconnect();
  };
}

function scheduleReconnect() {
  if (sfWsReconnectTimer) return;
  sfWsReconnectTimer = setTimeout(function() {
    sfWsReconnectTimer = null;
    connectWS();
  }, sfWsRetry);
  sfWsRetry = Math.min(sfWsRetry * 2, 15000);
}

function send(obj) {
  if (window.CC && CC.validate && !CC.validate.validateWsPayload(obj)) return;
  if (sfWs && sfWs.readyState === 1) sfWs.send(JSON.stringify(obj));
}

function setWsBadge(on) {
  var el = document.getElementById('badge-ws');
  if (!el) return;
  el.textContent = on ? 'WS: ' + CFG.apiHost + ':' + CFG.apiPort : 'WS: OFFLINE';
  el.className = 'badge ' + (on ? 'on' : 'off');
}

function setGameBadge(active) {
  var el = document.getElementById('badge-game');
  if (!el) return;
  el.textContent = active ? 'SPIEL: AKTIV' : 'SPIEL: INAKTIV';
  el.className = 'badge ' + (active ? 'on' : 'off');
}

// ── Message Handler ──────────────────────────────────────
function handleMsg(msg) {
  if (msg.event === 'sf_game_status') {
    gameActive = !!msg.active;
    setGameBadge(gameActive);
    updateToggleButtons();
  }
  if (msg.event === 'sf_ack') {
    if (msg.type === 'reset') { loadLeaderboard(); loadHistory(); }
    if (msg.type === 'player_deleted') { loadLeaderboard(); loadHistory(); closeEdit(); closeDelete(); }
    if (msg.type === 'player_edited') { loadLeaderboard(); closeEdit(); }
  }
  // Live-Update: Neuer Kampf
  if (msg.event === 'sf_result') {
    loadLeaderboard();
    loadHistory();
  }
  if (msg.event === 'ws_clients')  renderWsClients(msg.clients || []);
  if (msg.event === 'ws_traffic')  appendWsTraffic(msg);
}

function renderWsClients(list) {
  var el = document.getElementById('ws-clients-list');
  if (!el) return;
  if (!list.length) { el.innerHTML = '<div class="wsc-empty">Keine Clients verbunden</div>'; return; }
  var now = Date.now();
  el.innerHTML = list.map(function(c) {
    var ago = Math.floor((now - c.connectedAt) / 1000);
    var t = ago < 60 ? ago + 's' : Math.floor(ago / 60) + 'm';
    var short = c.id.slice(-5);
    return '<div class="wsc-row">' +
      '<span class="wsc-role">' + c.role + '</span>' +
      '<span class="wsc-id">' + short + '</span>' +
      '<span class="wsc-meta">' + t + ' · ' + c.msgCount + ' msg</span>' +
      '</div>';
  }).join('');
}

function appendWsTraffic(msg) {
  var el = document.getElementById('ws-traffic-log');
  if (!el) return;
  var short = (msg.clientId || '').slice(-5);
  var e = document.createElement('div');
  e.className = 'wst-row';
  e.textContent = '[' + short + '] ' + msg.role + ' → ' + msg.msgEvent;
  el.insertBefore(e, el.firstChild);
  while (el.children.length > 50) el.removeChild(el.lastChild);
}

// ── Game Toggle ──────────────────────────────────────────
function toggleGame(start) {
  send({ event: 'sf_cmd', cmd: start ? 'sf_start' : 'sf_stop' });
}

function updateToggleButtons() {
  var btnStart = document.getElementById('btn-start');
  var btnStop  = document.getElementById('btn-stop');
  if (btnStart) btnStart.disabled = gameActive;
  if (btnStop)  btnStop.disabled  = !gameActive;
}

// ── Leaderboard ──────────────────────────────────────────
function loadLeaderboard() {
  var limit = CC.validate.sanitizeInt(CFG.wofLimit, 5, 50, 10);
  fetch(apiUrl('/api/spacefight/leaderboard?limit=' + limit))
    .then(function(r){ return r.json(); })
    .then(renderLeaderboard)
    .catch(function(){
      document.getElementById('wof-tbody').innerHTML =
        '<tr><td colspan="7" class="loading">API nicht erreichbar</td></tr>';
    });
}

function renderLeaderboard(data) {
  var tbody = document.getElementById('wof-tbody');
  if (!data || !data.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="loading">Noch keine Kaempfe</td></tr>';
    return;
  }
  tbody.innerHTML = data.map(function(p, i) {
    var medal = i === 0 ? '1' : i === 1 ? '2' : '#' + (i+1);
    var ts    = p.last_fight ? new Date(p.last_fight).toLocaleString('de-DE') : '–';
    var uSafe = esc(p.username || '');
    return '<tr class="' + (i < 2 ? 'rank-'+(i+1) : '') + '">' +
      '<td>' + medal + '</td>' +
      '<td><strong>' + esc(p.display || p.username) + '</strong></td>' +
      '<td class="wins-col">'   + (p.wins||0)   + '</td>' +
      '<td class="losses-col">' + (p.losses||0) + '</td>' +
      '<td class="ratio-col">'  + (p.ratio||'0') + '%</td>' +
      '<td class="time-col">'   + ts + '</td>' +
      '<td>' +
        '<button class="btn cyan" style="padding:2px 8px;font-size:9px;" onclick="openEdit(\'' +
          uSafe + '\',' + (p.wins||0) + ',' + (p.losses||0) + ',\'' + esc(p.display || p.username) + '\')">EDIT</button>' +
      '</td>' +
    '</tr>';
  }).join('');
}

// ── History ──────────────────────────────────────────────
function loadHistory() {
  fetch(apiUrl('/api/spacefight/history?limit=20'))
    .then(function(r){ return r.json(); })
    .then(renderHistory)
    .catch(function(){
      document.getElementById('hist-tbody').innerHTML =
        '<tr><td colspan="5" class="loading">API nicht erreichbar</td></tr>';
    });
}

function renderHistory(data) {
  var tbody = document.getElementById('hist-tbody');
  if (!data || !data.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="loading">Keine Kaempfe bisher</td></tr>';
    return;
  }
  tbody.innerHTML = data.map(function(f) {
    var ts = f.ts ? new Date(f.ts).toLocaleString('de-DE') : '–';
    return '<tr>' +
      '<td class="time-col">' + ts + '</td>' +
      '<td style="color:var(--green)">' + esc(f.winner||'') + '</td>' +
      '<td style="color:var(--red)">'   + esc(f.loser ||'') + '</td>' +
      '<td style="color:rgba(200,220,232,0.5)">' + esc(f.ship_w||'') + '</td>' +
      '<td style="color:rgba(200,220,232,0.3)">' + esc(f.ship_l||'') + '</td>' +
    '</tr>';
  }).join('');
}

// ── Spieler-Suche ────────────────────────────────────────
function searchPlayer() {
  var raw = document.getElementById('player-search').value;
  var u   = CC.validate.sanitize(raw, 'username');
  if (!u) return;
  searchPlayerByName(u);
}

function searchPlayerByName(username) {
  document.getElementById('player-search').value = username;
  fetch(apiUrl('/api/spacefight/player/' + encodeURIComponent(username)))
    .then(function(r){ return r.json(); })
    .then(function(p) {
      if (!p || p.error) {
        document.getElementById('player-result').innerHTML =
          '<div style="color:var(--dim);font-size:11px;">Spieler nicht gefunden</div>';
        return;
      }
      var ts = p.last_fight ? new Date(p.last_fight).toLocaleString('de-DE') : '–';
      document.getElementById('player-result').innerHTML =
        '<div class="pr-name">' + esc(p.display || p.username) + '</div>' +
        '<div class="pr-rank">Rang #' + (p.rank || '?') + '</div>' +
        '<div class="pr-stat"><span class="pr-label">SIEGE</span><span class="pr-val" style="color:var(--green)">' + (p.wins||0) + '</span></div>' +
        '<div class="pr-stat"><span class="pr-label">NIEDERLAGEN</span><span class="pr-val" style="color:var(--red)">' + (p.losses||0) + '</span></div>' +
        '<div class="pr-stat"><span class="pr-label">WINRATE</span><span class="pr-val" style="color:var(--cyan)">' + (p.ratio||'0') + '%</span></div>' +
        '<div class="pr-stat"><span class="pr-label">LETZTER KAMPF</span><span class="pr-val time-col">' + ts + '</span></div>';
    })
    .catch(function(){
      document.getElementById('player-result').innerHTML =
        '<div style="color:var(--red);font-size:11px;">Fehler beim Laden</div>';
    });
}

// ── Settings ─────────────────────────────────────────────
function applySettings() {
  CFG.apiHost  = CC.validate.sanitize(document.getElementById('cfg-apihost').value, 'host');
  CFG.apiPort  = String(CC.validate.sanitizeInt(document.getElementById('cfg-apiport').value, 1, 65535, 9091));
  CFG.wofLimit = String(CC.validate.sanitizeInt(document.getElementById('cfg-wof-limit').value, 5, 50, 10));
  localStorage.setItem('sf_apihost',   CFG.apiHost);
  localStorage.setItem('sf_apiport',   CFG.apiPort);
  localStorage.setItem('sf_woflimit',  CFG.wofLimit);
  connectWS();
  loadLeaderboard();
  loadHistory();
}

// ── Edit Player Modal ────────────────────────────────────
function openEdit(username, wins, losses, display) {
  document.getElementById('edit-username').value = username;
  document.getElementById('edit-display').textContent = display || username;
  document.getElementById('edit-wins').value   = wins   || 0;
  document.getElementById('edit-losses').value = losses || 0;
  document.getElementById('edit-overlay').classList.add('show');
}

function closeEdit() {
  document.getElementById('edit-overlay').classList.remove('show');
}

function saveEdit() {
  var u = document.getElementById('edit-username').value;
  var w = parseInt(document.getElementById('edit-wins').value)   || 0;
  var l = parseInt(document.getElementById('edit-losses').value) || 0;
  send({ event: 'sf_cmd', cmd: 'sf_edit_player', user: u, wins: w, losses: l });
}

// ── Delete Player ────────────────────────────────────────
function confirmDeleteFromEdit() {
  var u = document.getElementById('edit-username').value;
  document.getElementById('delete-name').textContent = u;
  document.getElementById('delete-overlay').classList.add('show');
}

function doDelete() {
  var u = document.getElementById('edit-username').value;
  send({ event: 'sf_cmd', cmd: 'sf_delete_player', user: u });
}

function closeDelete() {
  document.getElementById('delete-overlay').classList.remove('show');
}

// ── Reset WoF ────────────────────────────────────────────
function confirmReset() {
  var overlay = document.getElementById('confirm-overlay');
  if (overlay) { overlay.classList.add('show'); return; }
  if (confirm('Wall of Fame wirklich zuruecksetzen?')) doReset();
}

function doReset() {
  send({ event: 'sf_cmd', cmd: 'sf_reset' });
  closeConfirm();
}

function closeConfirm() {
  var overlay = document.getElementById('confirm-overlay');
  if (overlay) overlay.classList.remove('show');
}
