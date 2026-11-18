'use strict';

const { firstWord, sanitizeName } = require('./replies.js');
const store = require('./store.js');
const {
  parseTrackQuery, findTrack, queueTrack, describeTrack, playerQueue, queueEta, formatEta,
  createPlaylist, addToPlaylist, hasPlaylistScope, spotifyConfigured, spotifyConnected, SpotifyError, sanitizeStr,
} = require('./spotify.js');
const { helix } = require('./auth.js');
const { log, logErr } = require('./log.js');

// Songwuensche aus dem Chat. Uebernommen aus dem DerDeimos-Overlay
// (src/songrequest.js):
//   !sr <Titel | Spotify-Link>   reiht den Song in Spotify ein (alle Zuschauer)
//   !song                        was gerade laeuft
// Je Zuschauer SR_LIMIT Wuensche in SR_WINDOW_MS (Standard 3 in 2 Minuten).
// Explizite Songs nur mit SR_ALLOW_EXPLICIT=1. Kein Overlay — Spotify selbst
// zeigt die Warteschlange.

const num = (v, d) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : d;
};
const LIMIT = num(process.env.SR_LIMIT, 3);
const WINDOW_MS = num(process.env.SR_WINDOW_MS, 120_000);
const ALLOW_EXPLICIT = process.env.SR_ALLOW_EXPLICIT === '1';
const HISTORY = 20;
const SONG_COOLDOWN_MS = 15_000;
const ETA_SETTLE_MS = 800;

const berlinDate = (d) => d.toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric' });

/** Name der Stream-Playlist: Streamtitel_TT.MM.JJJJ. */
function playlistName(title, date) {
  const t = sanitizeStr(String(title ?? ''), 80) || 'RDOC Stream';
  return `${t}_${berlinDate(date)}`;
}

/**
 * Wozu gehoert ein Wunsch? Live: zur laufenden Sendung (Stream-ID, Titel und
 * Startdatum von Twitch). Offline (Testen): zum Kalendertag in Berlin.
 */
function streamSession(stream, channelTitle, now = new Date()) {
  if (stream?.id) return { key: `stream:${stream.id}`, title: stream.title || channelTitle, date: new Date(stream.started_at || now) };
  return { key: `tag:${berlinDate(now)}`, title: channelTitle, date: now };
}

/** Hoechstens `limit` Treffer je Schluessel in einem gleitenden Fenster. */
class WindowLimit {
  constructor(limit, windowMs) {
    this.limit = limit;
    this.windowMs = windowMs;
    /** @type {Map<string, number[]>} */
    this.hits = new Map();
  }

  // 0, wenn frei (und dann belegt), sonst die Wartezeit in ms.
  take(key, now = Date.now()) {
    const list = (this.hits.get(key) || []).filter((t) => t > now - this.windowMs);
    if (list.length >= this.limit) {
      this.hits.set(key, list);
      return list[0] + this.windowMs - now;
    }
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 500) {
      for (const [k, l] of this.hits) if (!l.some((t) => t > now - this.windowMs)) this.hits.delete(k);
    }
    return 0;
  }

  // Einen Versuch zurueckgeben (nichts gefunden, Spotify aus): zaehlt nicht.
  refund(key) {
    this.hits.get(key)?.pop();
  }
}

function songState() {
  return { enabled: true, history: [], ...(store.getSongState() || {}) };
}

class SongRequests {
  /**
   * @param {object} deps
   * @param {() => ({ id: string, login: string } | null)} deps.getBroadcaster
   * @param {(message: string) => Promise<void>} deps.say
   */
  constructor({ getBroadcaster, say }) {
    this.getBroadcaster = getBroadcaster;
    this.say = say;
    this.limit = new WindowLimit(LIMIT, WINDOW_MS);
    this.songAt = 0;
    // Playlist-Zugriffe nacheinander, sonst legen zwei Wuensche zu Stream-
    // beginn zwei Playlists an.
    this.playlistChain = Promise.resolve();
  }

  names() {
    return ['!sr', '!song'];
  }

  handle(event) {
    const text = event?.message?.text;
    const word = firstWord(text);
    if (word === '!song') {
      if (Date.now() - this.songAt < SONG_COOLDOWN_MS) return true;
      this.songAt = Date.now();
      this.song().catch((err) => logErr('Chat.song', err.message));
      return true;
    }
    if (word !== '!sr' && word !== '!songrequest') return false;
    const rest = String(text).trim().slice(word.length);
    this.request(event, rest).catch((err) => logErr('Chat.sr', err.message));
    return true;
  }

  async request(event, rest) {
    const name = sanitizeName(event.chatter_user_name || event.chatter_user_login);
    const s = songState();
    if (!s.enabled) {
      await this.say(`@${name} Songwünsche sind gerade aus.`);
      return;
    }
    if (!spotifyConfigured() || !spotifyConnected()) {
      log('Chat', '!sr: Spotify nicht verbunden — /auth/spotify/login');
      await this.say(`@${name} Songwünsche sind gerade nicht verfügbar.`);
      return;
    }
    const parsed = parseTrackQuery(rest);
    if (!parsed) {
      await this.say(`@${name} So geht's: !sr Interpret Titel, oder ein Spotify-Link.`);
      return;
    }
    const key = event.chatter_user_id || event.chatter_user_login;
    const wait = this.limit.take(key);
    if (wait > 0) {
      await this.say(`@${name} du hast schon ${LIMIT} Songs gewünscht, wieder in ${Math.ceil(wait / 1000)} s.`);
      return;
    }

    try {
      const track = await findTrack(parsed, ALLOW_EXPLICIT);
      if (!track) {
        this.limit.refund(key);
        await this.say(`@${name} dazu habe ich nichts gefunden${ALLOW_EXPLICIT ? '' : ' (explizite Songs sind gesperrt)'}.`);
        return;
      }
      await queueTrack(track.uri);
      const desc = describeTrack(track);
      log('Chat', `!sr ${name}: ${desc}`);
      const entry = {
        user: name,
        title: sanitizeStr(track.name ?? '', 80),
        artists: sanitizeStr((track.artists || []).map((a) => a.name).join(', '), 80),
        at: new Date().toISOString(),
      };
      await store.setSongState({ ...s, history: [entry, ...s.history].slice(0, HISTORY) });
      await this.say(`@${name} ${desc} ist in der Warteschlange${await this.etaText(track.uri)}.`);
      this.playlistChain = this.playlistChain.then(() => this.addToStreamPlaylist(track.uri));
      await this.playlistChain;
    } catch (err) {
      this.limit.refund(key);
      if (err instanceof SpotifyError && err.status === 404) {
        await this.say(`@${name} Spotify spielt gerade nichts ab, Songwünsche gehen erst wieder, wenn Musik läuft.`);
        return;
      }
      logErr('Chat.sr', err.message);
      await this.say(`@${name} das hat nicht geklappt.`);
    }
  }

  // ", Platz 3, läuft in etwa 7 Minuten" — oder leer, wenn Spotify die
  // Warteschlange noch nicht zeigt oder nicht antwortet. Kurz warten: direkt
  // nach dem Einreihen fehlt der Titel dort manchmal noch.
  async etaText(uri) {
    try {
      await new Promise((r) => setTimeout(r, ETA_SETTLE_MS));
      const eta = await queueEta(uri);
      if (!eta) return '';
      return `, Platz ${eta.position}, läuft ${formatEta(eta.etaMs)}`;
    } catch (err) {
      logErr('Chat.sr', 'eta:', err.message);
      return '';
    }
  }

  // Jeder Wunsch landet zusaetzlich in der Playlist des laufenden Streams.
  // Scheitert das, bleibt der Wunsch trotzdem in der Warteschlange.
  async addToStreamPlaylist(uri) {
    if (!hasPlaylistScope()) {
      log('Spotify', 'Playlist uebersprungen: Token ohne Playlist-Scope, Spotify neu verbinden');
      return;
    }
    try {
      const pl = await this.streamPlaylist();
      await addToPlaylist(pl.id, uri);
    } catch (err) {
      logErr('Spotify', 'playlist:', err.message);
    }
  }

  async streamPlaylist() {
    const b = this.getBroadcaster();
    let stream = null;
    let channelTitle = '';
    if (b?.id) {
      stream = (await helix('/streams', { query: { user_id: b.id } }))?.data?.[0] || null;
      if (!stream) channelTitle = (await helix('/channels', { query: { broadcaster_id: b.id } }))?.data?.[0]?.title || '';
    }
    const session = streamSession(stream, channelTitle);
    const current = songState().playlist;
    if (current?.key === session.key && current.id) return current;

    const name = playlistName(session.title, session.date);
    const channel = b?.login ? ` von twitch.tv/${b.login}` : '';
    const created = await createPlaylist(name, `Songwünsche aus dem Chat${channel}`);
    const playlist = { key: session.key, id: created.id, url: created.url, name };
    await store.setSongState({ ...songState(), playlist });
    log('Spotify', `Playlist angelegt: ${name}`);
    return playlist;
  }

  async song() {
    if (!spotifyConnected()) return;
    const q = await playerQueue();
    if (!q.current) {
      await this.say('Gerade läuft keine Musik.');
      return;
    }
    await this.say(`Gerade läuft: „${q.current.title}“ von ${q.current.artists}`);
  }
}

module.exports = { SongRequests, WindowLimit, playlistName, streamSession, songState };
