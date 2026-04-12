'use strict';

// ════════════════════════════════════════════════════════
// CHAOS CREW v5 – Watchtime Engine
// Gesamte Watchtime-Logik hier – testbar ohne WS/HTTP
// ════════════════════════════════════════════════════════

const SECS_PER_COIN  = 7200;   // 2h = 1 Coin
const CHAT_BONUS_SEC = 5;       // +5s pro qualifizierender Nachricht
const CHAT_COOLDOWN  = 10;      // Sekunden zwischen zählenden Nachrichten
const CHAT_MIN_WORDS = 5;       // Mindestanzahl Wörter

// Redis Keys (Live-State)
const K = {
  gwOpen:       () => 'gw_open',
  gwKeyword:    () => 'gw_keyword',
  gwRegistered: (u) => `gw_registered:${u}`,     // 1 wenn registriert
  gwWatchSec:   (u) => `gw_watch:${u}`,           // kumulierte watchSec
  gwChatTime:   (u) => `gw_chat_ts:${u}`,         // letzter Chat-Bonus Timestamp
  gwIndex:      () => 'gw_index',                  // SET aller registrierten User
  gwBanned:     (u) => `gw_banned:${u}`,           // 1 wenn gebannt
  gwSessionId:  () => 'gw_session_id',             // aktuelle Session-ID
  // Spacefight
  sfStats:      (u) => `sf:stats:${u}`,
  sfIndex:      () => 'sf:index',
  sfHistory:    () => 'sf:history',
};

// ── Input Sanitization ────────────────────────────────────
function sanitizeUsername(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 25);
}

function sanitizeStr(s, maxLen = 100) {
  if (s === null || s === undefined) return '';
  // Remove control characters and non‑ASCII bytes to avoid malformed input.
  return String(s).replace(/[\u0000-\u001f\x80-\xFF<>"'`]/g, '').slice(0, maxLen);
}

function countWords(msg) {
  let count = 0, inWord = false;
  for (const ch of msg) {
    if (ch === ' ' || ch === '\t') { inWord = false; }
    else if (!inWord) { inWord = true; count++; }
  }
  return count;
}

function coinsFromSec(watchSec) {
  return Math.round((watchSec / SECS_PER_COIN) * 10000) / 10000;
}

// ── Watchtime Engine ──────────────────────────────────────
class WatchtimeEngine {
  constructor(redis, pg) {
    this.redis = redis;
    this.pg    = pg;
  }

  // Viewer ist im Chat sichtbar (Present Viewer Trigger)
  // Gibt {added, watchSec, coins} zurück oder null wenn nicht gezählt
  async handleViewerTick(username, sessionId) {
    const u = sanitizeUsername(username);
    if (!u) return null;

    // Nur wenn Giveaway offen
    const open = await this.redis.get(K.gwOpen());
    if (open !== 'true') return null;

    // Nur registrierte Teilnehmer
    const registered = await this.redis.get(K.gwRegistered(u));
    if (registered !== '1') return null;

    // Nicht gebannte
    const banned = await this.redis.get(K.gwBanned(u));
    if (banned === '1') return null;

    // +60s atomic
    const newSec = await this.redis.incrby(K.gwWatchSec(u), 60);
    await this.redis.sadd(K.gwIndex(), u);

    // Persistieren
    await this._logEvent(u, 'tick', 60, sessionId);

    return { added: 60, watchSec: newSec, coins: coinsFromSec(newSec) };
  }

  // Chat-Nachricht eingegangen
  // Gibt {added, watchSec, coins, registered} zurück oder null wenn nicht gezählt
  async handleChatMessage(username, message, sessionId) {
    const u = sanitizeUsername(username);
    if (!u) return null;

    // Nur wenn Giveaway offen
    const open = await this.redis.get(K.gwOpen());
    if (open !== 'true') return null;

    const cleanMsg = sanitizeStr(message, 500).trim();

    // Keyword-Check: Registrierung
    const keyword = await this.redis.get(K.gwKeyword());
    if (keyword && cleanMsg.toLowerCase() === keyword.toLowerCase()) {
      return await this._handleRegistration(u, username, sessionId);
    }

    // Nur registrierte Teilnehmer bekommen Chat-Bonus
    const registered = await this.redis.get(K.gwRegistered(u));
    if (registered !== '1') return { registered: false };

    const banned = await this.redis.get(K.gwBanned(u));
    if (banned === '1') return null;

    // Mindestens 5 Wörter
    if (countWords(cleanMsg) < CHAT_MIN_WORDS) return null;

    // Non‑atomic cooldown – use WATCH/MULTI to avoid race conditions
    const chatKey = K.gwChatTime(u);
    const watchKey = K.gwWatchSec(u);
    await this.redis.watch(chatKey);
    const lastTs = await this.redis.get(chatKey);
    const now = Math.floor(Date.now() / 1000);
    if (lastTs && (now - parseInt(lastTs)) < CHAT_COOLDOWN) {
      await this.redis.unwatch();
      return null;
    }
    const multi = this.redis.multi();
    multi.set(chatKey, String(now), 'EX', 86400);
    multi.incrby(watchKey, CHAT_BONUS_SEC);
    const results = await multi.exec();
    if (!results) {
      // Transaction aborted due to concurrent modification – ignore bonus
      return null;
    }
    const newSec = results[1][1]; // result of incrby

    // Persistieren
    await this._logEvent(u, 'chat_bonus', CHAT_BONUS_SEC, sessionId);

    return { added: CHAT_BONUS_SEC, watchSec: newSec, coins: coinsFromSec(newSec), registered: true };
  }

  async _handleRegistration(username, displayName, sessionId) {
    const already = await this.redis.get(K.gwRegistered(username));
    await this.redis.set(K.gwRegistered(username), '1');
    await this.redis.sadd(K.gwIndex(), username);

    // User in PG anlegen falls nicht vorhanden
    await this.pg.query(`
      INSERT INTO users (username, display)
      VALUES ($1, $2)
      ON CONFLICT (username) DO UPDATE SET
        display   = EXCLUDED.display,
        last_seen = NOW()
    `, [username, sanitizeStr(displayName, 50) || username]);

    return { registered: true, isNew: !already };
  }

  // Watchtime-Stand eines Users abrufen
  async getUserState(username) {
    const u = sanitizeUsername(username);
    const watchSec   = parseInt(await this.redis.get(K.gwWatchSec(u)) || '0');
    const registered = await this.redis.get(K.gwRegistered(u)) === '1';
    const banned     = await this.redis.get(K.gwBanned(u)) === '1';
    return { username: u, watchSec, coins: coinsFromSec(watchSec), registered, banned };
  }

  // Alle aktiven Teilnehmer abrufen
  async getAllParticipants() {
    const usernames = await this.redis.smembers(K.gwIndex());
    const result = [];
    for (const u of usernames) {
      const watchSec   = parseInt(await this.redis.get(K.gwWatchSec(u)) || '0');
      const registered = await this.redis.get(K.gwRegistered(u)) === '1';
      const banned     = await this.redis.get(K.gwBanned(u)) === '1';
      result.push({ username: u, watchSec, coins: coinsFromSec(watchSec), registered, banned });
    }
    return result.sort((a, b) => b.coins - a.coins);
  }

  // Event in PostgreSQL loggen
  async _logEvent(username, eventType, deltaSec, sessionId) {
    try {
      await this.pg.query(`
        INSERT INTO watchtime_events (username, event_type, delta_sec, session_id)
        VALUES ($1, $2, $3, $4)
      `, [username, eventType, deltaSec, sessionId || null]);
    } catch(e) {
      console.error('[WTE] PG log error:', e.message);
      // Nicht fatal – Redis hat den State
    }
  }

  // Giveaway öffnen
  // Validate sessionId format – must be 'sess_<digits>'
  function validateSessionId(id) {
    if (!id || typeof id !== 'string' || !/^sess_\d+$/i.test(id)) {
      throw new Error('Invalid sessionId');
    }
  }

  async openGiveaway(keyword, sessionId) {
    validateSessionId(sessionId);
    await this.redis.set(K.gwOpen(), 'true');
    if (keyword) {
      await this.redis.set(K.gwKeyword(), keyword);
    } else {
      await this.redis.del(K.gwKeyword());
    }
    if (sessionId) await this.redis.set(K.gwSessionId(), sessionId);
    console.log(`[WTE] Giveaway opened, keyword="${keyword}", session=${sessionId}`);
  }

  // Giveaway schließen – Snapshot in PG speichern
  async closeGiveaway(sessionId) {
    await this.redis.set(K.gwOpen(), 'false');

    const participants = await this.getAllParticipants();
    if (!sessionId || participants.length === 0) return;

    const client = await this.pg.connect();
    try {
      await client.query('BEGIN');
      for (const p of participants) {
        await client.query(`
          INSERT INTO session_participants (session_id, username, display, watch_sec, coins, banned)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (session_id, username) DO UPDATE SET
            watch_sec = EXCLUDED.watch_sec,
            coins     = EXCLUDED.coins,
            banned    = EXCLUDED.banned
        `, [sessionId, p.username, p.username, p.watchSec, p.coins, p.banned]);
      }
      const active = participants.filter(p => !p.banned);
      const totalCoins = active.reduce((s, p) => s + p.coins, 0);
      await client.query(`
        UPDATE sessions SET
          total_participants = $1,
          total_coins = $2,
          closed_at = NOW()
        WHERE id = $3
      `, [active.length, Math.round(totalCoins * 10000) / 10000, sessionId]);

      // Lifetime-Stats aktualisieren
      for (const p of participants) {
        await client.query(`
          INSERT INTO users (username, display, total_watch_sec, total_msgs, last_seen)
          VALUES ($1, $2, $3, 0, NOW())
          ON CONFLICT (username) DO UPDATE SET
            total_watch_sec = users.total_watch_sec + $3,
            last_seen = NOW()
        `, [p.username, p.username, p.watchSec]);
      }
      await client.query('COMMIT');
      console.log(`[WTE] Session ${sessionId} closed, ${participants.length} participants`);
    } catch(e) {
      await client.query('ROLLBACK');
      console.error('[WTE] closeGiveaway error:', e.message);
    } finally {
      client.release();
    }
  }

  // Reset – Redis-State löschen (nicht PG!)
  async resetGiveaway() {
    const usernames = await this.redis.smembers(K.gwIndex());
    const pipeline  = this.redis.pipeline();
    for (const u of usernames) {
      pipeline.del(K.gwWatchSec(u));
      pipeline.del(K.gwRegistered(u));
      pipeline.del(K.gwChatTime(u));
      pipeline.del(K.gwBanned(u));
    }
    pipeline.del(K.gwIndex());
    pipeline.set(K.gwOpen(), 'false');
    pipeline.del(K.gwKeyword());
    pipeline.del(K.gwSessionId());
    await pipeline.exec();
    console.log('[WTE] Giveaway reset');
  }
}

module.exports = { WatchtimeEngine, K, sanitizeUsername, sanitizeStr, countWords, coinsFromSec,
                   SECS_PER_COIN, CHAT_BONUS_SEC, CHAT_COOLDOWN, CHAT_MIN_WORDS };
