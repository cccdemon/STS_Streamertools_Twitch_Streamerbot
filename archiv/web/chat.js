// ════════════════════════════════════════════════════════
// CHAOS CREW – HUD Chat JS
// ════════════════════════════════════════════════════════

var CONFIG = {
  channel:   getParam('channel') || 'DEIN_KANAL',
  maxMsgs:   10,
  fadeAfter: 0
};

function getParam(key) {
  return new URLSearchParams(window.location.search).get(key);
}

var HUD_COLORS = [
  '#00d4ff','#00e5ff','#29b6f6','#4dd0e1',
  '#f0a500','#ffb300','#ffc107','#e6ac00',
  '#80deea','#a0e8ff','#00bcd4','#26c6da'
];

function userColor(name, twitchColor) {
  if (twitchColor && twitchColor !== '#000000') return twitchColor;
  var hash = 0;
  for (var i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) & 0xffff;
  return HUD_COLORS[hash % HUD_COLORS.length];
}

function parseBadges(badgeStr) {
  if (!badgeStr) return [];
  return badgeStr.split(',').map(function(b) {
    var key = b.split('/')[0];
    if (key === 'broadcaster') return { cls:'broadcaster', label:'CMD' };
    if (key === 'moderator')   return { cls:'moderator',   label:'MOD' };
    if (key === 'subscriber')  return { cls:'subscriber',  label:'SUB' };
    if (key === 'vip')         return { cls:'vip',         label:'VIP' };
    return null;
  }).filter(Boolean);
}

function parseEmotes(text, emoteStr) {
  if (!emoteStr) return escHtml(text);

  var replacements = [];
  emoteStr.split('/').forEach(function(entry) {
    var parts = entry.split(':');
    var id    = parts[0];
    if (!parts[1]) return;
    parts[1].split(',').forEach(function(pos) {
      var se = pos.split('-').map(Number);
      replacements.push({ s:se[0], e:se[1], id:id });
    });
  });

  replacements.sort(function(a,b){ return a.s - b.s; });

  var result = '';
  var cursor = 0;

  replacements.forEach(function(r) {
    if (r.s > cursor) result += escHtml(text.slice(cursor, r.s));
    var url  = 'https://static-cdn.jtvnw.net/emoticons/v2/' + r.id + '/default/dark/1.0';
    var name = escHtml(text.slice(r.s, r.e + 1));
    result += '<img class="emote" src="' + url + '" alt="' + name + '">';
    cursor = r.e + 1;
  });

  if (cursor < text.length) result += escHtml(text.slice(cursor));
  return result;
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

var container = document.getElementById('chat-container');
var statusEl  = document.getElementById('status');

function addMessage(opts) {
  var el = document.createElement('div');
  el.className = 'msg' + (opts.highlight ? ' highlight' : '');
  el.style.setProperty('--user-color', opts.color);

  var badgeHtml = opts.badges.map(function(b) {
    return '<span class="badge ' + b.cls + '">' + b.label + '</span>';
  }).join('');

  el.innerHTML =
    '<div class="msg-header">' +
      '<div class="badges">' + badgeHtml + '</div>' +
      '<span class="username">' + escHtml(opts.user) + '</span>' +
    '</div>' +
    '<div class="msg-text">' + opts.text + '</div>';

  container.appendChild(el);

  // Letzte Nachricht immer vollständig sichtbar
  el.scrollIntoView({ block: 'end', behavior: 'instant' });

  var msgs = container.querySelectorAll('.msg');
  if (msgs.length > CONFIG.maxMsgs) {
    msgs[0].classList.add('removing');
    setTimeout(function(){ msgs[0].remove(); }, 400);
  }

  if (CONFIG.fadeAfter > 0) {
    setTimeout(function() {
      el.classList.add('removing');
      setTimeout(function(){ el.remove(); }, 400);
    }, CONFIG.fadeAfter);
  }
}

var ws, pingTimer, reconnectTimer;
var reconnectDelay = 1000;

function connect() {
  statusEl.className   = 'disconnected';
  statusEl.textContent = 'DRADIS: CONNECTING...';

  ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');

  ws.onopen = function() {
    ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
    ws.send('PASS oauth:justinfan' + Math.floor(Math.random()*99999));
    ws.send('NICK justinfan' + Math.floor(Math.random()*99999));
    ws.send('JOIN #' + CONFIG.channel.toLowerCase());
    reconnectDelay = 1000;
  };

  ws.onmessage = function(e) {
    e.data.split('\r\n').forEach(function(raw) {
      handleLine(raw.trim());
    });
  };

  ws.onclose = ws.onerror = function() {
    statusEl.className   = 'disconnected';
    statusEl.textContent = 'DRADIS: OFFLINE';
    clearInterval(pingTimer);
    reconnectTimer = setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 15000);
  };
}

function handleLine(line) {
  if (!line) return;

  if (line.startsWith('PING')) {
    ws.send('PONG :tmi.twitch.tv');
    return;
  }

  var tags = {};
  var rest = line;
  if (line.startsWith('@')) {
    var sp     = line.indexOf(' ');
    var tagStr = line.slice(1, sp);
    rest       = line.slice(sp + 1);
    tagStr.split(';').forEach(function(t) {
      var kv = t.split('=');
      tags[kv[0]] = kv[1] || '';
    });
  }

  if (rest.includes('PRIVMSG')) {
    var match = rest.match(/^:(\S+)!\S+ PRIVMSG #\S+ :(.*)$/);
    if (!match) return;
    var login       = match[1];
    var rawText     = match[2];
    var displayName = tags['display-name'] || login;
    var color       = userColor(login, tags['color']);
    var badges      = parseBadges(tags['badges']);
    var text        = parseEmotes(rawText, tags['emotes']);
    var highlight   = tags['msg-id'] === 'highlighted-message';
    addMessage({ user:displayName, color:color, badges:badges, text:text, highlight:highlight });
    statusEl.className = 'connected hidden';

  } else if (rest.includes('366')) {
    statusEl.className   = 'connected';
    statusEl.textContent = 'DRADIS: #' + CONFIG.channel.toUpperCase();
    setTimeout(function(){ statusEl.classList.add('hidden'); }, 3000);
    pingTimer = setInterval(function() {
      if (ws && ws.readyState === 1) ws.send('PING :tmi.twitch.tv');
    }, 60000);
  }
}

if (CONFIG.channel && CONFIG.channel !== 'DEIN_KANAL') {
  connect();
} else {
  statusEl.textContent = 'DRADIS: ?channel= fehlt';
  statusEl.className   = 'disconnected';

  var DEMO = [
    { user:'JerichoRamirez', color:'#f0a500', badges:[{cls:'broadcaster',label:'CMD'}], text:'Chaos is a Plan. o7',              highlight:false },
    { user:'HEADWiG',        color:'#00d4ff', badges:[{cls:'moderator',  label:'MOD'}], text:'Guns are hot, standing by!',        highlight:false },
    { user:'jazZz',          color:'#a0e8ff', badges:[{cls:'subscriber', label:'SUB'}], text:'Cargo geladen, wir koennen fliegen', highlight:false },
    { user:'HolderDiePolder',color:'#00e5ff', badges:[],                                text:'Kurs gesetzt. ETA 4 Minuten.',      highlight:false }
  ];

  DEMO.forEach(function(msg, i) {
    setTimeout(function(){ addMessage(msg); }, 500 + i * 800);
  });
}
