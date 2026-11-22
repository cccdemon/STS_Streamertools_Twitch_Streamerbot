'use strict';

// Eigene Wunschliste fuer !sr. Spotifys Warteschlange ist dafuer nicht
// verlaesslich: eingereihte Titel verschwinden (im Jam bei jedem Titelwechsel,
// ohne Jam auch mitten im Lied) und werden nie gespielt. Deshalb fuehrt der
// Server die Liste selbst und startet den naechsten Wunsch kurz vor Ende des
// laufenden Titels direkt (PUT /me/player/play). Die Spotify-Warteschlange
// wird gar nicht mehr benutzt.
//
// Zustand (Redis sr:wishes):
//   pending  offene Wuensche in Reihenfolge
//   active   der Wunsch, der gerade laeuft
//   resume   wohin es nach dem letzten Wunsch zurueckgeht (Playlist + Titel)

const LEAD_MS = 3500;     // so kurz vor Titelende wird der Wunsch gestartet
const SETTLE_MS = 5000;   // nach einem Start meldet Spotify kurz noch den alten Titel
const ENDED_MS = 20_000;  // fruehestens dann gilt "steht bei 0 und spielt nicht" als zu Ende

const empty = () => ({ pending: [], active: null, resume: null });

class WishPlayer {
  /**
   * @param {object} deps
   * @param {{ player: Function, queue: Function, playUris: Function, playContext: Function }} deps.api
   * @param {() => object | null} deps.load
   * @param {(state: object) => Promise<void>} deps.save
   */
  constructor({ api, load, save, now = Date.now, log = () => {}, logErr = () => {} }) {
    this.api = api;
    this.load = load;
    this.save = save;
    this.now = now;
    this.log = log;
    this.logErr = logErr;
    this.busy = false;
  }

  state() {
    return { ...empty(), ...(this.load() || {}) };
  }

  /** Haengt einen Wunsch an. → Platz in der Liste (1 = als Naechstes). */
  async add(wish) {
    const s = this.state();
    s.pending.push(wish);
    await this.save(s);
    return s.pending.length;
  }

  /**
   * Nimmt den zuletzt gewuenschten, noch offenen Titel dieses Zuschauers von
   * der Liste. → der Wunsch, `'active'` wenn sein einziger gerade laeuft,
   * sonst null. Aeltere Eintraege ohne userId werden am Namen erkannt.
   */
  async removeLast({ userId, user }) {
    const s = this.state();
    const mine = (w) => (w.userId ? w.userId === userId : w.user === user);
    const i = s.pending.findLastIndex(mine);
    if (i < 0) return s.active && mine(s.active) ? 'active' : null;
    const [removed] = s.pending.splice(i, 1);
    await this.save(s);
    return removed;
  }

  /** Wartezeit bis zum Wunsch auf `position`: Rest des laufenden Titels plus alle Wuensche davor. */
  etaMs(player, position) {
    const s = this.state();
    const rest = player?.item ? Math.max(0, (player.item.duration_ms || 0) - (player.progress_ms || 0)) : 0;
    return rest + s.pending.slice(0, Math.max(0, position - 1)).reduce((sum, w) => sum + (w.durationMs || 0), 0);
  }

  /** Ein Takt. Ohne offene Wuensche fragt er Spotify nicht. */
  async tick() {
    if (this.busy) return;
    const s = this.state();
    if (!s.pending.length && !s.active) return;
    this.busy = true;
    try {
      await this.step(s);
    } catch (err) {
      this.logErr(err.message);
    } finally {
      this.busy = false;
    }
  }

  async step(s) {
    const now = this.now();
    if (s.active && now - s.active.at < SETTLE_MS) return;
    const p = await this.api.player();
    if (!p?.item) return;

    // Wunsch lief und steht jetzt bei 0: zu Ende, aber Spotify hat nichts danach.
    const ended = Boolean(s.active) && !p.is_playing && (p.progress_ms || 0) < 1500 && now - s.active.at > ENDED_MS;
    if (!p.is_playing && !ended) return; // pausiert: nichts von selbst starten

    if (s.active && !ended) {
      if (!s.active.seenUri) {
        s.active.seenUri = p.item.uri;
        await this.save(s);
      } else if (p.item.uri !== s.active.seenUri) {
        // Wunsch wurde uebersprungen, es laeuft schon etwas anderes.
        s.active = null;
        if (!s.pending.length) {
          await this.backToContext(s);
          return;
        }
        await this.save(s);
      }
    }

    const remaining = (p.item.duration_ms || 0) - (p.progress_ms || 0);
    if (!ended && remaining > LEAD_MS) return;

    if (s.pending.length) {
      if (!s.active && !s.resume && p.context?.uri) {
        const q = await this.api.queue().catch(() => null);
        s.resume = { contextUri: p.context.uri, nextUri: q?.queue?.[0]?.uri || null };
      }
      const next = s.pending[0];
      await this.api.playUris([next.uri]); // wirft bei Fehler: Wunsch bleibt offen
      s.pending.shift();
      s.active = { uri: next.uri, title: next.title, user: next.user, userId: next.userId, at: now };
      await this.save(s);
      this.log(`Wunsch gestartet: „${next.title}“ (${next.user}), noch ${s.pending.length} offen`);
      return;
    }
    if (s.active) {
      s.active = null;
      await this.backToContext(s);
    }
  }

  // Nach dem letzten Wunsch zurueck in die Playlist, die vorher lief. Lief
  // keine (Autoplay, einzelner Titel), macht Spotify von selbst weiter.
  async backToContext(s) {
    const r = s.resume;
    s.resume = null;
    await this.save(s);
    if (!r?.contextUri) return;
    try {
      await this.api.playContext(r.contextUri, r.nextUri);
    } catch {
      await this.api.playContext(r.contextUri, null); // Titel nicht mehr in der Playlist
    }
    this.log('Wuensche durch, zurueck zur Playlist');
  }
}

module.exports = { WishPlayer, LEAD_MS, SETTLE_MS };
