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
let participants = {};
let gwIsOpen     = false;
let sortField    = 'coins';
let sortDir      = -1;
let gwWs         = null;
let gwWsRetry    = 1000;
let gwWsReconnectTimer = null;
let lastWinner   = null;

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
    requestData();
    loadKeyword();
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
  if (!CC.validate.validateWsPayload(obj)) { log('Payload blockiert: ' + JSON.stringify(obj).slice(0,60), 'red'); return; }
  if (gwWs && gwWs.readyState === 1) gwWs.send(JSON.stringify(obj));
  else log('WS nicht verbunden', 'red');
}

function requestData() { send({ event: 'gw_get_all' }); }

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
      broadcastOverlay();
      break;

    case 'gw_status':
      gwIsOpen = msg.status === 'open';
      updateGwStatus();
      broadcastOverlay();
      break;

    case 'gw_ack':
      log(`ACK: ${msg.type} -> ${msg.user || msg.keyword || msg.winner || ''}`, 'cyan');
      if (msg.type === 'keyword_set' || msg.type === 'keyword') {
        const kw = msg.keyword || '';
        document.getElementById('kw-current').textContent = kw || '- (deaktiviert)';
        document.getElementById('kw-input').value = kw;
      }
      if (msg.type === 'winner_drawn') showWinnerAnimation(msg.winner, msg.watchSec, msg.coins);
      if (msg.type === 'no_winner') log('Keine Teilnehmer mit Coins im Pool!', 'red');
      requestData();
      break;

    case 'gw_keyword': {
      const kw2 = msg.keyword || '';
      document.getElementById('kw-current').textContent = kw2 || '- (deaktiviert)';
      document.getElementById('kw-input').value = kw2;
      break;
    }

    case 'cc_first_chatter_status':
      updateFirstChatterUI(!!msg.enabled);
      break;

    case 'ws_clients':
      renderWsClients(msg.clients || []);
      break;

    case 'ws_traffic':
      appendWsTraffic(msg);
      break;
  }
}

function toggleFirstChatter() {
  send({ event: 'gw_cmd', cmd: 'cc_first_chatter_toggle' });
}

function updateFirstChatterUI(enabled) {
  const status = document.getElementById('fc-status');
  const btn    = document.getElementById('fc-btn');
  if (!status || !btn) return;
  if (enabled) {
    status.textContent = 'AKTIV';
    status.style.color = 'var(--cyan)';
    btn.textContent = 'DEAKTIVIEREN';
    btn.className = 'btn btn-gold';
  } else {
    status.textContent = 'INAKTIV';
    status.style.color = 'var(--dim)';
    btn.textContent = 'AKTIVIEREN';
    btn.className = 'btn btn-cyan';
  }
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

function drawWinner() { send({ event:'gw_cmd', cmd:'gw_draw_winner' }); }

function showWinnerAnimation(winnerName, watchSec, coins) {
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
      document.getElementById('w-info').textContent = `${parseDec(coins).toFixed(2)} Coins // ${fmtTime(watchSec||0)}`;
      renderTable(winnerName);
      log(`GEWINNER: ${winnerName} (${parseDec(coins).toFixed(2)} Coins)`, 'gold');
    }
  }, 75);
}

function reroll()      { drawWinner(); }
function clearWinner() { lastWinner=null; document.getElementById('winner-card').style.display='none'; broadcastOverlay(); }

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
  updateGwStatus(); renderTable(); updateStats(); broadcastOverlay();
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

function broadcastOverlay(winner=null) {
  send({
    event:   'gw_overlay',
    open:    gwIsOpen,
    total:   Object.values(participants).filter(p=>!p.banned).length,
    tickets: Object.values(participants).filter(p=>!p.banned&&p.coins>0).reduce((s,p)=>s+p.coins,0),
    top5:    [...Object.values(participants)].filter(p=>!p.banned&&p.coins>0)
               .sort((a,b)=>b.coins-a.coins).slice(0,5)
               .map(p=>({ name:p.display, tickets:p.coins })),
    winner:  winner || null
  });
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
