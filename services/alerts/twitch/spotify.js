'use strict';

const store = require('./store.js');
const { log, logErr } = require('./log.js');

// Spotify-Web-API fuer die Songwuensche (!sr). Braucht Premium und ein aktives
// Geraet (die laufende Spotify-App). Uebernommen aus dem DerDeimos-Overlay
// (src/spotify.js). Tokens liegen in Redis (spotify:tokens) und verlassen den
// Service nie.

const ACCOUNTS = 'https://accounts.spotify.com';
const API = 'https://api.spotify.com/v1';
// Playlist-Scopes fuer die Stream-Playlist. Neuer Scope = einmal neu verbinden.
const SCOPES = [
  'user-modify-playback-state', 'user-read-playback-state', 'user-read-currently-playing',
  'playlist-modify-public', 'playlist-modify-private',
];

// Spotify laesst als http-Redirect nur Loopback-IPs zu, kein "localhost".
// Gleiche URL wie im DerDeimos-Overlay, damit dieselbe Spotify-App passt.
// Erreichbar per SSH-Tunnel 127.0.0.1:3200 -> Caddy (CLAUDE.md).
const spotify = {
  clientId: process.env.SPOTIFY_CLIENT_ID || '',
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET || '',
  redirectUri: process.env.SPOTIFY_REDIRECT_URI || 'http://127.0.0.1:3200/auth/spotify/callback',
};

class SpotifyError extends Error {
  constructor(status, reason, text) {
    super(`spotify ${status} ${reason || ''} ${text || ''}`.trim());
    this.status = status;
    this.reason = reason || '';
  }
}

// Text aus Spotify fuer den Chat: keine Steuerzeichen, gekuerzt.
function sanitizeStr(s, maxLen = 100) {
  return String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maxLen);
}

const spotifyConfigured = () => Boolean(spotify.clientId && spotify.clientSecret);
const spotifyConnected = () => Boolean(store.getSpotifyTokens()?.refreshToken);

function authorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: spotify.clientId,
    response_type: 'code',
    redirect_uri: spotify.redirectUri,
    scope: SCOPES.join(' '),
    state,
  });
  return `${ACCOUNTS}/authorize?${params}`;
}

async function tokenRequest(body) {
  const basic = Buffer.from(`${spotify.clientId}:${spotify.clientSecret}`).toString('base64');
  const res = await fetch(`${ACCOUNTS}/api/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${basic}` },
    body: new URLSearchParams(body),
  });
  if (!res.ok) throw new SpotifyError(res.status, 'token', await res.text());
  const b = await res.json();
  const old = store.getSpotifyTokens();
  const tokens = {
    accessToken: b.access_token,
    // Spotify rotiert den Refresh-Token nicht immer — alten behalten.
    refreshToken: b.refresh_token || old?.refreshToken,
    expiresAt: Date.now() + (b.expires_in ?? 3600) * 1000,
    // Beim Refresh fehlt scope manchmal — dann den alten Stand behalten.
    scope: b.scope || old?.scope || '',
  };
  await store.setSpotifyTokens(tokens);
  return tokens;
}

async function exchangeCode(code) {
  await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: spotify.redirectUri });
  log('Spotify', 'verbunden');
}

async function validToken() {
  const t = store.getSpotifyTokens();
  if (!t?.refreshToken) return null;
  if (t.accessToken && Date.now() < t.expiresAt - 60_000) return t.accessToken;
  try {
    return (await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refreshToken })).accessToken;
  } catch (err) {
    logErr('Spotify', 'refresh:', err.message);
    return null;
  }
}

async function api(path, { method = 'GET', query, json } = {}) {
  const token = await validToken();
  if (!token) throw new SpotifyError(401, 'NOT_CONNECTED');
  const qs = query ? `?${new URLSearchParams(query)}` : '';
  const headers = { authorization: `Bearer ${token}` };
  if (json) headers['content-type'] = 'application/json';
  const res = await fetch(`${API}${path}${qs}`, { method, headers, body: json ? JSON.stringify(json) : undefined });
  if (res.status === 204) return null;
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* Spotify antwortet bei manchen POSTs mit leerem oder Nicht-JSON-Text */
  }
  if (!res.ok) throw new SpotifyError(res.status, body?.error?.reason, body?.error?.message || text.slice(0, 200));
  return body;
}

const isIdChar = (c) => {
  const p = c.codePointAt(0);
  return (p >= 48 && p <= 57) || (p >= 65 && p <= 90) || (p >= 97 && p <= 122);
};
const validId = (id) => id.length === 22 && [...id].every(isIdChar);

/**
 * Eingabe hinter !sr: Track-Link oder spotify:track:-URI wird direkt
 * eingereiht, alles andere ist Suchtext. Leer → null.
 */
function parseTrackQuery(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  if (raw.startsWith('spotify:track:')) {
    const id = raw.slice('spotify:track:'.length);
    if (validId(id)) return { uri: raw };
  }
  if (raw.startsWith('https://open.spotify.com/')) {
    try {
      const parts = new URL(raw).pathname.split('/').filter(Boolean);
      const i = parts.indexOf('track');
      if (i >= 0 && validId(parts[i + 1] || '')) return { uri: `spotify:track:${parts[i + 1]}` };
    } catch {
      /* kein gueltiger Link — dann eben Suchtext */
    }
  }
  const query = raw.split(' ').filter(Boolean).join(' ').slice(0, 100);
  return { query };
}

/** Erster Treffer, der nicht als explizit markiert ist (ausser erlaubt). */
function pickTrack(items, allowExplicit) {
  return (items || []).find((t) => t?.uri && (allowExplicit || !t.explicit)) || null;
}

/** „Titel“ von Interpret, Interpret — fuer die Chatantwort. */
function describeTrack(track) {
  const title = sanitizeStr(track?.name ?? '', 80);
  const artists = sanitizeStr((track?.artists || []).map((a) => a.name).join(', '), 80);
  return artists ? `„${title}“ von ${artists}` : `„${title}“`;
}

async function findTrack(parsed, allowExplicit) {
  if (parsed.uri) {
    const t = await api(`/tracks/${parsed.uri.slice('spotify:track:'.length)}`, { query: { market: 'DE' } });
    return pickTrack([t], allowExplicit);
  }
  const res = await api('/search', { query: { q: parsed.query, type: 'track', limit: '10', market: 'DE' } });
  return pickTrack(res?.tracks?.items, allowExplicit);
}

/** Laufende Wiedergabe (Titel, Fortschritt, Playlist) oder null ohne aktives Geraet. */
const player = () => api('/me/player');

/** Nackte Warteschlange von Spotify, nur zum Nachsehen. */
const rawQueue = () => api('/me/player/queue');

/** Startet genau diese Titel sofort — unabhaengig von der Warteschlange. */
const playUris = (uris) => api('/me/player/play', { method: 'PUT', json: { uris } });

/** Spielt eine Playlist/ein Album weiter, optional ab einem bestimmten Titel. */
const playContext = (contextUri, offsetUri) => api('/me/player/play', {
  method: 'PUT',
  json: offsetUri ? { context_uri: contextUri, offset: { uri: offsetUri } } : { context_uri: contextUri },
});

/** Was gerade laeuft und was als Naechstes kommt. */
async function playerQueue() {
  const res = await api('/me/player/queue');
  const slim = (t) => (t ? { title: sanitizeStr(t.name ?? '', 80), artists: sanitizeStr((t.artists || []).map((a) => a.name).join(', '), 80) } : null);
  return { current: slim(res?.currently_playing), queue: (res?.queue || []).slice(0, 15).map(slim) };
}

/**
 * Platz und Wartezeit eines Titels in der Warteschlange: Restzeit des
 * laufenden Titels plus die Laengen aller Titel davor. Steht der Titel
 * doppelt drin, zaehlt das erste Vorkommen. Nicht gefunden → null.
 */
function computeEta(progressMs, currentDurationMs, queue, uri) {
  const i = (queue || []).findIndex((t) => t?.uri === uri);
  if (i < 0) return null;
  const rest = Math.max(0, (currentDurationMs || 0) - (progressMs || 0));
  const before = queue.slice(0, i).reduce((sum, t) => sum + (t?.duration_ms || 0), 0);
  return { position: i + 1, etaMs: rest + before };
}

/** „gleich“ unter einer Minute, sonst gerundete Minuten bzw. Stunden. */
function formatEta(ms) {
  if (ms < 60_000) return 'gleich';
  const min = Math.round(ms / 60_000);
  if (min < 60) return `in etwa ${min} ${min === 1 ? 'Minute' : 'Minuten'}`;
  return `in etwa ${Math.floor(min / 60)} Std. ${min % 60} Min.`;
}

/** Wartezeit fuer einen gerade eingereihten Titel, oder null. */
async function queueEta(uri) {
  const [player, q] = await Promise.all([api('/me/player'), api('/me/player/queue')]);
  if (!player?.item) return null;
  return computeEta(player.progress_ms, player.item.duration_ms, q?.queue, uri);
}

const hasPlaylistScope = () => (store.getSpotifyTokens()?.scope || '').split(' ').includes('playlist-modify-public');

// Spotify hat 2026 Playlist-Endpunkte umbenannt (/me/playlists, /items). Erst
// den neuen Weg, bei 404 den alten — dann ist egal, welcher gerade gilt.
async function withFallback(primary, legacy) {
  try {
    return await primary();
  } catch (err) {
    if (err instanceof SpotifyError && (err.status === 404 || err.status === 405)) return legacy();
    throw err;
  }
}

/** Legt eine oeffentliche Playlist an. → { id, url } */
async function createPlaylist(name, description) {
  const json = { name, description, public: true };
  const p = await withFallback(
    () => api('/me/playlists', { method: 'POST', json }),
    async () => {
      const me = await api('/me');
      return api(`/users/${encodeURIComponent(me.id)}/playlists`, { method: 'POST', json });
    },
  );
  const url = p?.external_urls?.spotify || '';
  return { id: p.id, url: url.startsWith('https://open.spotify.com/') ? url : '' };
}

function addToPlaylist(playlistId, uri) {
  const path = `/playlists/${encodeURIComponent(playlistId)}`;
  const json = { uris: [uri] };
  return withFallback(
    () => api(`${path}/items`, { method: 'POST', json }),
    () => api(`${path}/tracks`, { method: 'POST', json }),
  );
}

module.exports = {
  spotify, SpotifyError, sanitizeStr, spotifyConfigured, spotifyConnected, authorizeUrl, exchangeCode,
  parseTrackQuery, pickTrack, describeTrack, findTrack, playerQueue,
  player, rawQueue, playUris, playContext,
  computeEta, formatEta, queueEta, hasPlaylistScope, createPlaylist, addToPlaylist,
};
