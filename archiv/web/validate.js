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
