'use strict';

// ════════════════════════════════════════════════════════
// TEAM GIVEAWAY – Watchtime / Ticket Engine (channel-aware)
// Multi-Channel-Kampagne: Coins pro (user, channel).
// 7200s Viewtime = 1 Ticket. Chat (>3 Wörter) = +0.5s (selber Pott).
// Viewtime-Multiplier (time-boxed) gilt für Tick + Chat.
// Draw-Eligibility: opt-in via Keyword (ab ≥1 Coin) + valide Coins
// auf ≥2 Kanälen. Gewicht = Summe Coins.
// Testbar ohne WS/HTTP.
// ════════════════════════════════════════════════════════

const { randomInt } = require('crypto');

const SECS_PER_COIN  = 7200;   // 2h = 1 Coin/Ticket
const CHAT_BONUS_SEC = 0.5;    // +0.5s pro qualifizierender Nachricht
const CHAT_COOLDOWN  = 10;     // Sekunden zwischen zählenden Nachrichten
const CHAT_MIN_WORDS = 4;      // >3 Wörter
const TICK_SEC       = 60;     // server-seitiger Tick
const PRESENCE_TTL   = 600;    // Presence gilt 10min nach letztem Heartbeat
const JOIN_MIN_COINS = 1;      // ab 1 Coin per Keyword teilnehmen
const MIN_CHANNELS   = 2;      // ≥2 Kanäle für Ziehung
const DEFAULT_CHANNELS = ['justcallmedeimos', 'jerichoramirez', 'x_jazzz_x'];

// Redis Keys
const K = {
  gwOpen:       () => 'gw_open',
  gwKeyword:    () => 'gw_keyword',
  gwSessionId:  () => 'gw_session_id',          // = Kampagnen-ID
  gwChannels:   () => 'gw:channels',            // JSON-Array teilnehmender Kanäle
  gwMult:       () => 'gw:mult',                // Multiplier-Faktor (TTL)
  gwUsers:      () => 'gw:users',               // SET aller Kampagnen-User
  gwRegistered: (u) => `gw:registered:${u}`,    // per Keyword opt-in
  gwBanned:     (u) => `gw_banned:${u}`,        // kampagnenweit
  // per Kanal
  chWatch:    (ch, u) => `gw:ch:${ch}:watch:${u}`,
  chChatTs:   (ch, u) => `gw:ch:${ch}:chat_ts:${u}`,
  chPresent:  (ch, u) => `gw:ch:${ch}:present:${u}`,
  chLastTick: (ch, u) => `gw:ch:${ch}:last_tick:${u}`,
  chMsgs:     (ch, u) => `gw:ch:${ch}:msgs:${u}`,
  chFollows:  (ch, u) => `gw:ch:${ch}:follows:${u}`,
  chIndex:    (ch)    => `gw:ch:${ch}:index`,
};

// ── Input Sanitization ────────────────────────────────────
function sanitizeUsername(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 25);
}
const sanitizeChannel = sanitizeUsername;

function sanitizeStr(s, maxLen = 100) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[^\x20-\x7e]|[<>"']/g, '').slice(0, maxLen);
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

  // ── Kampagnen-Config ────────────────────────────────────
  async getChannels() {
    const raw = await this.redis.get(K.gwChannels());
    if (!raw) return DEFAULT_CHANNELS.slice();
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) return arr.map(sanitizeChannel).filter(Boolean);
    } catch { /* fallthrough */ }
    return DEFAULT_CHANNELS.slice();
  }

  async setChannels(channels) {
    const clean = (Array.isArray(channels) ? channels : []).map(sanitizeChannel).filter(Boolean);
    const arr = clean.length ? clean : DEFAULT_CHANNELS.slice();
    await this.redis.set(K.gwChannels(), JSON.stringify(arr));
    return arr;
  }

  // Primärkanal — Fallback wenn ein Event keinen channel trägt (Legacy/C# alt).
  async primaryChannel() { return (await this.getChannels())[0]; }

  async resolveChannel(channel) {
    const ch = sanitizeChannel(channel);
    if (ch) return ch;
    return this.primaryChannel();
  }

  // Aktueller Viewtime-Multiplier (1 = kein Boost).
  async getMultiplier() {
    const f = parseFloat(await this.redis.get(K.gwMult()) || '1');
    return (isFinite(f) && f > 0) ? f : 1;
  }

  // Boost setzen: factor für seconds Sekunden (0/entfernt = aus).
  async setMultiplier(factor, seconds) {
    const f = Math.max(1, Math.min(10, parseFloat(factor) || 1));
    const s = Math.max(1, Math.min(86400, parseInt(seconds) || 0));
    if (f <= 1 || !s) { await this.redis.del(K.gwMult()); return { factor: 1, seconds: 0 }; }
    await this.redis.set(K.gwMult(), String(f), 'EX', s);
    return { factor: f, seconds: s };
  }

  async multiplierState() {
    const f = await this.getMultiplier();
    const ttl = f > 1 ? await this.redis.ttl(K.gwMult()) : 0;
    return { factor: f, secondsLeft: ttl > 0 ? ttl : 0 };
  }

  // follows-Gate: '0' blockt Coin-Accrual; fehlt/(‘1') = erlaubt (permissiv,
  // bis Streamerbot `follows` mitschickt).
  _followAllowed(val) { return val !== '0'; }

  // ── Presence / Tick ─────────────────────────────────────
  async handleViewerTick(channel, username, follows) {
    const u  = sanitizeUsername(username);
    if (!u) return null;
    const ch = await this.resolveChannel(channel);
    const now = Math.floor(Date.now() / 1000);
    await this.redis.set(K.chLastTick(ch, u), String(now), 'EX', 86400);
    await this.redis.set(K.chPresent(ch, u), '1', 'EX', PRESENCE_TTL);
    if (follows !== undefined) await this.redis.set(K.chFollows(ch, u), follows ? '1' : '0');
    await this.redis.sadd(K.gwUsers(), u);
    await this.redis.sadd(K.chIndex(ch), u);
    return null;
  }

  // Server-Tick: +TICK_SEC*mult für anwesende, folgende, nicht gebannte User
  // je Kanal. Gibt Updates zurück.
  async tickPresentUsers(sessionId) {
    if (await this.redis.get(K.gwOpen()) !== 'true') return [];
    const channels = await this.getChannels();
    const mult = await this.getMultiplier();
    const inc  = TICK_SEC * mult;
    const updates = [];
    for (const ch of channels) {
      const users = await this.redis.smembers(K.chIndex(ch));
      for (const u of users) {
        if (await this.redis.get(K.gwBanned(u)) === '1') continue;
        if (!await this.redis.get(K.chPresent(ch, u))) continue;
        if (!this._followAllowed(await this.redis.get(K.chFollows(ch, u)))) continue;
        const newSec = parseFloat(await this.redis.incrbyfloat(K.chWatch(ch, u), inc));
        await this._logEvent(u, 'tick', inc, sessionId, ch);
        updates.push({ username: u, channel: ch, watchSec: newSec, coins: coinsFromSec(newSec) });
      }
    }
    return updates;
  }

  // ── Chat ────────────────────────────────────────────────
  async handleChatMessage(channel, username, message, sessionId, follows) {
    const u = sanitizeUsername(username);
    if (!u) return null;
    if (await this.redis.get(K.gwOpen()) !== 'true') return null;

    const ch = await this.resolveChannel(channel);
    const cleanMsg = sanitizeStr(message, 500).trim();

    await this.redis.set(K.chPresent(ch, u), '1', 'EX', PRESENCE_TTL);
    if (follows !== undefined) await this.redis.set(K.chFollows(ch, u), follows ? '1' : '0');
    await this.redis.sadd(K.gwUsers(), u);
    await this.redis.sadd(K.chIndex(ch), u);

    // Keyword → opt-in (ab ≥1 Coin)
    const keyword = await this.redis.get(K.gwKeyword());
    if (keyword && cleanMsg.toLowerCase() === keyword.toLowerCase()) {
      await this.redis.incr(K.chMsgs(ch, u));
      return this._tryRegister(u, username, sessionId);
    }

    if (await this.redis.get(K.gwBanned(u)) === '1') return null;
    await this.redis.incr(K.chMsgs(ch, u));

    // Coin-Bonus nur bei Follow des Kanals + genug Wörter + Cooldown
    if (!this._followAllowed(await this.redis.get(K.chFollows(ch, u)))) return { channel: ch, followed: false };
    if (countWords(cleanMsg) < CHAT_MIN_WORDS) return null;

    const chatKey  = K.chChatTs(ch, u);
    const now = Math.floor(Date.now() / 1000);
    const lastTs = await this.redis.get(chatKey);
    if (lastTs && (now - parseInt(lastTs)) < CHAT_COOLDOWN) return null;

    const mult = await this.getMultiplier();
    const inc  = CHAT_BONUS_SEC * mult;
    await this.redis.set(chatKey, String(now), 'EX', 86400);
    const newSec = parseFloat(await this.redis.incrbyfloat(K.chWatch(ch, u), inc));
    await this._logEvent(u, 'chat_bonus', inc, sessionId, ch);

    return { added: inc, channel: ch, watchSec: newSec, coins: coinsFromSec(newSec) };
  }

  // Opt-in via Keyword — nur ab JOIN_MIN_COINS Gesamt-Coins.
  async _tryRegister(username, displayName, sessionId) {
    const agg = await this.getUserAggregate(username);
    if (agg.totalCoins < JOIN_MIN_COINS) {
      return { registered: false, needCoins: JOIN_MIN_COINS, haveCoins: agg.totalCoins };
    }
    const already = await this.redis.get(K.gwRegistered(username));
    await this.redis.set(K.gwRegistered(username), '1');
    await this.redis.sadd(K.gwUsers(), username);
    await this.pg.query(`
      INSERT INTO users (username, display) VALUES ($1, $2)
      ON CONFLICT (username) DO UPDATE SET display = EXCLUDED.display, last_seen = NOW()
    `, [username, sanitizeStr(displayName, 50) || username]);
    return { registered: true, isNew: !already, coins: agg.totalCoins };
  }

  // Manuelle Admin-Registrierung/-Optin (z.B. gw_add_ticket auf neuen User).
  async registerUser(username, sessionId) {
    const u = sanitizeUsername(username);
    if (!u) return null;
    await this.redis.set(K.gwRegistered(u), '1');
    await this.redis.sadd(K.gwUsers(), u);
    await this.pg.query(`
      INSERT INTO users (username, display) VALUES ($1, $1)
      ON CONFLICT (username) DO UPDATE SET last_seen = NOW()
    `, [u]);
    return { registered: true };
  }

  // Admin-Ticketkorrektur auf einem Kanal (+/- watchSec).
  async adjustWatch(username, channel, deltaSec, sessionId) {
    const u = sanitizeUsername(username);
    if (!u) return null;
    const ch = await this.resolveChannel(channel);
    await this.redis.sadd(K.gwUsers(), u);
    await this.redis.sadd(K.chIndex(ch), u);
    let after = parseFloat(await this.redis.incrbyfloat(K.chWatch(ch, u), deltaSec));
    if (after < 0) { await this.redis.set(K.chWatch(ch, u), '0'); after = 0; }
    await this._logEvent(u, deltaSec >= 0 ? 'admin_add' : 'admin_sub', deltaSec, sessionId, ch);
    return { username: u, channel: ch, watchSec: after };
  }

  // ── Aggregation ─────────────────────────────────────────
  async getUserAggregate(username) {
    const u = sanitizeUsername(username);
    const channels = await this.getChannels();
    const perChannel = {};
    let totalWatch = 0, totalMsgs = 0, qualified = 0;
    for (const ch of channels) {
      const watchSec = parseFloat(await this.redis.get(K.chWatch(ch, u)) || '0');
      const msgs     = parseInt(await this.redis.get(K.chMsgs(ch, u)) || '0');
      const follows  = this._followAllowed(await this.redis.get(K.chFollows(ch, u)));
      const coins    = coinsFromSec(watchSec);
      perChannel[ch] = { watchSec, coins, msgs, follows };
      totalWatch += watchSec;
      totalMsgs  += msgs;
      if (follows && coins > 0) qualified++;
    }
    const totalCoins = coinsFromSec(totalWatch);
    const registered = await this.redis.get(K.gwRegistered(u)) === '1';
    const banned     = await this.redis.get(K.gwBanned(u)) === '1';
    const eligible   = registered && !banned && qualified >= MIN_CHANNELS && totalCoins > 0;
    return {
      username: u, perChannel, totalWatchSec: totalWatch, totalCoins,
      channelsQualified: qualified, registered, banned, eligible,
      // Backward-compat Aliase (Admin-Panel / REST erwarten coins/watchSec/msgs)
      coins: totalCoins, watchSec: totalWatch, msgs: totalMsgs,
    };
  }

  // server.js / REST nutzen getUserState (= Aggregat inkl. Aliase).
  async getUserState(username) { return this.getUserAggregate(username); }

  async getAllParticipants() {
    const users = await this.redis.smembers(K.gwUsers());
    const result = [];
    for (const u of users) result.push(await this.getUserAggregate(u));
    return result.sort((a, b) => b.totalCoins - a.totalCoins);
  }

  async _logEvent(username, eventType, deltaSec, sessionId, channel) {
    try {
      await this.pg.query(`
        INSERT INTO watchtime_events (username, event_type, delta_sec, session_id, channel)
        VALUES ($1, $2, $3, $4, $5)
      `, [username, eventType, Math.round(deltaSec), sessionId || null, channel || null]);
    } catch(e) {
      console.error('[WTE] PG log error:', e.message);
    }
  }

  validateSessionId(id) {
    if (!id || typeof id !== 'string' || !/^sess_\d+$/i.test(id)) throw new Error('Invalid sessionId');
  }

  async openGiveaway(keyword, sessionId, channels) {
    this.validateSessionId(sessionId);
    await this.redis.set(K.gwOpen(), 'true');
    if (keyword) await this.redis.set(K.gwKeyword(), keyword);
    else await this.redis.del(K.gwKeyword());
    if (sessionId) await this.redis.set(K.gwSessionId(), sessionId);
    if (channels) await this.setChannels(channels);
    else if (!await this.redis.get(K.gwChannels())) await this.setChannels(DEFAULT_CHANNELS);
    console.log(`[WTE] Giveaway opened, keyword="${keyword}", session=${sessionId}`);
  }

  // ── Winner-Ziehung ──────────────────────────────────────
  // Nur eligible (opt-in + ≥2 Kanäle valide). Gewicht = totalCoins.
  async drawWinner(sessionId, opts = {}) {
    const isTest = !!opts.test;
    const prize  = opts.prize ? sanitizeStr(opts.prize, 100) : null;
    const participants = await this.getAllParticipants();
    const eligible = participants.filter(p => p.eligible);
    if (!eligible.length) return null;

    const total = eligible.reduce((s, p) => s + p.totalCoins, 0);
    const rand  = (randomInt(0, 2 ** 31) / (2 ** 31)) * total;
    let acc = 0, winner = eligible[eligible.length - 1];
    for (const p of eligible) { acc += p.totalCoins; if (rand < acc) { winner = p; break; } }

    const snapshot = eligible.map(p => ({
      u: p.username, c: p.totalCoins, q: p.channelsQualified,
      ch: Object.fromEntries(Object.entries(p.perChannel).map(([k, v]) => [k, v.coins])),
    }));
    const totalRounded = Math.round(total * 10000) / 10000;
    const randRounded  = Math.round(rand * 1e10) / 1e10;

    const client = await this.pg.connect();
    let drawId = null, drawIndex = 1;
    try {
      await client.query('BEGIN');
      const idxRes = await client.query(
        sessionId
          ? `SELECT COUNT(*)::int AS n FROM giveaway_draws WHERE session_id = $1`
          : `SELECT COUNT(*)::int AS n FROM giveaway_draws WHERE session_id IS NULL AND drawn_at > NOW() - INTERVAL '1 day'`,
        sessionId ? [sessionId] : []
      );
      drawIndex = (idxRes.rows[0]?.n || 0) + 1;

      const ins = await client.query(`
        INSERT INTO giveaway_draws
          (session_id, winner, winner_coins, winner_watch_sec, total_coins,
           eligible_count, rand_value, draw_index, is_test, prize, eligible_snapshot)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        RETURNING id
      `, [sessionId || null, winner.username, winner.totalCoins, Math.round(winner.totalWatchSec),
          totalRounded, eligible.length, randRounded, drawIndex, isTest, prize,
          JSON.stringify(snapshot)]);
      drawId = ins.rows[0].id;

      if (!isTest) {
        let prevWinner = null;
        if (sessionId) {
          const sres = await client.query(`SELECT winner FROM sessions WHERE id = $1`, [sessionId]);
          prevWinner = sres.rows[0]?.winner || null;
        }
        if (prevWinner !== winner.username) {
          if (prevWinner) await client.query(`UPDATE users SET times_won = GREATEST(times_won - 1, 0) WHERE username = $1`, [prevWinner]);
          await client.query(`
            INSERT INTO users (username, display, times_won, last_seen)
            VALUES ($1, $2, 1, NOW())
            ON CONFLICT (username) DO UPDATE SET times_won = users.times_won + 1, last_seen = NOW()
          `, [winner.username, winner.username]);
        }
        if (sessionId) {
          await client.query(
            `UPDATE sessions SET winner = $1, winner_watch_sec = $2, winner_coins = $3 WHERE id = $4`,
            [winner.username, Math.round(winner.totalWatchSec), winner.totalCoins, sessionId]
          );
        }
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('[WTE] drawWinner error:', e.message);
      throw e;
    } finally {
      client.release();
    }

    console.log(`[WTE] Draw #${drawId} (idx ${drawIndex}): ${winner.username} won, coins=${winner.totalCoins}, pool=${totalRounded}, eligible=${eligible.length}, test=${isTest}`);
    return {
      winner: winner.username, coins: winner.totalCoins, watchSec: Math.round(winner.totalWatchSec),
      drawId, drawIndex, eligibleCount: eligible.length, total: totalRounded, rand: randRounded, isTest, prize,
    };
  }

  // Giveaway schließen – Per-Kanal-Snapshot in PG.
  async closeGiveaway(sessionId) {
    await this.redis.set(K.gwOpen(), 'false');
    if (!sessionId) return;
    const participants = await this.getAllParticipants();
    const active = participants.filter(p => !p.banned);
    const totalCoins = active.reduce((s, p) => s + p.totalCoins, 0);
    const channels = await this.getChannels();

    const client = await this.pg.connect();
    try {
      await client.query('BEGIN');
      for (const p of participants) {
        for (const ch of channels) {
          const pc = p.perChannel[ch] || { watchSec: 0, msgs: 0, coins: 0, follows: false };
          if (pc.watchSec <= 0 && pc.msgs <= 0) continue;
          await client.query(`
            INSERT INTO campaign_participation (session_id, username, channel, watch_sec, msgs, coins, follows, valid)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            ON CONFLICT (session_id, username, channel) DO UPDATE SET
              watch_sec = EXCLUDED.watch_sec, msgs = EXCLUDED.msgs, coins = EXCLUDED.coins,
              follows = EXCLUDED.follows, valid = EXCLUDED.valid
          `, [sessionId, p.username, ch, Math.round(pc.watchSec), pc.msgs, pc.coins, pc.follows, pc.follows && pc.coins > 0]);
        }
      }
      const upd = await client.query(`
        UPDATE sessions SET total_participants = $1, total_coins = $2, channels = $3, closed_at = NOW()
        WHERE id = $4 AND closed_at IS NULL
      `, [active.length, Math.round(totalCoins * 10000) / 10000, JSON.stringify(channels), sessionId]);

      if (upd.rowCount > 0) {
        for (const p of participants) {
          await client.query(`
            INSERT INTO users (username, display, total_watch_sec, last_seen)
            VALUES ($1, $1, $2, NOW())
            ON CONFLICT (username) DO UPDATE SET
              total_watch_sec = users.total_watch_sec + $2, last_seen = NOW()
          `, [p.username, Math.round(p.totalWatchSec)]);
        }
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

  // Reset – alle Kampagnen-Keys löschen (nicht PG).
  async resetGiveaway() {
    const channels = await this.getChannels();
    const users = await this.redis.smembers(K.gwUsers());
    const pipeline = this.redis.pipeline();
    for (const u of users) {
      pipeline.del(K.gwRegistered(u));
      pipeline.del(K.gwBanned(u));
      for (const ch of channels) {
        pipeline.del(K.chWatch(ch, u), K.chChatTs(ch, u), K.chPresent(ch, u),
                     K.chLastTick(ch, u), K.chMsgs(ch, u), K.chFollows(ch, u));
      }
    }
    for (const ch of channels) pipeline.del(K.chIndex(ch));
    pipeline.del(K.gwUsers());
    pipeline.set(K.gwOpen(), 'false');
    pipeline.del(K.gwKeyword());
    pipeline.del(K.gwSessionId());
    pipeline.del(K.gwMult());
    await pipeline.exec();
    console.log('[WTE] Giveaway reset');
  }
}

module.exports = {
  WatchtimeEngine, K, sanitizeUsername, sanitizeChannel, sanitizeStr, countWords, coinsFromSec,
  SECS_PER_COIN, CHAT_BONUS_SEC, CHAT_COOLDOWN, CHAT_MIN_WORDS, TICK_SEC, PRESENCE_TTL,
  JOIN_MIN_COINS, MIN_CHANNELS, DEFAULT_CHANNELS,
};
