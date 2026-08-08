/**
 * RDOC – Microservice Shared Lib
 * CC.validate + Navigation + Debug Console
 * Used by all admin pages across all services.
 */

// ── CC.validate ───────────────────────────────────────────
(function(global) {
  'use strict';

  function escHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  }

  var STR_RULES = {
    username: { maxLen:25, pattern:/^[a-zA-Z0-9_]{1,25}$/, clean:function(s){return s.replace(/[^a-zA-Z0-9_]/g,'').slice(0,25);} },
    keyword:  { maxLen:50, pattern:/^[^\x00-\x1F<>"'`\\]{1,50}$/, clean:function(s){return s.replace(/[\x00-\x1F<>"'`\\]/g,'').slice(0,50);} },
    display:  { maxLen:50, pattern:/^[^\x00-\x1F<>]{1,50}$/, clean:function(s){return s.replace(/[\x00-\x1F<>]/g,'').slice(0,50);} },
    wsEvent:  { maxLen:40, pattern:/^[a-z_:]{1,40}$/, clean:function(s){return s.replace(/[^a-z_:]/g,'').slice(0,40);} },
    host:     { maxLen:253, pattern:/^[a-zA-Z0-9.\-]{1,253}$/, clean:function(s){return s.replace(/[^a-zA-Z0-9.\-]/g,'').slice(0,253);} },
    port:     { maxLen:5, pattern:/^\d{1,5}$/, clean:function(s){var n=parseInt(s.replace(/\D/g,''));if(isNaN(n)||n<1||n>65535)return'9090';return String(n);} }
  };

  function sanitize(value, type) {
    if (value === null || value === undefined) return '';
    var s = String(value).trim();
    var rule = STR_RULES[type];
    if (!rule) return s.slice(0, 200);
    return rule.clean(s);
  }

  function validate(value, type) {
    if (value === null || value === undefined) return false;
    var s = String(value).trim();
    var rule = STR_RULES[type];
    if (!rule) return s.length > 0 && s.length <= 200;
    if (s.length === 0 || s.length > rule.maxLen) return false;
    return rule.pattern.test(s);
  }

  function sanitizeInt(value, min, max, fallback) {
    var n = parseInt(value, 10);
    if (isNaN(n)) return fallback !== undefined ? fallback : 0;
    if (min !== undefined && n < min) return min;
    if (max !== undefined && n > max) return max;
    return n;
  }

  function sanitizeFloat(value, min, max, fallback) {
    var s = String(value).replace(/,/g, '.');
    var n = parseFloat(s);
    if (isNaN(n)) return fallback !== undefined ? fallback : 0;
    if (min !== undefined && n < min) return min;
    if (max !== undefined && n > max) return max;
    return n;
  }

  var FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'];

  function safeJsonParse(str) {
    if (typeof str !== 'string') return null;
    var parsed;
    try { parsed = JSON.parse(str); } catch(e) { return null; }
    return deepFreeze(sanitizeObject(parsed, 0));
  }

  function sanitizeObject(obj, depth) {
    if (depth > 10) return null;
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) {
      return obj.slice(0, 1000).map(function(item) { return sanitizeObject(item, depth + 1); });
    }
    var clean = Object.create(null);
    Object.keys(obj).forEach(function(key) {
      if (FORBIDDEN_KEYS.indexOf(key) !== -1) return;
      if (key.length > 200) return;
      clean[key] = sanitizeObject(obj[key], depth + 1);
    });
    return clean;
  }

  function deepFreeze(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    Object.getOwnPropertyNames(obj).forEach(function(name) { deepFreeze(obj[name]); });
    return Object.freeze(obj);
  }

  var ALLOWED_EVENTS = [
    'spacefight_result', 'chat_msg',
    'sf_cmd', 'sf_status_request',
    'cc_identify',
    'ws:connect', 'ws:close', 'http:GET', 'http:POST', 'http:PUT', 'http:DELETE', 'http:PATCH'
  ];

  var ALLOWED_CMDS = [
    'cc_first_chatter_toggle',
    'sf_start', 'sf_stop', 'sf_reset',
    'sf_delete_player', 'sf_edit_player'
  ];

  function validateWsPayload(obj) {
    if (!obj || typeof obj !== 'object') return false;
    var evt = obj.event;
    if (!evt || typeof evt !== 'string') return false;
    if (ALLOWED_EVENTS.indexOf(evt) === -1) {
      console.warn('[validate] Unbekanntes WS Event blockiert:', evt);
      return false;
    }
    if (evt === 'sf_cmd') {
      if (!obj.cmd || ALLOWED_CMDS.indexOf(obj.cmd) === -1) {
        console.warn('[validate] Unbekanntes cmd blockiert:', obj.cmd);
        return false;
      }
      if (obj.user && !validate(obj.user, 'username')) {
        console.warn('[validate] Ungültiger username blockiert:', obj.user);
        return false;
      }
      if (obj.keyword !== undefined) {
        obj = Object.assign({}, obj, { keyword: sanitize(obj.keyword, 'keyword') });
      }
    }
    return true;
  }

  function getInputVal(id, type, fallback) {
    var el = document.getElementById(id);
    if (!el) return fallback !== undefined ? fallback : '';
    var raw = el.value;
    if (type === 'int')   return sanitizeInt(raw, undefined, undefined, fallback);
    if (type === 'float') return sanitizeFloat(raw, undefined, undefined, fallback);
    if (type === 'port')  return sanitizeInt(raw, 1, 65535, 9090);
    return sanitize(raw, type || 'display');
  }

  function setHtml(el, html) {
    if (typeof el === 'string') el = document.getElementById(el);
    if (!el) return;
    el.innerHTML = html;
  }

  function setText(el, text) {
    if (typeof el === 'string') el = document.getElementById(el);
    if (!el) return;
    el.textContent = String(text === null || text === undefined ? '' : text);
  }

  function getUrlParam(name, type, fallback) {
    var params = new URLSearchParams(window.location.search);
    var raw    = params.get(name);
    if (raw === null) return fallback !== undefined ? fallback : '';
    if (type === 'int')  return sanitizeInt(raw, undefined, undefined, fallback);
    if (type === 'port') return sanitizeInt(raw, 1, 65535, 9090);
    if (type === 'host') return sanitize(raw, 'host');
    return sanitize(raw, type || 'display');
  }

  global.CC = global.CC || {};
  global.CC.validate = {
    escHtml:          escHtml,
    sanitize:         sanitize,
    validate:         validate,
    sanitizeInt:      sanitizeInt,
    sanitizeFloat:    sanitizeFloat,
    safeJsonParse:    safeJsonParse,
    validateWsPayload:validateWsPayload,
    getInputVal:      getInputVal,
    setHtml:          setHtml,
    setText:          setText,
    getUrlParam:      getUrlParam,
  };

  global.escHtml = escHtml;
})(window);

// ── Navigation ────────────────────────────────────────────
(function() {
  var PAGES = [
    { href: '/spacefight/spacefight-admin.html', label: 'SF ADMIN', group: 'spacefight', color: 'accent' },
    { href: '/stats/stats.html',             label: 'STATISTIKEN',  group: 'spacefight' },
    { sep: true },
    { href: '/admin/tests/test-runner.html', label: 'TEST SUITE',   group: 'tools' },
    { href: '/admin/streamerbot.html',       label: 'C# ACTIONS',   group: 'tools', color: 'accent' },
    { sep: true },
    { href: '/alerts/chat.html',             label: 'HUD CHAT',     group: 'obs', obs: true },
    { href: '/spacefight/spacefight.html',   label: 'RAUMKAMPF',    group: 'obs', obs: true },
  ];

  var currentPage = window.location.pathname.replace(/^\/+/, '');
  if (currentPage === '' || currentPage === 'admin/' || currentPage === 'admin') currentPage = 'admin/index.html';

  var nav = document.createElement('nav');
  nav.className = 'cc-nav';

  var home = document.createElement('a');
  home.href = '/admin/';
  home.className = 'cc-nav-home';
  // RDOC dock ring, micro cut, rendered at 24 px by the CSS. The
  // micro cut exists precisely for 24-32 px and is never the
  // standard ring scaled down. Geometry is a verbatim copy of
  // RDOC-Brandkit digital/icon/rdoc_signet_micro_copper.svg with
  // fill switched to currentColor so the nav hover state applies.
  // Do not retype these coordinates - re-copy them from the kit.
  home.innerHTML =
    '<svg viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="RDOC">' +
      '<g transform="translate(-60 -60) scale(0.3125)">' +
        '<path fill="currentColor" d="M528.748,192.439 A320 320 0 0 1 779.563,336.473 L679.227,402.295 A200 200 0 0 0 522.467,312.274 Z M796.445,365.402 A320 320 0 0 1 805.202,640.19 L695.251,592.119 A200 200 0 0 0 689.778,420.376 Z M790.196,670.136 A320 320 0 0 1 667.139,791.878 L608.962,686.924 A200 200 0 0 0 685.872,610.835 Z M444.124,680 L579.876,680 L631.874,808.699 A320 320 0 0 1 586.703,823.158 L575.497,776.485 A272 272 0 0 0 589.252,772.799 L573.612,720 L450.388,720 L434.748,772.799 A272 272 0 0 0 448.503,776.485 L437.297,823.158 A320 320 0 0 1 392.126,808.699 Z M356.861,791.878 A320 320 0 0 1 233.804,670.136 L338.128,610.835 A200 200 0 0 0 415.038,686.924 Z M218.798,640.19 A320 320 0 0 1 227.555,365.402 L334.222,420.376 A200 200 0 0 0 328.749,592.119 Z M244.437,336.473 A320 320 0 0 1 495.252,192.439 L501.533,312.274 A200 200 0 0 0 344.773,402.295 Z"/>' +
      '</g>' +
    '</svg>' +
    'RDOC';
  if (currentPage === 'admin/index.html' || currentPage === 'admin/') home.classList.add('active');
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
    var hrefNorm = p.href.split('?')[0].replace(/^\//, '');
    var isCurrent = currentPage === hrefNorm;

    a.href = p.href;
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

  var body = document.body || document.getElementsByTagName('body')[0];
  if (body) body.insertBefore(nav, body.firstChild);
  else document.addEventListener('DOMContentLoaded', function() {
    document.body.insertBefore(nav, document.body.firstChild);
  });
})();

// ── Debug Console ─────────────────────────────────────────
(function() {
  var MAX_ENTRIES = 200;
  var entries     = [];
  var paused      = false;
  var filterText  = '';
  var consoleOpen = false;

  // Every colour below is an RDOC token from rdoc-brand.css, which
  // the page loads before this lib. Nothing here defines a hex.
  // send/recv/err are directions, i.e. states -> functional colour.
  // Patina is structure (labels, event names), Copper stays free
  // for the page's own single action.
  var style = document.createElement('style');
  style.textContent = [
    '.cc-dbg-bar{position:fixed;bottom:0;left:0;right:0;z-index:9999;font-family:var(--rdoc-font-mono);font-size:11px;}',
    '.cc-dbg-handle{background:var(--rdoc-bg);border-top:1px solid var(--rdoc-border);height:30px;display:flex;align-items:center;padding:0 12px;gap:10px;cursor:pointer;user-select:none;}',
    '.cc-dbg-handle:hover{background:var(--rdoc-surface);}',
    '.cc-dbg-label{color:var(--rdoc-accent-2);letter-spacing:0.07em;font-size:10px;text-transform:uppercase;}',
    '.cc-dbg-dot{width:6px;height:6px;border-radius:50%;background:var(--rdoc-border);flex-shrink:0;transition:background 0.2s;}',
    '.cc-dbg-dot.send{background:var(--rdoc-info);} .cc-dbg-dot.recv{background:var(--rdoc-success);} .cc-dbg-dot.err{background:var(--rdoc-error);}',
    '.cc-dbg-count{color:var(--rdoc-text-muted);font-size:10px;margin-left:auto;}',
    '.cc-dbg-btns{display:flex;gap:6px;margin-left:8px;}',
    '.cc-dbg-btn{background:transparent;border:1px solid var(--rdoc-border);color:var(--rdoc-text-muted);font-family:var(--rdoc-font-mono);font-size:10px;letter-spacing:0.07em;padding:2px 8px;cursor:pointer;transition:border-color 0.15s,color 0.15s;text-transform:uppercase;}',
    '.cc-dbg-btn:hover{border-color:var(--rdoc-accent-2);color:var(--rdoc-text);}',
    '.cc-dbg-btn.active{border-color:var(--rdoc-error);color:var(--rdoc-error);}',
    '.cc-dbg-btn:focus-visible{outline:2px solid var(--rdoc-focus);outline-offset:2px;}',
    '.cc-dbg-panel{background:var(--rdoc-bg);border-top:1px solid var(--rdoc-border);height:240px;display:none;flex-direction:column;}',
    '.cc-dbg-panel.open{display:flex;}',
    '.cc-dbg-toolbar{display:flex;align-items:center;gap:8px;padding:5px 10px;border-bottom:1px solid var(--rdoc-border);flex-shrink:0;}',
    '.cc-dbg-filter{background:var(--rdoc-surface);border:1px solid var(--rdoc-border);color:var(--rdoc-text);font-family:var(--rdoc-font-mono);font-size:11px;padding:3px 8px;width:180px;outline:none;}',
    '.cc-dbg-filter:focus{border-color:var(--rdoc-accent-2);}',
    '.cc-dbg-filter::placeholder{color:var(--rdoc-text-muted);}',
    '.cc-dbg-log{flex:1;overflow-y:auto;padding:4px 0;}',
    '.cc-dbg-log::-webkit-scrollbar{width:3px;} .cc-dbg-log::-webkit-scrollbar-track{background:var(--rdoc-bg);} .cc-dbg-log::-webkit-scrollbar-thumb{background:var(--rdoc-border);}',
    '.cc-dbg-entry{display:flex;align-items:baseline;gap:8px;padding:2px 10px;border-bottom:1px solid var(--rdoc-border);cursor:pointer;}',
    '.cc-dbg-entry:hover{background:var(--rdoc-surface);}',
    '.cc-dbg-entry.expanded .cc-dbg-body{white-space:pre;overflow-x:auto;}',
    '.cc-dbg-ts{color:var(--rdoc-text-muted);font-size:10px;flex-shrink:0;min-width:65px;}',
    '.cc-dbg-dir{font-size:10px;flex-shrink:0;min-width:14px;}',
    '.cc-dbg-dir.send{color:var(--rdoc-info);} .cc-dbg-dir.recv{color:var(--rdoc-success);} .cc-dbg-dir.err{color:var(--rdoc-error);} .cc-dbg-dir.info{color:var(--rdoc-text-muted);}',
    '.cc-dbg-evt{color:var(--rdoc-accent-2);flex-shrink:0;min-width:120px;}',
    '.cc-dbg-body{color:var(--rdoc-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;}',
    '.cc-dbg-body.send-color{color:var(--rdoc-info);} .cc-dbg-body.recv-color{color:var(--rdoc-success);} .cc-dbg-body.err-color{color:var(--rdoc-error);}',
    '.cc-dbg-hint{color:var(--rdoc-text-muted);font-size:10px;margin-left:auto;}',
  ].join('');
  document.head.appendChild(style);

  var bar = document.createElement('div');
  bar.className = 'cc-dbg-bar';

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

  var panel = document.createElement('div');
  panel.className = 'cc-dbg-panel';
  panel.id = 'cc-dbg-panel';
  panel.innerHTML =
    '<div class="cc-dbg-toolbar">' +
      '<input class="cc-dbg-filter" id="cc-dbg-filter" placeholder="Filter (event, cmd, user...)" type="text">' +
      '<span class="cc-dbg-hint">Klick auf Zeile = Details</span>' +
    '</div>' +
    '<div class="cc-dbg-log" id="cc-dbg-log"></div>';
  bar.appendChild(panel);

  document.body.appendChild(bar);

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

  function addEntry(dir, data) {
    if (paused) return;
    var now = new Date();
    var ts  = pad2(now.getHours()) + ':' + pad2(now.getMinutes()) + ':' + pad2(now.getSeconds()) +
              '.' + String(now.getMilliseconds()).padStart(3,'0').slice(0,2);
    var parsed = null, evtName = '', bodyStr = '';
    if (typeof data === 'string') { try { parsed = JSON.parse(data); } catch(e) { bodyStr = data; } }
    else if (typeof data === 'object') { parsed = data; }
    if (parsed) { evtName = parsed.event || parsed.cmd || parsed.type || parsed.request || ''; bodyStr = JSON.stringify(parsed); }
    var entry = { dir:dir, ts:ts, evt:evtName, body:bodyStr, raw:data };
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) entries.shift();
    var dot = document.getElementById('cc-dbg-dot');
    if (dot) { dot.className = 'cc-dbg-dot ' + dir; setTimeout(function(){ dot.className = 'cc-dbg-dot'; }, 300); }
    var countEl = document.getElementById('cc-dbg-count');
    if (countEl) countEl.textContent = entries.length + ' Events';
    if (consoleOpen) renderEntry(entry, true);
  }

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
        (entry.dir==='send'?'→':entry.dir==='recv'?'←':entry.dir==='err'?'✕':'·') +
      '</span>' +
      '<span class="cc-dbg-evt">' + esc(entry.evt||'–') + '</span>' +
      '<span class="cc-dbg-body ' + entry.dir + '-color">' + esc(entry.body) + '</span>';
    row.addEventListener('click', function() {
      this.classList.toggle('expanded');
      var b = this.querySelector('.cc-dbg-body');
      if (this.classList.contains('expanded')) {
        try { b.textContent = JSON.stringify(JSON.parse(entry.body), null, 2); } catch(e) { b.textContent = entry.body; }
        b.style.whiteSpace = 'pre'; b.style.overflow = 'auto'; b.style.maxHeight = '120px'; b.style.display = 'block';
      } else {
        b.textContent = entry.body; b.style.whiteSpace = 'nowrap'; b.style.overflow = 'hidden'; b.style.maxHeight = ''; b.style.display = '';
      }
    });
    if (append) { log.appendChild(row); log.scrollTop = log.scrollHeight; }
    else { log.insertBefore(row, log.firstChild); }
  }

  function renderAll() {
    var log = document.getElementById('cc-dbg-log');
    if (!log) return;
    log.innerHTML = '';
    entries.forEach(function(e) { renderEntry(e, true); });
  }

  var OrigWS = window.WebSocket;
  window.WebSocket = function(url, protocols) {
    var ws = protocols ? new OrigWS(url, protocols) : new OrigWS(url);
    addEntry('info', { event: 'ws:connect', url: url });
    var origSend = ws.send.bind(ws);
    ws.send = function(data) { addEntry('send', data); return origSend(data); };
    ws.addEventListener('message', function(e) { addEntry('recv', e.data); });
    ws.addEventListener('close', function(e) { addEntry('info', { event:'ws:close', code:e.code, url:url }); });
    ws.addEventListener('error', function() { addEntry('err', { event:'ws:error', url:url }); });
    return ws;
  };
  window.WebSocket.prototype = OrigWS.prototype;
  window.WebSocket.CONNECTING = OrigWS.CONNECTING;
  window.WebSocket.OPEN       = OrigWS.OPEN;
  window.WebSocket.CLOSING    = OrigWS.CLOSING;
  window.WebSocket.CLOSED     = OrigWS.CLOSED;

  var origFetch = window.fetch;
  window.fetch = function(url, opts) {
    var method  = (opts && opts.method) || 'GET';
    var shortUrl = String(url).replace(window.location.origin, '');
    addEntry('send', { event:'http:'+method, url:shortUrl });
    return origFetch.apply(this, arguments).then(function(res) {
      var status = res.status;
      var clone  = res.clone();
      clone.text().then(function(body) {
        try { addEntry('recv', JSON.parse(body)); }
        catch(e) { addEntry('recv', { event:'http:response', status:status, url:shortUrl }); }
      });
      return res;
    }).catch(function(err) {
      addEntry('err', { event:'http:error', url:shortUrl, msg:err.message });
      throw err;
    });
  };

  document.addEventListener('click', function(e) {
    var el = e.target, maxDepth = 5;
    while (el && maxDepth-- > 0) {
      if (el.tagName==='BUTTON'||el.tagName==='A'||(el.getAttribute&&el.getAttribute('onclick'))) break;
      el = el.parentElement;
    }
    if (!el || maxDepth < 0) return;
    if (el.closest && el.closest('.cc-dbg-bar')) return;
    var info = { event:'ui:click' };
    if (el.id) info.id = el.id;
    var text = (el.textContent||'').trim().replace(/\s+/g,' ');
    if (text.length > 60) text = text.slice(0,57)+'...';
    if (text) info.label = text;
    var onclickAttr = el.getAttribute('onclick');
    if (onclickAttr) info.action = onclickAttr.replace(/\s+/g,' ').slice(0,120);
    if (el.tagName==='A'&&el.href) info.href = el.href.replace(window.location.origin,'');
    addEntry('info', info);
  }, true);

  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  function esc(s)  { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  window.ccDebug = { log: addEntry };
})();
