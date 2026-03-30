// ════════════════════════════════════════════════════════
// CHAOS CREW – Raumkampf Admin JS
// ════════════════════════════════════════════════════════
'use strict';

var CFG = {
  apiHost:  localStorage.getItem('sf_apihost') || window.location.hostname || '192.168.178.34',
  apiPort:  localStorage.getItem('sf_apiport') || '3000',
  wofLimit: localStorage.getItem('sf_woflimit') || '10',
};

function apiUrl(path) {
  return 'http://' + CFG.apiHost + ':' + CFG.apiPort + path;
}

// ── Init ──────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', function() {
  document.getElementById('cfg-apihost').value  = CFG.apiHost;
  document.getElementById('cfg-apiport').value  = CFG.apiPort;
  document.getElementById('cfg-wof-limit').value = CFG.wofLimit;
  checkApi();
  loadLeaderboard();
  loadHistory();
  setInterval(loadLeaderboard, 30000);
  setInterval(loadHistory, 30000);
});

// ── API Health ────────────────────────────────────────────
function checkApi() {
  fetch(apiUrl('/health'))
    .then(function(r){ return r.json(); })
    .then(function(d){
      setBadge('badge-api', true, 'API: OK');
    })
    .catch(function(){
      setBadge('badge-api', false, 'API: FEHLER');
    });
}

function setBadge(id, on, text) {
  var el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = 'badge ' + (on ? 'on' : 'off');
}

// ── Leaderboard ───────────────────────────────────────────
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
    tbody.innerHTML = '<tr><td colspan="7" class="loading">Noch keine Kämpfe</td></tr>';
    return;
  }
  tbody.innerHTML = data.map(function(p, i) {
    var medal = i === 0 ? '👑' : i === 1 ? '⭐' : '#' + (i+1);
    var ts    = p.last_fight ? new Date(p.last_fight).toLocaleString('de-DE') : '–';
    return '<tr class="' + (i < 2 ? 'rank-'+(i+1) : '') + '">' +
      '<td>' + medal + '</td>' +
      '<td><strong>' + CC.validate.escHtml(p.display || p.username) + '</strong></td>' +
      '<td class="wins-col">'   + (p.wins||0)   + '</td>' +
      '<td class="losses-col">' + (p.losses||0) + '</td>' +
      '<td class="ratio-col">'  + (p.ratio||'0%') + '</td>' +
      '<td class="time-col">'   + ts + '</td>' +
      '<td><button class="btn cyan" style="padding:2px 8px;font-size:9px;" onclick="searchPlayerByName(\'' +
        CC.validate.escHtml(p.username) + '\')">&#x25CE;</button></td>' +
    '</tr>';
  }).join('');
}

// ── History ───────────────────────────────────────────────
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
    tbody.innerHTML = '<tr><td colspan="5" class="loading">Keine Kämpfe bisher</td></tr>';
    return;
  }
  tbody.innerHTML = data.map(function(f) {
    var ts = f.ts ? new Date(f.ts).toLocaleString('de-DE') : '–';
    return '<tr>' +
      '<td class="time-col">' + ts + '</td>' +
      '<td style="color:var(--green)">' + CC.validate.escHtml(f.winner||'') + '</td>' +
      '<td style="color:var(--red)">'   + CC.validate.escHtml(f.loser ||'') + '</td>' +
      '<td style="color:rgba(200,220,232,0.5)">' + CC.validate.escHtml(f.ship_w||'') + '</td>' +
      '<td style="color:rgba(200,220,232,0.3)">' + CC.validate.escHtml(f.ship_l||'') + '</td>' +
    '</tr>';
  }).join('');
}

// ── Spieler-Suche ─────────────────────────────────────────
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
        '<div class="pr-name">' + CC.validate.escHtml(p.display || p.username) + '</div>' +
        '<div class="pr-rank">Rang #' + (p.rank || '?') + '</div>' +
        '<div class="pr-stat"><span class="pr-label">SIEGE</span><span class="pr-val" style="color:var(--green)">' + (p.wins||0) + '</span></div>' +
        '<div class="pr-stat"><span class="pr-label">NIEDERLAGEN</span><span class="pr-val" style="color:var(--red)">' + (p.losses||0) + '</span></div>' +
        '<div class="pr-stat"><span class="pr-label">WINRATE</span><span class="pr-val" style="color:var(--cyan)">' + (p.ratio||'0%') + '</span></div>' +
        '<div class="pr-stat"><span class="pr-label">LETZTER KAMPF</span><span class="pr-val time-col">' + ts + '</span></div>';
    })
    .catch(function(){
      document.getElementById('player-result').innerHTML =
        '<div style="color:var(--red);font-size:11px;">Fehler beim Laden</div>';
    });
}

// ── Settings ──────────────────────────────────────────────
function applySettings() {
  CFG.apiHost  = CC.validate.sanitize(document.getElementById('cfg-apihost').value, 'host');
  CFG.apiPort  = String(CC.validate.sanitizeInt(document.getElementById('cfg-apiport').value, 1, 65535, 3000));
  CFG.wofLimit = String(CC.validate.sanitizeInt(document.getElementById('cfg-wof-limit').value, 5, 50, 10));
  localStorage.setItem('sf_apihost',   CFG.apiHost);
  localStorage.setItem('sf_apiport',   CFG.apiPort);
  localStorage.setItem('sf_woflimit',  CFG.wofLimit);
  checkApi();
  loadLeaderboard();
  loadHistory();
}

// ── Reset WoF ─────────────────────────────────────────────
function confirmReset() {
  var overlay = document.getElementById('confirm-overlay');
  if (overlay) { overlay.classList.add('show'); return; }
  // Fallback
  if (confirm('Wall of Fame wirklich zurücksetzen? Alle Kampfdaten werden gelöscht.'))
    doReset();
}

function doReset() {
  fetch(apiUrl('/api/spacefight/reset'), { method: 'POST' })
    .then(function(){ loadLeaderboard(); loadHistory(); closeConfirm(); })
    .catch(function(){ alert('Reset fehlgeschlagen'); });
}

function closeConfirm() {
  var overlay = document.getElementById('confirm-overlay');
  if (overlay) overlay.classList.remove('show');
}
