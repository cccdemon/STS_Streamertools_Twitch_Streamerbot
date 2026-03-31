/**
 * Chaos Crew – Giveaway System v4
 * Copyright (C) 2026 justcallmedeimos / Chaos Crew
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

// ── validate.js ──────────────────────────────────────────────────
// ════════════════════════════════════════════════════════
// CHAOS CREW – Input Validation & Sanitization
// validate.js – Zentrale Sicherheitsschicht
//
// Schutzziele:
//  1. XSS       – innerHTML wird nur mit sanitizierten Strings befüllt
//  2. Injection – alle User-Inputs werden typisiert und begrenzt
//  3. Prototype  – JSON.parse outputs werden gegen Prototype Pollution geprüft
//  4. WS-Injektion – ausgehende WS-Payloads werden validiert
// ════════════════════════════════════════════════════════

(function(global) {
  'use strict';

  // ── 1. HTML Escape ────────────────────────────────────────
  // Einzige erlaubte Methode um Strings in innerHTML einzufügen
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

  // ── 2. String Sanitizer ───────────────────────────────────
  var STR_RULES = {
    // Twitch Username: 4-25 Zeichen, alphanumerisch + Unterstrich
    username: {
      maxLen:  25,
      pattern: /^[a-zA-Z0-9_]{1,25}$/,
      clean:   function(s) { return s.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 25); }
    },
    // Giveaway Keyword: 1-50 Zeichen, kein HTML/Script
    keyword: {
      maxLen:  50,
      pattern: /^[^\x00-\x1F<>"'`\\]{1,50}$/,
      clean:   function(s) { return s.replace(/[\x00-\x1F<>"'`\\]/g, '').slice(0, 50); }
    },
    // Display Name: 1-50 Zeichen
    display: {
      maxLen:  50,
      pattern: /^[^\x00-\x1F<>]{1,50}$/,
      clean:   function(s) { return s.replace(/[\x00-\x1F<>]/g, '').slice(0, 50); }
    },
    // WS Event Name: nur bekannte Events
    wsEvent: {
      maxLen:  40,
      pattern: /^[a-z_:]{1,40}$/,
      clean:   function(s) { return s.replace(/[^a-z_:]/g, '').slice(0, 40); }
    },
    // Hostname/IP für WS-Verbindung
    host: {
      maxLen:  253,
      pattern: /^[a-zA-Z0-9.\-]{1,253}$/,
      clean:   function(s) { return s.replace(/[^a-zA-Z0-9.\-]/g, '').slice(0, 253); }
    },
    // Port
    port: {
      maxLen:  5,
      pattern: /^\d{1,5}$/,
      clean:   function(s) {
        var n = parseInt(s.replace(/\D/g, ''));
        if (isNaN(n) || n < 1 || n > 65535) return '9090';
        return String(n);
      }
    }
  };

  function sanitize(value, type) {
    if (value === null || value === undefined) return '';
    var s   = String(value).trim();
    var rule = STR_RULES[type];
    if (!rule) return s.slice(0, 200); // Fallback
    return rule.clean(s);
  }

  function validate(value, type) {
    if (value === null || value === undefined) return false;
    var s    = String(value).trim();
    var rule  = STR_RULES[type];
    if (!rule) return s.length > 0 && s.length <= 200;
    if (s.length === 0 || s.length > rule.maxLen) return false;
    return rule.pattern.test(s);
  }

  // ── 3. Number Sanitizer ───────────────────────────────────
  function sanitizeInt(value, min, max, fallback) {
    var n = parseInt(value, 10);
    if (isNaN(n)) return fallback !== undefined ? fallback : 0;
    if (min !== undefined && n < min) return min;
    if (max !== undefined && n > max) return max;
    return n;
  }

  function sanitizeFloat(value, min, max, fallback) {
    // InvariantCulture: Punkt als Dezimalzeichen erzwingen
    var s = String(value).replace(/,/g, '.');
    var n = parseFloat(s);
    if (isNaN(n)) return fallback !== undefined ? fallback : 0;
    if (min !== undefined && n < min) return min;
    if (max !== undefined && n > max) return max;
    return n;
  }

  // ── 4. JSON-Safe Parser (Anti-Prototype-Pollution) ────────
  var FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'];

  function safeJsonParse(str) {
    if (typeof str !== 'string') return null;
    var parsed;
    try { parsed = JSON.parse(str); }
    catch(e) { return null; }
    return deepFreeze(sanitizeObject(parsed, 0));
  }

  function sanitizeObject(obj, depth) {
    if (depth > 10) return null; // Max-Tiefe
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) {
      return obj.slice(0, 1000).map(function(item) {
        return sanitizeObject(item, depth + 1);
      });
    }
    var clean = Object.create(null); // Kein Prototype!
    Object.keys(obj).forEach(function(key) {
      if (FORBIDDEN_KEYS.indexOf(key) !== -1) return; // Skip
      if (key.length > 200) return; // Key zu lang
      clean[key] = sanitizeObject(obj[key], depth + 1);
    });
    return clean;
  }

  function deepFreeze(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    Object.getOwnPropertyNames(obj).forEach(function(name) {
      deepFreeze(obj[name]);
    });
    return Object.freeze(obj);
  }

  // ── 5. WS-Payload Validator ───────────────────────────────
  // Whitelist erlaubter ausgehender Events
  var ALLOWED_EVENTS = [
    'gw_get_all', 'gw_cmd', 'gw_overlay', 'gw_join',
    'gw_overlay_register', 'gw_join_register', 'gw_api_register',
    'gw_spacefight_register', 'spacefight_result', 'chat_msg',
    'ws:connect', 'ws:close', 'http:GET', 'http:POST'
  ];

  var ALLOWED_CMDS = [
    'gw_open', 'gw_close', 'gw_reset',
    'gw_add_ticket', 'gw_sub_ticket',
    'gw_ban', 'gw_unban',
    'gw_set_keyword', 'gw_get_keyword'
  ];

  function validateWsPayload(obj) {
    if (!obj || typeof obj !== 'object') return false;
    var evt = obj.event;
    if (!evt || typeof evt !== 'string') return false;
    if (ALLOWED_EVENTS.indexOf(evt) === -1) {
      console.warn('[validate] Unbekanntes WS Event blockiert:', evt);
      return false;
    }
    if (evt === 'gw_cmd') {
      if (!obj.cmd || ALLOWED_CMDS.indexOf(obj.cmd) === -1) {
        console.warn('[validate] Unbekanntes gw_cmd blockiert:', obj.cmd);
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

  // ── 6. Input-Felder absichern (DOM) ──────────────────────
  // Liest einen Input-Wert und sanitiert ihn direkt
  function getInputVal(id, type, fallback) {
    var el = document.getElementById(id);
    if (!el) return fallback !== undefined ? fallback : '';
    var raw = el.value;
    if (type === 'int')   return sanitizeInt(raw, undefined, undefined, fallback);
    if (type === 'float') return sanitizeFloat(raw, undefined, undefined, fallback);
    if (type === 'port')  return sanitizeInt(raw, 1, 65535, 9090);
    return sanitize(raw, type || 'display');
  }

  // ── 7. Safe innerHTML Setter ──────────────────────────────
  // Verhindert direktes innerHTML-Setzen mit nicht-escapetem Content
  function setHtml(el, html) {
    // html muss bereits escapeHtml()-verarbeitet sein
    // Diese Funktion ist ein kontrollierter Choke-Point
    if (typeof el === 'string') el = document.getElementById(el);
    if (!el) return;
    el.innerHTML = html;
  }

  // textContent-Wrapper für reine Texte (kein HTML nötig)
  function setText(el, text) {
    if (typeof el === 'string') el = document.getElementById(el);
    if (!el) return;
    el.textContent = String(text === null || text === undefined ? '' : text);
  }

  // ── 8. URL Parameter Sanitizer ────────────────────────────
  function getUrlParam(name, type, fallback) {
    var params = new URLSearchParams(window.location.search);
    var raw    = params.get(name);
    if (raw === null) return fallback !== undefined ? fallback : '';
    if (type === 'int')  return sanitizeInt(raw, undefined, undefined, fallback);
    if (type === 'port') return sanitizeInt(raw, 1, 65535, 9090);
    if (type === 'host') return sanitize(raw, 'host');
    return sanitize(raw, type || 'display');
  }

  // ── Export ────────────────────────────────────────────────
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

  // Rückwärtskompatibilität: escHtml global verfügbar
  // (wird von bestehenden Skripten genutzt)
  global.escHtml = escHtml;

})(window);

// ── nav.js ──────────────────────────────────────────────────
// ════════════════════════════════════════════════════════
// CHAOS CREW – Shared Navigation
// nav.js – einbinden in alle Admin-Seiten
// ════════════════════════════════════════════════════════

(function() {
  var PAGES = [
    { href: 'giveaway/giveaway-admin.html',  label: 'ADMIN PANEL',   group: 'giveaway' },
    { href: 'giveaway/stats.html',           label: 'STATISTIKEN',   group: 'giveaway' },
    { href: 'giveaway/giveaway-test.html',   label: 'TEST CONSOLE',  group: 'tools' },
    { href: 'tests/test-runner.html', label: 'TEST SUITE',  group: 'tools' },
    { sep: true },
    { href: 'streamerbot.html',     label: 'C# ACTIONS',    group: 'tools', color: 'gold' },
    { sep: true },
    { href: 'games/spacefight-admin.html', label: 'SF ADMIN', group: 'tools', color: 'gold' },
    { sep: true },
    { href: 'giveaway/giveaway-overlay.html', label: 'GW OVERLAY',   group: 'obs', obs: true },
    { href: 'giveaway/giveaway-join.html',   label: 'JOIN ANIM',     group: 'obs', obs: true },
    { href: 'chat.html',            label: 'HUD CHAT',      group: 'obs', obs: true },
    { href: 'games/spacefight.html',      label: 'RAUMKAMPF',     group: 'obs', obs: true },
  ];

  var base = window._navBase || '';
  var currentPage = window.location.pathname.replace(/^\/+/, '');
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

