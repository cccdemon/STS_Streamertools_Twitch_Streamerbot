'use strict';

const { config, redirectUri, TWITCH_SCOPES } = require('./config.js');
const store = require('./store.js');
const { log, logErr } = require('./log.js');

const OAUTH = 'https://id.twitch.tv/oauth2';
const HELIX = 'https://api.twitch.tv/helix';

function authorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: TWITCH_SCOPES.join(' '),
    force_verify: 'true',
    state,
  });
  return `${OAUTH}/authorize?${params}`;
}

async function exchangeCode(code) {
  const res = await fetch(`${OAUTH}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri(),
    }),
  });
  if (!res.ok) throw new Error(`token_exchange_failed ${res.status} ${await res.text()}`);
  return persist(await res.json());
}

async function refresh(refreshToken) {
  const res = await fetch(`${OAUTH}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) throw new Error(`token_refresh_failed ${res.status} ${await res.text()}`);
  return persist(await res.json());
}

async function persist(body) {
  const tokens = {
    accessToken: body.access_token,
    // Twitch rotiert den Refresh-Token nicht immer mit — alten behalten.
    refreshToken: body.refresh_token || store.getTokens()?.refreshToken,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
    scopes: body.scope || TWITCH_SCOPES,
  };
  await store.setTokens(tokens);
  log('TwitchAuth', 'Token gespeichert, gueltig bis', new Date(tokens.expiresAt).toISOString());
  return tokens;
}

// Liefert einen gueltigen Access-Token oder null, wenn der Kanal noch nicht
// verbunden wurde. Refresht 5 Minuten vor Ablauf.
async function validToken() {
  const tokens = store.getTokens();
  if (!tokens?.accessToken) return null;
  if (Date.now() < tokens.expiresAt - 300_000) return tokens.accessToken;
  if (!tokens.refreshToken) return null;
  try {
    const fresh = await refresh(tokens.refreshToken);
    return fresh.accessToken;
  } catch (err) {
    logErr('TwitchAuth', 'refresh:', err.message);
    return null;
  }
}

async function helix(pathname, { method = 'GET', body, query } = {}) {
  const token = await validToken();
  if (!token) throw new Error('no_token');
  const url = new URL(`${HELIX}${pathname}`);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);

  const res = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'client-id': config.clientId,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 204) return null;
  const text = await res.text();
  if (!res.ok) throw new Error(`helix ${pathname} ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

async function resolveBroadcaster(login) {
  const data = await helix('/users', { query: { login } });
  const user = data?.data?.[0];
  if (!user) throw new Error(`user_not_found ${login}`);
  return { id: user.id, login: user.login, displayName: user.display_name };
}

module.exports = { authorizeUrl, exchangeCode, validToken, helix, resolveBroadcaster };
