// ════════════════════════════════════════════════════════
// CHAOS CREW – Giveaway Admin JS (microservice)
// WS: /giveaway/ws  API: /api/...
// ════════════════════════════════════════════════════════

function parseDec(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'string') return parseFloat(v.replace(/,/g, '.')) || 0;
  return parseFloat(v) || 0;
}

// ── State ─────────────────────────────────────────────────
let currentTeam  = null;
const TEAM_EVENTS = { gw_cmd:1, gw_get_all:1, gw_subscribe:1, gw_overlay:1, viewer_tick:1, chat_msg:1, time_cmd:1 };
let participants = {};
let gwIsOpen     = false;
let sortField    = 'coins';
let sortDir      = -1;
let gwWs         = null;
let gwWsRetry    = 1000;
let gwWsReconnectTimer = null;
let lastWinner   = null;
let historyDraws = [];

function esc(s) {
  return (window.CC && CC.validate && typeof CC.validate.escHtml === 'function')
    ? CC.validate.escHtml(s)
    : String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── WebSocket ─────────────────────────────────────────────
function reconnect() {
  if (gwWsReconnectTimer) { clearTimeout(gwWsReconnectTimer); gwWsReconnectTimer = null; }
  if (gwWs) { gwWs.onclose = null; gwWs.close(); }
  connectWS();
}

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  try { gwWs = new WebSocket(`${proto}//${location.host}/giveaway/ws`); }
  catch(e) { scheduleReconnect(); return; }

  gwWs.onopen = () => {
    setBadge(true);
    gwWsRetry = 1000;
    log('WebSocket verbunden', 'cyan');
    send({ event: 'cc_identify', role: 'giveaway-admin' });
    loadTeams();
  };
  gwWs.onmessage = (e) => { const msg = CC.validate.safeJsonParse(e.data); if (msg) handle(msg); };
  gwWs.onclose = gwWs.onerror = () => { setBadge(false); scheduleReconnect(); };
}

function scheduleReconnect() {
  if (gwWsReconnectTimer) return;
  gwWsReconnectTimer = setTimeout(function() {
    gwWsReconnectTimer = null;
    connectWS();
  }, gwWsRetry);
  gwWsRetry = Math.min(gwWsRetry * 2, 15000);
}

function setBadge(on) {
  const el = document.getElementById('ws-badge');
  if (!el) return;
  el.className  = 'ws-badge ' + (on ? 'on' : 'off');
  el.textContent = on ? 'WS: ONLINE' : 'WS: OFFLINE';
}

function send(obj) {
  if (obj && TEAM_EVENTS[obj.event]) {
    if (!currentTeam) { log('Kein Team gewählt', 'red'); return; }
    obj.teamId = currentTeam;
  }
  if (!CC.validate.validateWsPayload(obj)) { log('Payload blockiert: ' + JSON.stringify(obj).slice(0,60), 'red'); return; }
  if (gwWs && gwWs.readyState === 1) gwWs.send(JSON.stringify(obj));
  else log('WS nicht verbunden', 'red');
}

async function loadTeams() {
  try {
    var teams = await (await fetch('/admin/api/teams/mine')).json();
    var sel = document.getElementById('team-select');
    if (!Array.isArray(teams) || !teams.length) {
      if (sel) sel.innerHTML = '<option>— kein Team —</option>';
      log('Du bist in keinem Team. Lege unter MEINE TEAMS eins an.', 'gold');
      return;
    }
    if (sel) {
      sel.innerHTML = teams.map(function(t){ return '<option value="'+esc(t.id)+'">'+esc(t.name)+(t.role==='owner'?' ★':'')+'</option>'; }).join('');
      if (!currentTeam || !teams.some(function(t){return t.id===currentTeam;})) currentTeam = teams[0].id;
      sel.value = currentTeam;
    } else if (!currentTeam) { currentTeam = teams[0].id; }
    refresh();
  } catch(e) { log('Teams laden fehlgeschlagen: ' + e.message, 'red'); }
}

function onTeamChange() {
  var sel = document.getElementById('team-select');
  if (!sel) return;
  currentTeam = sel.value;
  participants = {};
  log('Team gewechselt: ' + currentTeam, 'cyan');
  refresh();
}

function refresh() { requestData(); loadKeyword(); loadHistory(); }

function requestData() {
  send({ event: 'gw_get_all' });
  send({ event: 'gw_cmd', cmd: 'gw_get_multiplier' });
  send({ event: 'gw_cmd', cmd: 'gw_get_channels' });
  send({ event: 'gw_cmd', cmd: 'gw_get_ingest_tokens' });
}

setInterval(() => { if (gwWs && gwWs.readyState === 1) requestData(); }, 10000);

// ── Message Handler ───────────────────────────────────────
function handle(msg) {
  switch(msg.event) {
    case 'gw_data':
      participants = {};
      gwIsOpen = !!msg.open;
      (msg.participants || []).forEach(p => {
        const key = (p.username || '').toLowerCase();
        participants[key] = {
          display:  p.username || key,
          watchSec: parseInt(p.watchSec) || 0,
          msgs:     parseInt(p.msgs) || 0,
          coins:    parseDec(p.coins),
          banned:   !!p.banned
        };
      });
      updateGwStatus();
      renderTable();
      updateStats();
      break;

    case 'gw_status':
      gwIsOpen = msg.status === 'open';
      updateGwStatus();
      break;

    case 'gw_ack': {
      log(`ACK: ${msg.type} -> ${msg.user || msg.keyword || msg.winner || msg.channel || ''}`, 'cyan');
      // Read-only Antworten (NIE requestData → sonst Endlosschleife)
      if (msg.type === 'channels')      { ingestChannels = msg.channels || []; renderIngest(); break; }
      if (msg.type === 'ingest_tokens') { ingestTokens = {}; (msg.tokens || []).forEach(t => ingestTokens[t.channel] = t.token); renderIngest(); break; }
      if (msg.type === 'ingest_token')  { ingestTokens[msg.channel] = msg.token; renderIngest(); break; }
      if (msg.type === 'ingest_revoked') { delete ingestTokens[msg.channel]; renderIngest(); break; }
      if (msg.type === 'keyword') { const kw = msg.keyword || ''; document.getElementById('kw-current').textContent = kw || '- (deaktiviert)'; document.getElementById('kw-input').value = kw; break; }
      // Mutations
      if (msg.type === 'keyword_set') {
        const kw = msg.keyword || '';
        document.getElementById('kw-current').textContent = kw || '- (deaktiviert)';
        document.getElementById('kw-input').value = kw;
      }
      if (msg.type === 'winner_drawn') { showWinnerAnimation(msg.winner, msg.watchSec, msg.coins, msg.prize); loadHistory(); }
      if (msg.type === 'no_winner') log('Keine Teilnehmer mit Coins im Pool!', 'red');
      if (msg.type === 'draw_error') log('ZIEHUNG FEHLGESCHLAGEN: ' + (msg.error || '?') + ' – nichts gespeichert, bitte erneut ziehen', 'red');
      requestData();
      break;
    }

    case 'gw_keyword': {
      const kw2 = msg.keyword || '';
      document.getElementById('kw-current').textContent = kw2 || '- (deaktiviert)';
      document.getElementById('kw-input').value = kw2;
      break;
    }

    case 'gw_multiplier':
      updateMultiplierUI(parseFloat(msg.factor) || 1, parseInt(msg.secondsLeft) || 0);
      break;

    case 'ws_clients':
      renderWsClients(msg.clients || []);
      break;

    case 'ws_traffic':
      appendWsTraffic(msg);
      break;
  }
}

// ── Viewtime-Multiplier ───────────────────────────────────
function startMultiplier() {
  const factor  = CC.validate.sanitizeInt(document.getElementById('mult-factor').value, 1, 10, 2);
  const minutes = CC.validate.sanitizeInt(document.getElementById('mult-minutes').value, 1, 1440, 15);
  send({ event: 'gw_cmd', cmd: 'gw_set_multiplier', factor: factor, minutes: minutes });
  log(`Viewtime-Boost ${factor}× für ${minutes} min`, 'cyan');
}

function stopMultiplier() {
  send({ event: 'gw_cmd', cmd: 'gw_set_multiplier', factor: 1, minutes: 0 });
  log('Viewtime-Boost gestoppt', 'gold');
}

let _multTimer = null;
function updateMultiplierUI(factor, secondsLeft) {
  const el = document.getElementById('mult-status');
  if (!el) return;
  if (_multTimer) { clearInterval(_multTimer); _multTimer = null; }
  if (factor <= 1 || secondsLeft <= 0) {
    el.textContent = '1× (aus)';
    el.style.color = 'var(--dim)';
    return;
  }
  el.style.color = 'var(--cyan)';
  let left = secondsLeft;
  const render = () => {
    const m = Math.floor(left / 60), s = left % 60;
    el.textContent = `${factor}× · ${m}:${String(s).padStart(2, '0')}`;
    if (left <= 0) { clearInterval(_multTimer); _multTimer = null; el.textContent = '1× (aus)'; el.style.color = 'var(--dim)'; }
    left--;
  };
  render();
  _multTimer = setInterval(render, 1000);
}

// ── Stream-Verbindungen (Ingest-Token) ────────────────────
var ingestChannels = [];
var ingestTokens = {};

function renderIngest() {
  var urlEl = document.getElementById('ingest-url');
  if (urlEl) urlEl.textContent = 'wss://' + location.host + '/ingest';
  var el = document.getElementById('ingest-list');
  if (!el) return;
  var chans = ingestChannels.length ? ingestChannels : Object.keys(ingestTokens);
  if (!chans.length) { el.innerHTML = '<div class="wsc-empty">Keine Kanäle konfiguriert</div>'; return; }
  el.innerHTML = chans.map(function(ch) {
    var tok = ingestTokens[ch];
    var right = tok
      ? '<input class="ingest-tok" readonly value="' + tok + '" onclick="this.select()" style="flex:1;min-width:0;font-size:11px;">'
        + '<button class="btn btn-gold btn-sm" onclick="genIngestToken(\'' + ch + '\')">NEU</button>'
      : '<span style="flex:1;opacity:.5">kein Token</span>'
        + '<button class="btn btn-cyan btn-sm" onclick="genIngestToken(\'' + ch + '\')">GENERIEREN</button>';
    return '<div class="ingest-row" style="display:flex;gap:6px;align-items:center;margin:5px 0;">'
      + '<b style="width:118px;overflow:hidden;text-overflow:ellipsis">' + ch + '</b>' + right + '</div>';
  }).join('');
}

function genIngestToken(ch) {
  send({ event: 'gw_cmd', cmd: 'gw_gen_ingest_token', channel: ch });
  log('Ingest-Token für ' + ch + ' generiert', 'cyan');
}

function renderWsClients(list) {
  const el = document.getElementById('ws-clients-list');
  if (!el) return;
  if (!list.length) { el.innerHTML = '<div class="wsc-empty">Keine Clients verbunden</div>'; return; }
  const now = Date.now();
  el.innerHTML = list.map(c => {
    const ago = Math.floor((now - c.connectedAt) / 1000);
    const t = ago < 60 ? ago + 's' : Math.floor(ago / 60) + 'm';
    const short = c.id.slice(-5);
    return `<div class="wsc-row">
      <span class="wsc-role">${esc(c.role)}</span>
      <span class="wsc-id">${short}</span>
      <span class="wsc-meta">${t} · ${c.msgCount} msg</span>
    </div>`;
  }).join('');
}

function appendWsTraffic(msg) {
  const el = document.getElementById('ws-traffic-log');
  if (!el) return;
  const short = (msg.clientId || '').slice(-5);
  const e = document.createElement('div');
  e.className = 'wst-row';
  e.textContent = `[${short}] ${esc(msg.role)} → ${esc(msg.msgEvent)}`;
  el.insertBefore(e, el.firstChild);
  while (el.children.length > 50) el.removeChild(el.lastChild);
}

// ── Giveaway Controls ─────────────────────────────────────
function gwOpen()  { send({ event:'gw_cmd', cmd:'gw_open'  }); gwIsOpen=true;  updateGwStatus(); log('Giveaway geoffnet','cyan'); }
function gwClose() { send({ event:'gw_cmd', cmd:'gw_close' }); gwIsOpen=false; updateGwStatus(); log('Giveaway geschlossen','gold'); }

function updateGwStatus() {
  const el = document.getElementById('gw-txt');
  if (gwIsOpen) { el.textContent='OPEN';   el.className='gw-status open'; }
  else          { el.textContent='CLOSED'; el.className='gw-status closed'; }
}

function drawWinner() {
  var el = document.getElementById('prize-input');
  var prize = el ? el.value.trim() : '';
  send({ event:'gw_cmd', cmd:'gw_draw_winner', prize: prize });
}

function showWinnerAnimation(winnerName, watchSec, coins, prize) {
  const names = Object.keys(participants).filter(k => !participants[k].banned && participants[k].coins > 0);
  if (!names.length) names.push(winnerName);
  let flashes = 0;
  document.getElementById('winner-card').style.display = 'block';
  const interval = setInterval(() => {
    const tmp = names[Math.floor(Math.random()*names.length)];
    document.getElementById('w-name').textContent = (participants[tmp]?.display||tmp).toUpperCase();
    if (++flashes >= 14) {
      clearInterval(interval);
      lastWinner = winnerName;
      document.getElementById('w-name').textContent = winnerName.toUpperCase();
      const prizeTxt = prize ? ` // 🎁 ${prize}` : '';
      document.getElementById('w-info').textContent = `${parseDec(coins).toFixed(2)} Coins // ${fmtTime(watchSec||0)}${prizeTxt}`;
      renderTable(winnerName);
      log(`GEWINNER: ${winnerName} (${parseDec(coins).toFixed(2)} Coins)${prize ? ' – Preis: ' + prize : ''}`, 'gold');
    }
  }, 75);
}

function reroll()      { drawWinner(); }
function clearWinner() { lastWinner=null; document.getElementById('winner-card').style.display='none'; clearOverlay(); }

// ── Manual Actions ────────────────────────────────────────
function manualAdd() {
  const name = CC.validate.sanitize(document.getElementById('m-name').value, 'username');
  const amt  = CC.validate.sanitizeInt(document.getElementById('m-amount').value, 1, 100, 1);
  if (!name) return;
  for (let i=0; i<amt; i++) send({ event:'gw_cmd', cmd:'gw_add_ticket', user:name });
  log(`+${amt} Ticket(s) -> ${name}`, 'cyan');
  setTimeout(requestData, 300);
}

function manualSub() {
  const name = CC.validate.sanitize(document.getElementById('m-name').value, 'username');
  const amt  = CC.validate.sanitizeInt(document.getElementById('m-amount').value, 1, 100, 1);
  if (!name) return;
  for (let i=0; i<amt; i++) send({ event:'gw_cmd', cmd:'gw_sub_ticket', user:name });
  log(`-${amt} Ticket(s) -> ${name}`, 'gold');
  setTimeout(requestData, 300);
}

function addTicketTo(key)   { send({ event:'gw_cmd', cmd:'gw_add_ticket', user:key }); log(`+1 -> ${key}`,'cyan'); setTimeout(requestData,300); }
function subTicketFrom(key) { send({ event:'gw_cmd', cmd:'gw_sub_ticket', user:key }); log(`-1 -> ${key}`,'gold'); setTimeout(requestData,300); }

function toggleBan(key) {
  const banned = participants[key]?.banned;
  send({ event:'gw_cmd', cmd: banned ? 'gw_unban' : 'gw_ban', user:key });
  log(`${banned?'UNBAN':'BAN'}: ${key}`, banned?'gold':'red');
  setTimeout(requestData, 300);
}

function resetAll() {
  if (!confirm('ALLE Giveaway-Daten loeschen? Nicht rueckgaengig!')) return;
  send({ event:'gw_cmd', cmd:'gw_reset' });
  participants={}; gwIsOpen=false; lastWinner=null;
  document.getElementById('winner-card').style.display = 'none';
  updateGwStatus(); renderTable(); updateStats(); clearOverlay();
  log('RESET – alle Daten geloescht', 'red');
}

// ── Keyword ───────────────────────────────────────────────
function setKeyword() {
  const kw = CC.validate.sanitize(document.getElementById('kw-input').value, 'keyword');
  send({ event:'gw_cmd', cmd:'gw_set_keyword', keyword: kw });
  log(`Keyword gesetzt: "${kw}"`, 'cyan');
}

function clearKeyword() {
  send({ event:'gw_cmd', cmd:'gw_set_keyword', keyword: '' });
  document.getElementById('kw-input').value = '';
  document.getElementById('kw-current').textContent = '- (deaktiviert)';
  log('Keyword deaktiviert', 'gold');
}

function loadKeyword() { send({ event:'gw_cmd', cmd:'gw_get_keyword' }); }

// ── Table ─────────────────────────────────────────────────
function renderTable(hlKey=null) {
  const search = document.getElementById('search').value.toLowerCase();
  const entries = Object.entries(participants)
    .filter(([k,p]) => !search || k.includes(search) || (p.display||'').toLowerCase().includes(search))
    .sort(([,a],[,b]) => {
      if (sortField === 'rank') return 0;
      const av = sortField==='name' ? (a.display||'').toLowerCase() : (a[sortField]||0);
      const bv = sortField==='name' ? (b.display||'').toLowerCase() : (b[sortField]||0);
      return sortDir * (av<bv?-1:av>bv?1:0);
    });

  document.getElementById('list-count').textContent = entries.length;
  document.getElementById('tbl').innerHTML = entries.map(([key,p],i) => `
    <tr class="${p.banned?'banned':''} ${key===hlKey?'winner-row':''}">
      <td class="rank">${i+1}</td>
      <td class="name">${esc(p.display||key)}${p.banned?' <span style="color:var(--red);font-size:10px;">[BAN]</span>':''}</td>
      <td class="tickets">${parseDec(p.coins).toFixed(2)}</td>
      <td class="watchtime">${fmtTime(p.watchSec)}</td>
      <td style="display:flex;gap:4px;">
        <button class="mini-btn add" onclick="addTicketTo('${esc(key)}')">+1</button>
        <button class="mini-btn sub" onclick="subTicketFrom('${esc(key)}')">-1</button>
        <button class="mini-btn ban" onclick="toggleBan('${esc(key)}')">${p.banned?'UN':'BAN'}</button>
      </td>
    </tr>`).join('');
}

function sortBy(f) {
  if (sortField===f) sortDir*=-1; else { sortField=f; sortDir=f==='name'?1:-1; }
  renderTable();
}

// ── Stats & Overlay ───────────────────────────────────────
function updateStats() {
  const active = Object.values(participants).filter(p=>!p.banned);
  document.getElementById('s-total').textContent   = active.length;
  document.getElementById('s-tickets').textContent = active.reduce((s,p)=>s+(parseFloat(p.coins)||0),0).toFixed(4).replace(/\.?0+$/,'');
  document.getElementById('s-msgs').textContent    = active.reduce((s,p)=>s+(parseInt(p.msgs)||0),0);
}

// OBS-Overlay (giveaway-overlay.html) ist winner-only. Der Server broadcastet
// den Gewinner bei der Ziehung selbst; hier nur das explizite Leeren.
function clearOverlay() {
  send({ event: 'gw_overlay', winner: null });
}

// ── Gewinner-Historie ─────────────────────────────────────
function loadHistory() {
  if (!currentTeam) return;
  fetch('/giveaway/api/draws?limit=50&team=' + encodeURIComponent(currentTeam))
    .then(function(r) { return r.json(); })
    .then(function(rows) { historyDraws = Array.isArray(rows) ? rows : []; renderHistory(); })
    .catch(function() {
      const el = document.getElementById('history-list');
      if (el) el.innerHTML = '<div class="wsc-empty">Historie nicht ladbar</div>';
    });
}

function renderHistory() {
  const el = document.getElementById('history-list');
  if (!el) return;
  const showTests = !!document.getElementById('hist-show-tests') && document.getElementById('hist-show-tests').checked;
  const rows = historyDraws.filter(function(d) { return showTests || !d.is_test; });
  if (!rows.length) { el.innerHTML = '<div class="wsc-empty">Noch keine Ziehungen</div>'; return; }
  el.innerHTML = rows.map(function(d) {
    const when  = fmtDrawDate(d.drawn_at);
    const prize = d.prize ? '🎁 ' + esc(d.prize) : '<span style="color:var(--dim)">— kein Preis —</span>';
    const test  = d.is_test ? ' <span style="color:var(--gold);font-size:9px;">TEST</span>' : '';
    return '<div class="hist-row" style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05);">' +
      '<div style="display:flex;justify-content:space-between;gap:8px;">' +
        '<strong>' + esc(d.winner) + test + '</strong>' +
        '<span style="color:var(--dim);font-size:10px;white-space:nowrap;">' + when + '</span>' +
      '</div>' +
      '<div style="font-size:12px;">' + prize + '</div>' +
      '<div style="color:var(--dim);font-size:10px;">' +
        parseDec(d.winner_coins).toFixed(2) + ' Coins · ' + (d.eligible_count || 0) + ' Teilnehmer' +
      '</div>' +
    '</div>';
  }).join('');
}

function fmtDrawDate(iso) {
  const dt = new Date(iso);
  if (isNaN(dt.getTime())) return '';
  return dt.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// ── Export ────────────────────────────────────────────────
function exportCSV() {
  const active = Object.values(participants).filter(p => !p.banned);
  if (!active.length) { log('Keine Daten zum Exportieren', 'red'); return; }
  const total = active.reduce((s,p) => s + (p.coins||0), 0);
  const rows = [['Username','Coins','Watchtime (s)','Watchtime','Gewinnchance %']];
  active.sort((a,b) => b.coins - a.coins).forEach(p => {
    const chance = total > 0 ? ((p.coins / total) * 100).toFixed(2) : '0.00';
    rows.push([p.display, parseDec(p.coins).toFixed(2), p.watchSec, fmtTime(p.watchSec), chance]);
  });
  const csv = rows.map(r => r.join(';')).join('\n');
  dlFile('giveaway_export.csv', csv, 'text/csv;charset=utf-8');
  log('CSV exportiert (' + active.length + ' Teilnehmer)', 'cyan');
}

function exportChances() {
  const active = Object.values(participants).filter(p => !p.banned && p.coins > 0);
  if (!active.length) { log('Keine Teilnehmer mit Tickets', 'red'); return; }
  const total = active.reduce((s,p) => s + p.coins, 0);
  const sep = '-'.repeat(48);
  let txt = 'CHAOS CREW - GIVEAWAY GEWINNCHANCEN\n';
  txt += 'Stand: ' + new Date().toLocaleString('de-DE') + '\n';
  txt += 'Gesamt-Tickets: ' + total + '\n' + sep + '\n';
  txt += 'Platz '.padEnd(6) + 'Username'.padEnd(22) + 'Tickets'.padEnd(10) + 'Chance\n' + sep + '\n';
  active.sort((a,b) => b.coins - a.coins).forEach((p, i) => {
    const chance = ((p.coins / total) * 100).toFixed(2);
    txt += String(i+1).padEnd(6) + (p.display||'').padEnd(22) + String(p.coins).padEnd(10) + chance + '%\n';
  });
  dlFile('gewinnchancen.txt', txt, 'text/plain;charset=utf-8');
  log('Gewinnchancen exportiert (' + active.length + ' Teilnehmer)', 'gold');
}

function dlFile(name, content, mime) {
  const blob = new Blob(['\uFEFF' + content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
}

// ── Utils ─────────────────────────────────────────────────
function fmtTime(s) {
  if (!s) return '0:00:00';
  return `${Math.floor(s/3600)}:${String(Math.floor((s%3600)/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
}

function log(msg, type='') {
  const el = document.getElementById('log');
  const t  = new Date();
  const ts = `${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}:${String(t.getSeconds()).padStart(2,'0')}`;
  const e  = document.createElement('div');
  e.className = `log-e ${type}`;
  e.textContent = `[${ts}] ${msg}`;
  if (el) {
    el.insertBefore(e, el.firstChild);
    while (el.children.length > 80) el.removeChild(el.lastChild);
  }
}

function clearLog() {
  const el = document.getElementById('log');
  if (el) el.innerHTML = '';
}

// ── Init ──────────────────────────────────────────────────
if (!window._sfUnitTests) {
  connectWS();
  log('Admin-Panel gestartet', 'cyan');
}
