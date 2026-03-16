// ════════════════════════════════════════════════════════
// CHAOS CREW – Giveaway Admin JS
// ════════════════════════════════════════════════════════

// Dezimal-Parser: erzwingt Punkt als Dezimalzeichen (Streamerbot speichert "3.0000")
// Wichtig auf deutschen Systemen wo parseFloat("3.0000") = 3000 liefern könnte
function parseDec(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'string') return parseFloat(v.replace(/,/g, '.')) || 0;
  return parseFloat(v) || 0;
}

// ── State ─────────────────────────────────────────────────
let participants = {};
let gwIsOpen     = false;
let sortField    = 'tickets';
let sortDir      = -1;
let ws           = null;
let wsRetry      = 1000;
let lastWinner   = null;
let CFG = { min:120, sec:5, host:'192.168.178.39', port:9090 };

// ── Config ────────────────────────────────────────────────
function loadCfg() {
  try {
    const c = localStorage.getItem('cc_gw_cfg');
    if (c) CFG = { ...CFG, ...JSON.parse(c) };
  } catch(e) {}
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  setVal('cfg-min',  CFG.min);
  setVal('cfg-sec',  CFG.sec);
  setVal('cfg-host', CFG.host);
  setVal('cfg-port', CFG.port);
}

function saveCfg() {
  const getNum = (id, def) => { const el = document.getElementById(id); return el ? (parseInt(el.value) || def) : def; };
  const getStr = (id, def) => { const el = document.getElementById(id); return el ? el.value : def; };
  CFG.min  = getNum('cfg-min',  120);
  CFG.sec  = getNum('cfg-sec',  5);
  CFG.host = getStr('cfg-host', '192.168.178.39');
  CFG.port = getNum('cfg-port', 9090);
  localStorage.setItem('cc_gw_cfg', JSON.stringify(CFG));
  log('Config gespeichert', 'cyan');
}

// ── WebSocket ─────────────────────────────────────────────
function reconnect() { saveCfg(); if (ws) { ws.onclose=null; ws.close(); } connectWS(); }

function connectWS() {
  try { ws = new WebSocket(`ws://${CFG.host}:${CFG.port}`); }
  catch(e) { scheduleReconnect(); return; }

  ws.onopen = () => {
    setBadge(true);
    wsRetry = 1000;
    log('WebSocket verbunden', 'cyan');
    requestData();
    loadKeyword();
  };
  ws.onmessage = (e) => { try { handle(JSON.parse(e.data)); } catch(err) {} };
  ws.onclose = ws.onerror = () => { setBadge(false); scheduleReconnect(); };
}

function scheduleReconnect() { setTimeout(connectWS, wsRetry); wsRetry = Math.min(wsRetry*2, 15000); }

function setBadge(on) {
  const el = document.getElementById('ws-badge');
  el.className = 'ws-badge ' + (on ? 'on' : 'off');
  el.textContent = on ? `WS: ${CFG.host}:${CFG.port}` : 'WS: OFFLINE';
}

function send(obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  else log('WS nicht verbunden', 'red');
}

function requestData() { send({ event: 'gw_get_all' }); }

setInterval(() => { if (ws && ws.readyState === 1) requestData(); }, 10000);

// ── Message Handler ───────────────────────────────────────
function handle(msg) {
  switch(msg.event) {
    case 'gw_data':
      participants = {};
      gwIsOpen = !!msg.open;
      (msg.participants || []).forEach(p => {
        const key = (p.key || p.display || '').toLowerCase();
        participants[key] = {
          display:  p.display  || key,
          watchSec: parseInt(p.watchSec)   || 0,
          msgs:     parseInt(p.msgs)       || 0,
          tickets:  parseDec(p.tickets),  // Dezimalwert, InvariantCulture-safe
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
      log(`ACK: ${msg.type} -> ${msg.user || msg.keyword || ''}`, 'cyan');
      if (msg.type === 'keyword_set') {
        const kw = msg.keyword || '';
        document.getElementById('kw-current').textContent = kw || '- (deaktiviert)';
        document.getElementById('kw-input').value = kw;
      }
      requestData();
      break;

    case 'gw_keyword': {
      const kw2 = msg.keyword || '';
      document.getElementById('kw-current').textContent = kw2 || '- (deaktiviert)';
      document.getElementById('kw-input').value = kw2;
      break;
    }
  }
}

// ── Giveaway Controls ─────────────────────────────────────
function gwOpen()  { send({ event:'gw_cmd', cmd:'gw_open'  }); gwIsOpen=true;  updateGwStatus(); log('Giveaway geoffnet','cyan'); }
function gwClose() { send({ event:'gw_cmd', cmd:'gw_close' }); gwIsOpen=false; updateGwStatus(); log('Giveaway geschlossen','gold'); }

function updateGwStatus() {
  const el = document.getElementById('gw-txt');
  if (gwIsOpen) { el.textContent='OPEN';   el.className='gw-status open'; }
  else          { el.textContent='CLOSED'; el.className='gw-status closed'; }
}

function drawWinner(excludeKey=null) {
  const pool = [];
  for (const [k,p] of Object.entries(participants)) {
    if (!p.banned && p.tickets > 0 && k !== excludeKey) {
      // Kommawert-Tickets: 0.5 = 50 Lose, 1.0 = 100 Lose (Gewichtung)
      const lots = Math.max(1, Math.round(parseFloat(p.tickets) * 100));
      for (let i=0; i<lots; i++) pool.push(k);
    }
  }
  if (!pool.length) { log('Keine Tickets im Pool!', 'red'); return; }

  let flashes = 0;
  document.getElementById('winner-card').style.display = 'block';
  const interval = setInterval(() => {
    const tmp = pool[Math.floor(Math.random()*pool.length)];
    document.getElementById('w-name').textContent = (participants[tmp]?.display||tmp).toUpperCase();
    if (++flashes >= 14) {
      clearInterval(interval);
      lastWinner = pool[Math.floor(Math.random()*pool.length)];
      const wp = participants[lastWinner];
      document.getElementById('w-name').textContent = (wp?.display||lastWinner).toUpperCase();
      document.getElementById('w-info').textContent = `${wp?.tickets||0} Tickets // ${fmtTime(wp?.watchSec||0)}`;
      renderTable(lastWinner);
      broadcastOverlay(wp?.display||lastWinner);
      log(`GEWINNER: ${wp?.display||lastWinner} (${wp?.tickets||0} Tickets)`, 'gold');
    }
  }, 75);
}

function reroll()      { drawWinner(lastWinner); }
function clearWinner() { lastWinner=null; document.getElementById('winner-card').style.display='none'; broadcastOverlay(); }

// ── Manual Actions ────────────────────────────────────────
function manualAdd() {
  const name = document.getElementById('m-name').value.trim();
  const amt  = parseInt(document.getElementById('m-amount').value) || 1;
  if (!name) return;
  for (let i=0; i<amt; i++) send({ event:'gw_cmd', cmd:'gw_add_ticket', user:name });
  log(`+${amt} Ticket(s) -> ${name}`, 'cyan');
  setTimeout(requestData, 300);
}

function manualSub() {
  const name = document.getElementById('m-name').value.trim();
  const amt  = parseInt(document.getElementById('m-amount').value) || 1;
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
  if (!confirm('ALLE Daten in Streamerbot loeschen? Nicht rueckgaengig!')) return;
  send({ event:'gw_cmd', cmd:'gw_reset' });
  participants={}; gwIsOpen=false; lastWinner=null;
  document.getElementById('winner-card').style.display = 'none';
  updateGwStatus(); renderTable(); updateStats(); broadcastOverlay();
  log('RESET – alle Daten geloescht', 'red');
}

// ── Keyword ───────────────────────────────────────────────
function setKeyword() {
  const kw = document.getElementById('kw-input').value.trim();
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
      const av = sortField==='name' ? (a.display||'').toLowerCase() : (a[sortField]||0);
      const bv = sortField==='name' ? (b.display||'').toLowerCase() : (b[sortField]||0);
      return sortDir * (av<bv?-1:av>bv?1:0);
    });

  document.getElementById('list-count').textContent = entries.length;
  document.getElementById('tbl').innerHTML = entries.map(([key,p],i) => `
    <tr class="${p.banned?'banned':''} ${key===hlKey?'winner-row':''}">
      <td class="rank">${i+1}</td>
      <td class="name">${esc(p.display||key)}${p.banned?' <span style="color:var(--red);font-size:10px;">[BAN]</span>':''}</td>
      <td class="tickets">${typeof p.tickets === 'number' ? p.tickets.toFixed(4).replace(/\.?0+$/, '') : p.tickets}</td>
      <td class="watchtime">${fmtTime(p.watchSec)}</td>
      <td class="msgs">${p.msgs}</td>
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
  document.getElementById('s-tickets').textContent = active.reduce((s,p)=>s+(parseFloat(p.tickets)||0),0).toFixed(4).replace(/\.?0+$/,'');
  document.getElementById('s-msgs').textContent    = active.reduce((s,p)=>s+p.msgs,0);
}

function broadcastOverlay(winner=null) {
  send({
    event:   'gw_overlay',
    open:    gwIsOpen,
    total:   Object.values(participants).filter(p=>!p.banned).length,
    tickets: Object.values(participants).filter(p=>!p.banned&&p.tickets>0).reduce((s,p)=>s+p.tickets,0),
    top5:    [...Object.values(participants)].filter(p=>!p.banned&&p.tickets>0)
               .sort((a,b)=>b.tickets-a.tickets).slice(0,5)
               .map(p=>({ name:p.display, tickets:p.tickets })),
    winner:  winner || null
  });
}

// ── Export ────────────────────────────────────────────────
function exportCSV() {
  const active = Object.values(participants).filter(p => !p.banned);
  if (!active.length) { log('Keine Daten zum Exportieren', 'red'); return; }
  const total = active.reduce((s,p) => s + (p.tickets||0), 0);
  const rows = [['Username','Tickets','Watchtime','Nachrichten','Gewinnchance %']];
  active.sort((a,b) => b.tickets - a.tickets).forEach(p => {
    const chance = total > 0 ? ((p.tickets / total) * 100).toFixed(2) : '0.00';
    rows.push([p.display, p.tickets, fmtTime(p.watchSec), p.msgs, chance]);
  });
  const csv = rows.map(r => r.join(';')).join('\n');
  dlFile('giveaway_export.csv', csv, 'text/csv;charset=utf-8');
  log('CSV exportiert (' + active.length + ' Teilnehmer)', 'cyan');
}

function exportChances() {
  const active = Object.values(participants).filter(p => !p.banned && p.tickets > 0);
  if (!active.length) { log('Keine Teilnehmer mit Tickets', 'red'); return; }
  const total = active.reduce((s,p) => s + p.tickets, 0);
  const sep = '-'.repeat(48);
  let txt = 'CHAOS CREW - GIVEAWAY GEWINNCHANCEN\n';
  txt += 'Stand: ' + new Date().toLocaleString('de-DE') + '\n';
  txt += 'Gesamt-Tickets: ' + total + '\n';
  txt += sep + '\n';
  txt += 'Platz '.padEnd(6) + 'Username'.padEnd(22) + 'Tickets'.padEnd(10) + 'Chance\n';
  txt += sep + '\n';
  active.sort((a,b) => b.tickets - a.tickets).forEach((p, i) => {
    const chance = ((p.tickets / total) * 100).toFixed(2);
    txt += String(i+1).padEnd(6) + (p.display||'').padEnd(22) + String(p.tickets).padEnd(10) + chance + '%\n';
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

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function log(msg, type='') {
  const el = document.getElementById('log');
  const t  = new Date();
  const ts = `${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}:${String(t.getSeconds()).padStart(2,'0')}`;
  const e  = document.createElement('div');
  e.className = `log-e ${type}`;
  e.textContent = `[${ts}] ${msg}`;
  el.insertBefore(e, el.firstChild);
  while (el.children.length > 80) el.removeChild(el.lastChild);
}

function clearLog() { document.getElementById('log').innerHTML = ''; }

// ── Init ──────────────────────────────────────────────────
loadCfg();
connectWS();
log('Admin-Panel gestartet', 'cyan');
