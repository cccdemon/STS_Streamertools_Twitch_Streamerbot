(function() {
  'use strict';

  var resultsEl = document.getElementById('test-results');
  var summaryEl = document.getElementById('summary');
  var tests = [];

  function it(name, fn) {
    tests.push({ name: name, fn: fn });
  }

  function expect(actual) {
    return {
      toBe: function(expected) {
        if (actual !== expected) throw new Error('Expected ' + JSON.stringify(actual) + ' to be ' + JSON.stringify(expected));
      },
      toBeNull: function() {
        if (actual !== null) throw new Error('Expected null, got ' + JSON.stringify(actual));
      },
      toBeUndefined: function() {
        if (actual !== undefined) throw new Error('Expected undefined, got ' + JSON.stringify(actual));
      },
      toContain: function(expected) {
        if (!String(actual).includes(expected)) throw new Error('Expected ' + JSON.stringify(actual) + ' to contain ' + JSON.stringify(expected));
      },
      toBeTruthy: function() {
        if (!actual) throw new Error('Expected value to be truthy, got ' + JSON.stringify(actual));
      },
      toBeFalsy: function() {
        if (actual) throw new Error('Expected value to be falsy, got ' + JSON.stringify(actual));
      }
    };
  }

  function addResult(name, passed, message) {
    var item = document.createElement('div');
    item.className = 'test-case ' + (passed ? 'pass' : 'fail');
    item.innerHTML =
      '<div class="test-header"><span class="test-name">' + escHtml(name) + '</span>' +
      '<span class="test-status">' + (passed ? 'PASS' : 'FAIL') + '</span></div>' +
      '<div class="test-body">' + escHtml(message || '') + '</div>';
    resultsEl.appendChild(item);
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  }

  function runTests() {
    var passed = 0;
    var failed = 0;
    resultsEl.innerHTML = '';

    tests.forEach(function(test) {
      try {
        test.fn();
        addResult(test.name, true, '');
        passed += 1;
      } catch (err) {
        addResult(test.name, false, err.message || String(err));
        failed += 1;
      }
    });

    summaryEl.textContent = passed + ' passed, ' + failed + ' failed';
    summaryEl.className = 'summary ' + (failed === 0 ? 'pass' : 'fail');
  }

  function updateQuery(search) {
    history.replaceState(null, '', window.location.pathname + search);
  }

  function withMutedConsole(fn) {
    var originalWarn = console.warn;
    console.warn = function() {};
    try { fn(); }
    finally { console.warn = originalWarn; }
  }

  it('escHtml escapes HTML special chars', function() {
    expect(CC.validate.escHtml('<b>Test & "OK"</b>')).toBe('&lt;b&gt;Test &amp; &quot;OK&quot;&#x2F;&lt;/b&gt;');
  });

  it('sanitize cleans usernames and truncates invalid characters', function() {
    expect(CC.validate.sanitize('bad$user!name', 'username')).toBe('badusername');
    expect(CC.validate.sanitize('abcdefghijklmnopqrstuvwxYz123456', 'username').length).toBe(25);
  });

  it('validate enforces rules for keywords and usernames', function() {
    expect(CC.validate.validate('good_keyword', 'keyword')).toBeTruthy();
    expect(CC.validate.validate('<script>', 'keyword')).toBeFalsy();
    expect(CC.validate.validate('user_name1', 'username')).toBeTruthy();
    expect(CC.validate.validate('bad user', 'username')).toBeFalsy();
  });

  it('sanitizeInt clamps to range and respects fallback', function() {
    expect(CC.validate.sanitizeInt('123', 1, 50, 7)).toBe(50);
    expect(CC.validate.sanitizeInt('abc', 1, 10, 5)).toBe(5);
  });

  it('sanitizeFloat parses comma decimals and clamps bounds', function() {
    expect(CC.validate.sanitizeFloat('1,5', 0, 2, 0)).toBe(1.5);
    expect(CC.validate.sanitizeFloat('9.9', 0, 5, 0)).toBe(5);
  });

  it('safeJsonParse returns null for invalid JSON and strips forbidden prototype keys', function() {
    expect(CC.validate.safeJsonParse('{invalid:json}')).toBeNull();
    var obj = CC.validate.safeJsonParse('{"a":1,"__proto__":{"polluted":true}}');
    expect(obj.__proto__).toBeUndefined();
    expect(Object.isFrozen(obj)).toBeTruthy();
  });

  it('validateWsPayload allows safe commands but blocks unknown event names', function() {
    expect(CC.validate.validateWsPayload({ event: 'sf_cmd', cmd: 'sf_start', user: 'valid_user' })).toBeTruthy();
    withMutedConsole(function() {
      expect(CC.validate.validateWsPayload({ event: 'sf_cmd', cmd: 'unknown_cmd' })).toBeFalsy();
      expect(CC.validate.validateWsPayload({ event: 'bad_event' })).toBeFalsy();
    });
  });

  it('getUrlParam returns sanitized params from the current URL', function() {
    updateQuery('?x=123&host=example.com');
    expect(CC.validate.getUrlParam('x', 'int')).toBe(123);
    expect(CC.validate.getUrlParam('host', 'host')).toBe('example.com');
    updateQuery('');
  });

  it('navigation is injected and marks nested test pages active', function() {
    var nav = document.querySelector('nav.cc-nav');
    expect(!!nav).toBeTruthy();
    var active = nav.querySelector('.cc-nav-item.active');
    expect(!!active).toBeTruthy();
    expect(active.href).toContain('tests/test-runner.html');
  });

  // ════════════════════════════════════════════════════════
  // Spacefight (spacefight.js) – reine Hilfsfunktion
  // ════════════════════════════════════════════════════════
  it('shipSlug normalizes a ship class to its sprite-sheet slug', function() {
    expect(shipSlug('ORIGIN 300I')).toBe('origin-300i');
    expect(shipSlug('Drake Cutlass Black')).toBe('drake-cutlass-black');
    expect(shipSlug('  --F7C-- ')).toBe('f7c');
  });

  runTests();
})();
