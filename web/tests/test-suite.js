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

  function resetSpacefightState() {
    queue = [];
    pendingChallenges = {};
    recentFights = {};
    chatActive = {};
    streamLive = false;
    TEST_MODE = false;
    FORCE_LIVE = false;
    ws = null;
  }

  function withStubbedTimeout(fn) {
    var originalSetTimeout = window.setTimeout;
    window.setTimeout = function() { return 1; };
    try { fn(); }
    finally { window.setTimeout = originalSetTimeout; }
  }

  function withMutedConsole(fn) {
    var originalWarn = console.warn;
    console.warn = function() {};
    try { fn(); }
    finally { console.warn = originalWarn; }
  }

  function createInput(id, value) {
    var el = document.createElement('input');
    el.id = id;
    el.value = value;
    document.body.appendChild(el);
    return el;
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
    expect(CC.validate.validateWsPayload({ event: 'gw_cmd', cmd: 'gw_open', user: 'valid_user' })).toBeTruthy();
    withMutedConsole(function() {
      expect(CC.validate.validateWsPayload({ event: 'gw_cmd', cmd: 'unknown_cmd' })).toBeFalsy();
      expect(CC.validate.validateWsPayload({ event: 'bad_event' })).toBeFalsy();
    });
  });

  it('parseDec handles decimal inputs and invalid values correctly', function() {
    expect(parseDec('1,5')).toBe(1.5);
    expect(parseDec('3.0000')).toBe(3);
    expect(parseDec('abc')).toBe(0);
    expect(parseDec(null)).toBe(0);
  });

  it('handle processes gw_data payload and builds participant state', function() {
    var originalUpdateGwStatus = window.updateGwStatus;
    var originalRenderTable = window.renderTable;
    var originalUpdateStats = window.updateStats;
    var originalBroadcastOverlay = window.broadcastOverlay;
    window.updateGwStatus = function() {};
    window.renderTable = function() {};
    window.updateStats = function() {};
    window.broadcastOverlay = function() {};

    participants = {};
    gwIsOpen = false;
    handle({
      event: 'gw_data',
      open: true,
      participants: [{
        key: 'Alpha',
        display: 'Alpha',
        watchSec: '10',
        msgs: '5',
        tickets: '1,5',
        banned: false
      }]
    });

    expect(gwIsOpen).toBeTruthy();
    expect(participants.alpha.tickets).toBe(1.5);
    expect(participants.alpha.watchSec).toBe(10);
    expect(participants.alpha.banned).toBe(false);

    window.updateGwStatus = originalUpdateGwStatus;
    window.renderTable = originalRenderTable;
    window.updateStats = originalUpdateStats;
    window.broadcastOverlay = originalBroadcastOverlay;
  });

  it('manualAdd sends sanitized WS payloads without modifying live data', function() {
    var nameInput = createInput('m-name', 'Bad$User');
    var amountInput = createInput('m-amount', '2');

    var originalRequestData = window.requestData;
    window.requestData = function() {};

    var sent = [];
    ws = { readyState: 1, send: function(msg) { sent.push(JSON.parse(msg)); } };

    try {
      manualAdd();
      expect(sent.length).toBe(2);
      expect(sent[0].event).toBe('gw_cmd');
      expect(sent[0].user).toBe('BadUser');
    } finally {
      window.requestData = originalRequestData;
      ws = null;
      document.body.removeChild(nameInput);
      document.body.removeChild(amountInput);
    }
  });

  it('isInChat returns active chat users and expires stale entries', function() {
    resetSpacefightState();
    streamLive = false;
    TEST_MODE = false;
    FORCE_LIVE = false;

    chatActive.defender = Date.now();
    expect(isInChat('Defender')).toBeTruthy();

    chatActive.defender = Date.now() - (CHAT_ACTIVE_MS + 1000);
    expect(isInChat('Defender')).toBeFalsy();
  });

  it('parseCommand rejects fights when stream is offline and sends rejection', function() {
    resetSpacefightState();
    streamLive = false;
    TEST_MODE = false;
    FORCE_LIVE = false;

    var sent = [];
    ws = { readyState: 1, send: function(msg) { sent.push(JSON.parse(msg)); } };

    withStubbedTimeout(function() {
      parseCommand('Attacker', '!fight @Defender');
    });

    expect(Object.keys(pendingChallenges).length).toBe(0);
    expect(queue.length).toBe(0);
    expect(sent.length).toBe(1);
    expect(sent[0].event).toBe('spacefight_rejected');
    expect(sent[0].reason).toBe('stream_offline');
  });

  it('parseCommand creates a challenge when defender is active and stream is live', function() {
    resetSpacefightState();
    streamLive = true;
    TEST_MODE = false;
    FORCE_LIVE = false;
    chatActive.defender = Date.now();

    var sent = [];
    ws = { readyState: 1, send: function(msg) { sent.push(JSON.parse(msg)); } };

    withStubbedTimeout(function() {
      parseCommand('Attacker', '!fight @Defender');
    });

    expect(Object.keys(pendingChallenges).length).toBe(1);
    expect(pendingChallenges.defender.attacker).toBe('Attacker');
    expect(sent[0].event).toBe('spacefight_challenge');
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

  runTests();
})();
