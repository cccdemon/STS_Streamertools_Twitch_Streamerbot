'use strict';

// Persistenter Zustand der Twitch-Anbindung in Redis. Redis laeuft mit
// appendonly auf einem Volume, deshalb ueberlebt der Token Neustarts.
//   twitch:tokens   { accessToken, refreshToken, expiresAt, scopes }
//   kraken:last     letzter erfolgreich geholter Jahres-Nettogewinn (Euro)

const KEY_TOKENS = 'twitch:tokens';
const KEY_KRAKEN = 'kraken:last';

let redis = null;
let tokens = null; // Spiegel im Speicher, damit nicht jede Helix-Anfrage Redis fragt

async function init(client) {
  redis = client;
  try {
    const raw = await redis.get(KEY_TOKENS);
    tokens = raw ? JSON.parse(raw) : null;
  } catch {
    tokens = null;
  }
}

function getTokens() {
  return tokens;
}

async function setTokens(next) {
  tokens = next;
  if (redis) await redis.set(KEY_TOKENS, JSON.stringify(next));
}

async function getKrakenLast() {
  if (!redis) return null;
  const raw = await redis.get(KEY_KRAKEN);
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : null;
}

async function setKrakenLast(value) {
  if (redis) await redis.set(KEY_KRAKEN, String(value));
}

module.exports = { init, getTokens, setTokens, getKrakenLast, setKrakenLast };
