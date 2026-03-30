// ════════════════════════════════════════════════════════
// CHAOS CREW – Shared Navigation
// nav.js – einbinden in alle Admin-Seiten
// ════════════════════════════════════════════════════════

(function() {
  var PAGES = [
    { href: 'giveaway-admin.html',  label: 'ADMIN PANEL',   group: 'giveaway' },
    { href: 'stats.html',           label: 'STATISTIKEN',   group: 'giveaway' },
    { href: 'giveaway-test.html',   label: 'TEST CONSOLE',  group: 'tools' },
    { href: 'tests/test-runner.html', label: 'TEST SUITE',  group: 'tools' },
    { sep: true },
    { href: 'streamerbot.html',     label: 'C# ACTIONS',    group: 'tools', color: 'gold' },
    { sep: true },
    { href: 'spacefight-admin.html', label: 'SF ADMIN', group: 'tools', color: 'gold' },
    { sep: true },
    { href: 'giveaway-overlay.html', label: 'GW OVERLAY',   group: 'obs', obs: true },
    { href: 'giveaway-join.html',   label: 'JOIN ANIM',     group: 'obs', obs: true },
    { href: 'chat.html',            label: 'HUD CHAT',      group: 'obs', obs: true },
    { href: 'spacefight.html',      label: 'RAUMKAMPF',     group: 'obs', obs: true },
  ];

  var base = window._navBase || '';
  var currentPage = window.location.pathname.split('/').pop() || 'index.html';
  if (currentPage === '') currentPage = 'index.html';

  var nav = document.createElement('nav');
  nav.className = 'cc-nav';

  // Home-Link
  var home = document.createElement('a');
  home.href = base + 'index.html';
  home.className = 'cc-nav-home';
  home.innerHTML =
    '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M6 1L11 5.5V11H8V8H4V11H1V5.5L6 1Z" stroke="currentColor" stroke-width="1.2" fill="none"/>' +
    '</svg>' +
    'CHAOS CREW';
  if (currentPage === 'index.html') home.classList.add('active');
  nav.appendChild(home);

  var items = document.createElement('div');
  items.className = 'cc-nav-items';

  PAGES.forEach(function(p) {
    if (p.sep) {
      var sep = document.createElement('div');
      sep.className = 'cc-nav-sep';
      items.appendChild(sep);
      return;
    }

    var a = document.createElement('a');
    // Normalize href for comparison (strip query string)
    var hrefBase = p.href.split('?')[0];
    var isCurrent = (currentPage === hrefBase) ||
                    (currentPage === '' && p.href === 'index.html');

    a.href = base + p.href;
    a.className = 'cc-nav-item' +
      (p.color ? ' ' + p.color : '') +
      (isCurrent ? ' active' : '');

    if (p.obs) {
      a.innerHTML = p.label + '<span class="nav-obs">OBS</span>';
      a.target = '_blank';
    } else {
      a.textContent = p.label;
    }

    items.appendChild(a);
  });

  nav.appendChild(items);

  // Nav als erstes Element nach <body> einfügen
  // nav.js wird als erstes Script im <body> geladen – body existiert bereits
  var body = document.body || document.getElementsByTagName('body')[0];
  if (body) body.insertBefore(nav, body.firstChild);
  else document.addEventListener('DOMContentLoaded', function() {
    document.body.insertBefore(nav, document.body.firstChild);
  });
})();

// ════════════════════════════════════════════════════════
// CHAOS CREW – Debug Console (Bottom Bar)
// Zeigt WS-Traffic: Sends (→) und Receives (←)
// ════════════════════════════════════════════════════════

(function() {
  var MAX_ENTRIES = 200;
  var entries     = [];
  var paused      = false;
  var filterText  = '';
  var consoleOpen = false;

  // ── DOM aufbauen ────────────────────────────────────────
  var style = document.createElement('style');
  style.textContent = [
    '.cc-dbg-bar{position:fixed;bottom:0;left:0;right:0;z-index:9999;font-family:"Share Tech Mono",monospace;font-size:11px;}',
    '.cc-dbg-handle{background:#04060a;border-top:1px solid rgba(0,212,255,0.2);height:28px;display:flex;align-items:center;padding:0 12px;gap:10px;cursor:pointer;user-select:none;}',
    '.cc-dbg-handle:hover{background:#080e14;}',
    '.cc-dbg-label{color:rgba(0,212,255,0.6);letter-spacing:1.5px;font-size:10px;}',
    '.cc-dbg-dot{width:6px;height:6px;border-radius:50%;background:#333;flex-shrink:0;transition:background 0.2s;}',
    '.cc-dbg-dot.send{background:#00d4ff;}',
    '.cc-dbg-dot.recv{background:#00ff88;}',
    '.cc-dbg-dot.err{background:#ff4444;}',
    '.cc-dbg-count{color:rgba(200,220,232,0.3);font-size:9px;margin-left:auto;}',
    '.cc-dbg-btns{display:flex;gap:6px;margin-left:8px;}',
    '.cc-dbg-btn{background:transparent;border:1px solid rgba(0,212,255,0.2);color:rgba(200,220,232,0.5);font-family:"Share Tech Mono",monospace;font-size:9px;letter-spacing:1px;padding:2px 8px;cursor:pointer;transition:all 0.15s;}',
    '.cc-dbg-btn:hover{border-color:rgba(0,212,255,0.5);color:rgba(200,220,232,0.9);}',
    '.cc-dbg-btn.active{border-color:#ff4444;color:#ff4444;}',
    '.cc-dbg-panel{background:#04060a;border-top:1px solid rgba(0,212,255,0.15);height:240px;display:none;flex-direction:column;}',
    '.cc-dbg-panel.open{display:flex;}',
    '.cc-dbg-toolbar{display:flex;align-items:center;gap:8px;padding:5px 10px;border-bottom:1px solid rgba(0,212,255,0.08);flex-shrink:0;}',
    '.cc-dbg-filter{background:rgba(255,255,255,0.04);border:1px solid rgba(0,212,255,0.15);color:rgba(200,220,232,0.8);font-family:"Share Tech Mono",monospace;font-size:10px;padding:3px 8px;width:180px;outline:none;}',
    '.cc-dbg-filter:focus{border-color:rgba(0,212,255,0.4);}',
    '.cc-dbg-filter::placeholder{color:rgba(200,220,232,0.2);}',
    '.cc-dbg-log{flex:1;overflow-y:auto;padding:4px 0;}',
    '.cc-dbg-log::-webkit-scrollbar{width:3px;}',
    '.cc-dbg-log::-webkit-scrollbar-track{background:#04060a;}',
    '.cc-dbg-log::-webkit-scrollbar-thumb{background:rgba(0,212,255,0.2);}',
    '.cc-dbg-entry{display:flex;align-items:baseline;gap:8px;padding:2px 10px;border-bottom:1px solid rgba(255,255,255,0.02);cursor:pointer;}',
    '.cc-dbg-entry:hover{background:rgba(0,212,255,0.04);}',
    '.cc-dbg-entry.expanded .cc-dbg-body{white-space:pre;overflow-x:auto;}',
    '.cc-dbg-ts{color:rgba(200,220,232,0.25);font-size:9px;flex-shrink:0;min-width:65px;}',
    '.cc-dbg-dir{font-size:10px;flex-shrink:0;min-width:14px;}',
    '.cc-dbg-dir.send{color:rgba(0,212,255,0.7);}',
    '.cc-dbg-dir.recv{color:rgba(0,255,136,0.7);}',
    '.cc-dbg-dir.err{color:rgba(255,68,68,0.8);}',
    '.cc-dbg-dir.info{color:rgba(240,165,0,0.6);}',
    '.cc-dbg-evt{color:rgba(0,212,255,0.5);flex-shrink:0;min-width:120px;}',
    '.cc-dbg-body{color:rgba(200,220,232,0.55);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;}',
    '.cc-dbg-body.send-color{color:rgba(0,212,255,0.55);}',
    '.cc-dbg-body.recv-color{color:rgba(0,255,136,0.55);}',
    '.cc-dbg-body.err-color{color:rgba(255,68,68,0.7);}',
  ].join('');
  document.head.appendChild(style);

  var bar = document.createElement('div');
  bar.className = 'cc-dbg-bar';

  // Handle (immer sichtbar)
  var handle = document.createElement('div');
  handle.className = 'cc-dbg-handle';
  handle.innerHTML =
    '<div class="cc-dbg-dot" id="cc-dbg-dot"></div>' +
    '<span class="cc-dbg-label">DEBUG CONSOLE</span>' +
    '<span class="cc-dbg-count" id="cc-dbg-count">0 Events</span>' +
    '<div class="cc-dbg-btns">' +
      '<button class="cc-dbg-btn" id="cc-dbg-pause">PAUSE</button>' +
      '<button class="cc-dbg-btn" id="cc-dbg-clear">CLEAR</button>' +
    '</div>';
  bar.appendChild(handle);

  // Panel
  var panel = document.createElement('div');
  panel.className = 'cc-dbg-panel';
  panel.id = 'cc-dbg-panel';
  panel.innerHTML =
    '<div class="cc-dbg-toolbar">' +
      '<input class="cc-dbg-filter" id="cc-dbg-filter" placeholder="Filter (event, cmd, user...)" type="text">' +
      '<span style="color:rgba(200,220,232,0.2);font-size:9px;margin-left:auto;">Klick auf Zeile = Details expandieren</span>' +
    '</div>' +
    '<div class="cc-dbg-log" id="cc-dbg-log"></div>';
  bar.appendChild(panel);

  document.body.appendChild(bar);

  // ── Toggle ───────────────────────────────────────────────
  handle.addEventListener('click', function(e) {
    if (e.target.tagName === 'BUTTON') return;
    consoleOpen = !consoleOpen;
    panel.classList.toggle('open', consoleOpen);
  });

  document.getElementById('cc-dbg-pause').addEventListener('click', function() {
    paused = !paused;
    this.textContent = paused ? 'RESUME' : 'PAUSE';
    this.classList.toggle('active', paused);
  });

  document.getElementById('cc-dbg-clear').addEventListener('click', function() {
    entries = [];
    document.getElementById('cc-dbg-log').innerHTML = '';
    document.getElementById('cc-dbg-count').textContent = '0 Events';
  });

  document.getElementById('cc-dbg-filter').addEventListener('input', function() {
    filterText = this.value.toLowerCase();
    renderAll();
  });

  // ── Log-Eintrag hinzufügen ───────────────────────────────
  function addEntry(dir, data) {
    if (paused) return;

    var now = new Date();
    var ts  = pad2(now.getHours()) + ':' + pad2(now.getMinutes()) + ':' + pad2(now.getSeconds()) +
              '.' + String(now.getMilliseconds()).padStart(3,'0').slice(0,2);

    var parsed = null;
    var evtName = '';
    var bodyStr = '';

    if (typeof data === 'string') {
      try { parsed = JSON.parse(data); } catch(e) { bodyStr = data; }
    } else if (typeof data === 'object') {
      parsed = data;
    }

    if (parsed) {
      evtName = parsed.event || parsed.cmd || parsed.type || parsed.request || '';
      if (!evtName && parsed.event === undefined && parsed.cmd) evtName = parsed.cmd;
      bodyStr = JSON.stringify(parsed);
    }

    var entry = { dir: dir, ts: ts, evt: evtName, body: bodyStr, raw: data };
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) entries.shift();

    // Dot blinken
    var dot = document.getElementById('cc-dbg-dot');
    if (dot) {
      dot.className = 'cc-dbg-dot ' + dir;
      setTimeout(function(){ dot.className = 'cc-dbg-dot'; }, 300);
    }

    // Count
    var countEl = document.getElementById('cc-dbg-count');
    if (countEl) countEl.textContent = entries.length + ' Events';

    // Render wenn Panel offen
    if (consoleOpen) renderEntry(entry, true);
  }

  // ── Render ───────────────────────────────────────────────
  function renderEntry(entry, append) {
    if (filterText && entry.body.toLowerCase().indexOf(filterText) === -1 &&
        entry.evt.toLowerCase().indexOf(filterText) === -1) return;

    var log = document.getElementById('cc-dbg-log');
    if (!log) return;

    var row = document.createElement('div');
    row.className = 'cc-dbg-entry';
    row.innerHTML =
      '<span class="cc-dbg-ts">' + entry.ts + '</span>' +
      '<span class="cc-dbg-dir ' + entry.dir + '">' +
        (entry.dir === 'send' ? '→' : entry.dir === 'recv' ? '←' : entry.dir === 'err' ? '✕' : '·') +
      '</span>' +
      '<span class="cc-dbg-evt">' + esc(entry.evt || '–') + '</span>' +
      '<span class="cc-dbg-body ' + entry.dir + '-color">' + esc(entry.body) + '</span>';

    // Click → expand/collapse
    row.addEventListener('click', function() {
      this.classList.toggle('expanded');
      var b = this.querySelector('.cc-dbg-body');
      if (this.classList.contains('expanded')) {
        try { b.textContent = JSON.stringify(JSON.parse(entry.body), null, 2); }
        catch(e) { b.textContent = entry.body; }
        b.style.whiteSpace = 'pre';
        b.style.overflow   = 'auto';
        b.style.maxHeight  = '120px';
        b.style.display    = 'block';
      } else {
        b.textContent = entry.body;
        b.style.whiteSpace  = 'nowrap';
        b.style.overflow    = 'hidden';
        b.style.maxHeight   = '';
        b.style.display     = '';
      }
    });

    if (append) {
      log.appendChild(row);
      log.scrollTop = log.scrollHeight;
    } else {
      log.insertBefore(row, log.firstChild);
    }
  }

  function renderAll() {
    var log = document.getElementById('cc-dbg-log');
    if (!log) return;
    log.innerHTML = '';
    entries.forEach(function(e) { renderEntry(e, true); });
  }

  // ── WebSocket-Monkey-Patching ─────────────────────────────
  // Alle WebSocket-Instanzen auf der Seite werden abgehört
  var OrigWS = window.WebSocket;
  window.WebSocket = function(url, protocols) {
    var ws = protocols ? new OrigWS(url, protocols) : new OrigWS(url);

    addEntry('info', { event: 'ws:connect', url: url });

    var origSend = ws.send.bind(ws);
    ws.send = function(data) {
      addEntry('send', data);
      return origSend(data);
    };

    ws.addEventListener('message', function(e) {
      addEntry('recv', e.data);
    });

    ws.addEventListener('close', function(e) {
      addEntry('info', { event: 'ws:close', code: e.code, url: url });
    });

    ws.addEventListener('error', function() {
      addEntry('err', { event: 'ws:error', url: url });
    });

    return ws;
  };
  // Prototype kopieren damit instanceof-Checks funktionieren
  window.WebSocket.prototype = OrigWS.prototype;
  window.WebSocket.CONNECTING = OrigWS.CONNECTING;
  window.WebSocket.OPEN       = OrigWS.OPEN;
  window.WebSocket.CLOSING    = OrigWS.CLOSING;
  window.WebSocket.CLOSED     = OrigWS.CLOSED;

  // ── Fetch-Interceptor (REST API calls) ───────────────────
  var origFetch = window.fetch;
  window.fetch = function(url, opts) {
    var method  = (opts && opts.method) || 'GET';
    var shortUrl = String(url).replace(window.location.origin, '');
    addEntry('send', { event: 'http:' + method, url: shortUrl });
    return origFetch.apply(this, arguments).then(function(res) {
      var status = res.status;
      var clone  = res.clone();
      clone.text().then(function(body) {
        try { addEntry('recv', JSON.parse(body)); }
        catch(e) { addEntry('recv', { event: 'http:response', status: status, url: shortUrl }); }
      });
      return res;
    }).catch(function(err) {
      addEntry('err', { event: 'http:error', url: shortUrl, msg: err.message });
      throw err;
    });
  };

  // ── Hilfsfunktionen ──────────────────────────────────────
  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  function esc(s)  { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // Public API – andere Skripte können direkt loggen
  window.ccDebug = { log: addEntry };
})();
