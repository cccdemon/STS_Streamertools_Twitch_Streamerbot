// ════════════════════════════════════════════════════════
// CHAOS CREW – Stats Page JS
// Reads from the Stats Service API (PostgreSQL)
// ════════════════════════════════════════════════════════

// ── Tab Navigation ────────────────────────────────────────
function showTab(name) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  document.querySelector(`[data-tab="${name}"]`).classList.add('active');
  loadTab(name);
}

function loadTab(name) {
  if (name === 'participants') loadParticipants();
  if (name === 'winners')      loadWinners();
  if (name === 'leaderboard')  loadLeaderboard();
  if (name === 'sessions')     loadSessions();
}

// ── API Helper ────────────────────────────────────────────
// Full Caddy-qualified paths: stats page is at /stats/, but
// current-session participants live in the giveaway service.
async function apiFetch(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Participants ──────────────────────────────────────────
async function loadParticipants() {
  try {
    const data = await apiFetch('/giveaway/api/participants');
    const p = data.participants || [];

    const active  = p.filter(x => !x.banned);
    const total   = active.reduce((s,x) => s + (parseFloat(x.coins)||0), 0);
    document.getElementById('ps-total').textContent   = active.length;
    document.getElementById('ps-tickets').textContent = total.toFixed(2).replace(/\.?0+$/,'');
    document.getElementById('ps-session').textContent = data.session || '-';

    if (!p.length) {
      document.getElementById('participants-tbl').innerHTML = '<tr><td colspan="6" class="empty">Keine Teilnehmer in der aktuellen Session</td></tr>';
      return;
    }

    const rows = p.map((x, i) => {
      const coins = parseFloat(x.coins) || 0;
      return `
      <tr class="${x.banned ? 'opacity-40' : ''}">
        <td class="dim">${i+1}</td>
        <td style="font-weight:600;">${esc(x.username)}</td>
        <td class="num">${coins.toFixed(2)}</td>
        <td class="dim">${fmtTime(parseInt(x.watchSec)||0)}</td>
        <td class="dim">${parseInt(x.msgs)||0}</td>
        <td class="dim" style="font-size:11px;">${total > 0 ? ((coins/total)*100).toFixed(1)+'%' : '0%'}</td>
      </tr>`;
    }).join('');
    document.getElementById('participants-tbl').innerHTML = rows;
  } catch(e) {
    document.getElementById('participants-tbl').innerHTML = `<tr><td colspan="6" class="empty">Fehler: ${esc(e.message)}</td></tr>`;
  }
}

// ── Winners ───────────────────────────────────────────────
async function loadWinners() {
  try {
    const data = await apiFetch('/stats/api/winners?limit=50');
    if (!data.length) {
      document.getElementById('winners-tbl').innerHTML = '<tr><td colspan="5" class="empty">Noch keine Gewinner</td></tr>';
      return;
    }
    const rows = data.map(w => `
      <tr>
        <td class="winner-badge">WINNER</td>
        <td style="font-weight:600;color:var(--gold);">${esc(w.display)}</td>
        <td class="num">${w.tickets}</td>
        <td class="dim">${w.keyword ? esc(w.keyword) : '-'}</td>
        <td class="dim">${fmtDate(w.won_at)}</td>
      </tr>`).join('');
    document.getElementById('winners-tbl').innerHTML = rows;
  } catch(e) {
    document.getElementById('winners-tbl').innerHTML = `<tr><td colspan="5" class="empty">Fehler: ${esc(e.message)}</td></tr>`;
  }
}

// ── Leaderboard ───────────────────────────────────────────
async function loadLeaderboard() {
  try {
    const data = await apiFetch('/stats/api/leaderboard?limit=100');
    if (!data.length) {
      document.getElementById('leaderboard-tbl').innerHTML = '<tr><td colspan="6" class="empty">Noch keine Daten</td></tr>';
      return;
    }
    const rows = data.map((u, i) => `
      <tr>
        <td class="dim">${i+1}</td>
        <td style="font-weight:600;">${esc(u.display)}</td>
        <td class="num">${u.total_tickets}</td>
        <td class="dim">${fmtTime(parseInt(u.total_watch_sec)||0)}</td>
        <td class="dim">${u.total_msgs}</td>
        <td class="gold">${u.times_won > 0 ? u.times_won + 'x' : '-'}</td>
      </tr>`).join('');
    document.getElementById('leaderboard-tbl').innerHTML = rows;
  } catch(e) {
    document.getElementById('leaderboard-tbl').innerHTML = `<tr><td colspan="6" class="empty">Fehler: ${esc(e.message)}</td></tr>`;
  }
}

// ── Sessions ──────────────────────────────────────────────
async function loadSessions() {
  try {
    const data = await apiFetch('/stats/api/sessions?limit=20');
    if (!data.length) {
      document.getElementById('sessions-tbl').innerHTML = '<tr><td colspan="6" class="empty">Noch keine Sessions</td></tr>';
      return;
    }
    const rows = data.map(s => `
      <tr>
        <td class="num">#${s.id}</td>
        <td class="dim">${fmtDate(s.opened_at)}</td>
        <td class="dim">${s.closed_at ? fmtDate(s.closed_at) : '<span style="color:var(--green)">OFFEN</span>'}</td>
        <td class="dim">${s.total_participants || 0}</td>
        <td class="num">${s.total_tickets || 0}</td>
        <td class="${s.winner ? 'gold' : 'dim'}">${s.winner ? esc(s.winner_display || s.winner) : '-'}</td>
      </tr>`).join('');
    document.getElementById('sessions-tbl').innerHTML = rows;
  } catch(e) {
    document.getElementById('sessions-tbl').innerHTML = `<tr><td colspan="6" class="empty">Fehler: ${esc(e.message)}</td></tr>`;
  }
}

// ── Utils ─────────────────────────────────────────────────
function fmtTime(s) {
  if (!s) return '0:00:00';
  return `${Math.floor(s/3600)}:${String(Math.floor((s%3600)/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
}

function fmtDate(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('de-DE', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Init ──────────────────────────────────────────────────
showTab('participants');
