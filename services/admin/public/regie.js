// Regie: Wunschliste, laufender Titel, Songwuensche an/aus, Verbindungen.
// Spricht mit dem Alerts-Service (/alerts/api/regie/*), jede Anfrage traegt
// das Admin-Token. Relativer Pfad, damit es hinter Caddy unter jedem Host geht.
(function () {
  'use strict';

  var API = '../alerts/api/regie/';
  var TOKEN_KEY = 'rdoc_admin_token';
  var POLL_MS = 4000;

  var $ = function (id) { return document.getElementById(id); };
  var token = '';
  try { token = localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { /* kein Speicher */ }
  var state = null;
  var fetchedAt = 0;

  function badge(el, on, text) {
    el.className = 'badge ' + (on ? 'on' : 'off');
    el.textContent = text;
  }

  function clock(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    var m = Math.floor(s / 60);
    return m + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
  }

  function cell(tr, text, cls) {
    var td = document.createElement('td');
    if (cls) td.className = cls;
    td.textContent = text;
    tr.appendChild(td);
    return td;
  }

  function button(label, cls, onClick) {
    var b = document.createElement('button');
    b.className = 'btn btn-sm ' + cls;
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  function call(path, body) {
    if (!token) return Promise.reject(new Error('kein Token'));
    return fetch(API + path, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'content-type': 'application/json', 'x-admin-token': token } : { 'x-admin-token': token },
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (res) {
      if (res.status === 401) throw new Error('Token falsch');
      // 409: der Eintrag stand nicht mehr an der Stelle — der frische Stand kommt trotzdem mit.
      if (!res.ok && res.status !== 409) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  function apply(next) {
    state = next;
    fetchedAt = Date.now();
    badge($('link'), true, 'REGIE: VERBUNDEN');
    render();
  }

  function fail(err) {
    badge($('link'), false, 'REGIE: ' + (token ? String(err.message).toUpperCase() : 'TOKEN FEHLT'));
    $('sr-toggle').disabled = true;
  }

  function refresh() {
    call('state').then(apply, fail);
  }

  function act(path, body) {
    call(path, body).then(apply, fail);
  }

  // Fortschritt des laufenden Titels, zwischen zwei Abfragen weitergerechnet.
  function progressNow() {
    var n = state && state.now;
    if (!n) return 0;
    return Math.min(n.durationMs, n.progressMs + (n.playing ? Date.now() - fetchedAt : 0));
  }

  function renderNow() {
    var n = state.now;
    if (!n) {
      $('now-title').textContent = '–';
      $('now-sub').textContent = state.playerError || (state.spotify.connected ? 'Spotify spielt gerade nichts ab.' : 'Spotify ist nicht verbunden.');
      $('now-bar').style.width = '0%';
      return;
    }
    var p = progressNow();
    var who = state.wishes.active ? 'Wunsch von ' + state.wishes.active.user : 'kein Wunsch';
    $('now-title').textContent = n.title + (n.artists ? ' – ' + n.artists : '');
    $('now-sub').textContent = (n.playing ? 'SPIELT' : 'PAUSIERT') + ' · ' + clock(p) + ' / ' + clock(n.durationMs) + ' · ' + who;
    $('now-bar').style.width = (n.durationMs ? (p / n.durationMs) * 100 : 0).toFixed(1) + '%';
  }

  function renderWishes() {
    var body = $('wishes');
    var list = state.wishes.pending;
    body.textContent = '';
    $('wish-count').textContent = String(list.length);
    $('wish-empty').classList.toggle('regie-hidden', list.length > 0);
    var wait = state.now ? Math.max(0, state.now.durationMs - progressNow()) : 0;
    list.forEach(function (w, i) {
      var tr = document.createElement('tr');
      cell(tr, String(i + 1), 'num');
      cell(tr, w.title + (w.artists ? ' – ' + w.artists : ''));
      cell(tr, w.user);
      cell(tr, state.now && state.now.playing ? clock(wait) : '–', 'num');
      var ops = cell(tr, '', 'ops');
      if (i > 0) ops.appendChild(button('NACH VORN', 'btn-struct', function () { act('wishes/front', { index: i, uri: w.uri }); }));
      ops.appendChild(button('STREICHEN', 'btn-danger', function () { act('wishes/remove', { index: i, uri: w.uri }); }));
      body.appendChild(tr);
      wait += w.durationMs;
    });
  }

  function renderHistory() {
    var body = $('history');
    var list = state.songs.history || [];
    body.textContent = '';
    $('history-empty').classList.toggle('regie-hidden', list.length > 0);
    list.forEach(function (h) {
      var tr = document.createElement('tr');
      var at = new Date(h.at);
      cell(tr, isNaN(at) ? '–' : at.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }), 'num');
      cell(tr, h.title + (h.artists ? ' – ' + h.artists : ''));
      cell(tr, h.user);
      body.appendChild(tr);
    });
  }

  function renderSide() {
    var sp = state.spotify;
    badge($('spotify-state'), sp.connected && !sp.needsReconnect,
      'SPOTIFY: ' + (!sp.configured ? 'NICHT EINGERICHTET' : !sp.connected ? 'GETRENNT' : sp.needsReconnect ? 'NEU VERBINDEN' : 'VERBUNDEN'));
    var tw = state.twitch;
    badge($('twitch-state'), tw.eventsub === 'verbunden', 'TWITCH: ' + String(tw.eventsub || '–').toUpperCase());
    $('spotify-connect').href = '/auth/spotify/login?key=' + encodeURIComponent(token);
    $('twitch-connect').href = '/alerts/auth/login?key=' + encodeURIComponent(token);

    var pl = state.songs.playlist;
    $('playlist-name').textContent = pl ? pl.name : 'Noch keine Playlist in diesem Stream.';
    $('playlist-link').classList.toggle('regie-hidden', !(pl && pl.url));
    if (pl && pl.url) $('playlist-link').href = pl.url;

    var l = state.songs.limits;
    $('rules').textContent = l.limit + ' Wünsche je Zuschauer in ' + Math.round(l.windowMs / 1000) + ' s · explizite Songs '
      + (l.allowExplicit ? 'erlaubt' : 'gesperrt');
  }

  function render() {
    var on = state.songs.enabled;
    badge($('sr-state'), on, 'WÜNSCHE: ' + (on ? 'AN' : 'AUS'));
    $('sr-toggle').disabled = false;
    $('sr-toggle').textContent = on ? 'WÜNSCHE AUSSCHALTEN' : 'WÜNSCHE EINSCHALTEN';
    renderNow();
    renderWishes();
    renderHistory();
    renderSide();
  }

  $('sr-toggle').addEventListener('click', function () {
    if (state) act('songs/enabled', { enabled: !state.songs.enabled });
  });

  $('token').value = token;
  $('token-save').addEventListener('click', function () {
    token = $('token').value.trim();
    try { localStorage.setItem(TOKEN_KEY, token); } catch (e) { /* kein Speicher */ }
    refresh();
  });
  $('token-clear').addEventListener('click', function () {
    token = '';
    $('token').value = '';
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* kein Speicher */ }
    fail(new Error('kein Token'));
  });

  refresh();
  setInterval(refresh, POLL_MS);
  // Uhr und Balken laufen zwischen den Abfragen weiter.
  setInterval(function () { if (state) { renderNow(); } }, 1000);
})();
