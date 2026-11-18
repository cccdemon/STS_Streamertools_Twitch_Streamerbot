'use strict';

// Persistenter Zustand der Twitch-Anbindung in Redis. Redis laeuft mit
// appendonly auf einem Volume, deshalb ueberlebt der Token Neustarts.
//   twitch:tokens   { accessToken, refreshToken, expiresAt, scopes }
//   kraken:last     letzter erfolgreich geholter Jahres-Nettogewinn (Euro)

//   spotify:tokens  { accessToken, refreshToken, expiresAt, scope }
//   sr:state        { enabled, history[], playlist } der Songwuensche

const KEY_TOKENS = 'twitch:tokens';
const KEY_KRAKEN = 'kraken:last';
const KEY_SPOTIFY = 'spotify:tokens';
const KEY_SONGS = 'sr:state';

let redis = null;
let tokens = null; // Spiegel im Speicher, damit nicht jede Helix-Anfrage Redis fragt
let spotifyTokens = null;
let songState = null;

async function readJson(key) {
  try {
    const raw = await redis.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function init(client) {
  redis = client;
  tokens = await readJson(KEY_TOKENS);
  spotifyTokens = await readJson(KEY_SPOTIFY);
  songState = await readJson(KEY_SONGS);
}

function getSpotifyTokens() {
  return spotifyTokens;
}

async function setSpotifyTokens(next) {
  spotifyTokens = next;
  if (redis) await redis.set(KEY_SPOTIFY, JSON.stringify(next));
}

function getSongState() {
  return songState;
}

async function setSongState(next) {
  songState = next;
  if (redis) await redis.set(KEY_SONGS, JSON.stringify(next));
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

module.exports = {
  init, getTokens, setTokens, getKrakenLast, setKrakenLast,
  getSpotifyTokens, setSpotifyTokens, getSongState, setSongState,
};
