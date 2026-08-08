// ════════════════════════════════════════════════════════
// RDOC – Stats Page JS
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
  if (name === 'walloffame') loadWallOfFame();
  if (name === 'fights')     loadFights();
}

// ── API Helper ────────────────────────────────────────────
// Caddy-qualifizierte Pfade: die Seite liegt unter /stats/.
async function apiFetch(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Wall of Fame ──────────────────────────────────────────
async function loadWallOfFame() {
  try {
    const data = await apiFetch('/stats/api/spacefight/leaderboard?limit=100');
    const fights = data.reduce((s, p) => s + (parseInt(p.wins) || 0), 0);
    document.getElementById('ps-players').textContent = data.length;
    document.getElementById('ps-fights').textContent  = fights;

    if (!data.length) {
      document.getElementById('walloffame-tbl').innerHTML = '<tr><td colspan="6" class="empty">Noch keine Kämpfe ausgetragen</td></tr>';
      return;
    }
    const rows = data.map((p, i) => `
      <tr>
        <td class="dim">${i+1}</td>
        <td style="font-weight:600;">${esc(p.display || p.username)}</td>
        <td class="num accent">${p.wins}</td>
        <td class="num">${p.losses}</td>
        <td class="dim">${p.ratio}%</td>
        <td class="dim">${fmtDate(p.last_fight)}</td>
      </tr>`).join('');
    document.getElementById('walloffame-tbl').innerHTML = rows;
  } catch(e) {
    document.getElementById('walloffame-tbl').innerHTML = `<tr><td colspan="6" class="empty">Fehler: ${esc(e.message)}</td></tr>`;
  }
}

// ── Kampf-Historie ────────────────────────────────────────
async function loadFights() {
  try {
    const data = await apiFetch('/stats/api/spacefight/history?limit=100');
    if (!data.length) {
      document.getElementById('fights-tbl').innerHTML = '<tr><td colspan="5" class="empty">Noch keine Kämpfe</td></tr>';
      return;
    }
    const rows = data.map(f => `
      <tr>
        <td class="accent">${esc(f.winner)}</td>
        <td class="dim">${f.ship_w ? esc(f.ship_w) : '-'}</td>
        <td>${esc(f.loser)}</td>
        <td class="dim">${f.ship_l ? esc(f.ship_l) : '-'}</td>
        <td class="dim">${fmtDate(f.ts)}</td>
      </tr>`).join('');
    document.getElementById('fights-tbl').innerHTML = rows;
  } catch(e) {
    document.getElementById('fights-tbl').innerHTML = `<tr><td colspan="5" class="empty">Fehler: ${esc(e.message)}</td></tr>`;
  }
}

// ── Utils ─────────────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('de-DE', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Init ──────────────────────────────────────────────────
showTab('walloffame');
