'use strict';

const { log, logErr } = require('./log.js');

// Feste Textantworten im Chat (`!wow`, ...). Darf jeder Zuschauer. Je Befehl
// eine globale Sperre, damit der Text bei Spam nicht im Sekundentakt kommt —
// oder mit `perUser` eine Sperre je Zuschauer. `{user}` im Text wird durch den
// Anzeigenamen ersetzt.

const COOLDOWN_MS = 30_000;

// Anzeigename fuer den Chat: Buchstaben (auch nicht-lateinisch), Ziffern, _.
function sanitizeName(s) {
  return String(s || '').replace(/[^\p{L}\p{N}_]/gu, '').slice(0, 25);
}

// Liefert das erste Wort einer Chatnachricht in Kleinschreibung oder null.
function firstWord(text) {
  if (typeof text !== 'string') return null;
  const first = text.trim().split(/\s+/).find(Boolean);
  return first ? first.toLowerCase() : null;
}

// Sperre je Schluessel. Ein Schluessel ist der Befehl oder Befehl + Zuschauer.
class Cooldown {
  constructor(ms) {
    this.ms = ms;
    this.last = new Map();
  }

  // 0, wenn frei (und dann sofort belegt), sonst die Restzeit in ms.
  take(key, now = Date.now()) {
    const wait = (this.last.get(key) ?? -Infinity) + this.ms - now;
    if (wait > 0) return wait;
    this.last.set(key, now);
    // Alte Eintraege abraeumen, sonst waechst die Map mit jedem Zuschauer.
    if (this.last.size > 500) {
      for (const [k, at] of this.last) if (at + this.ms < now) this.last.delete(k);
    }
    return 0;
  }
}

class ChatReplies {
  /**
   * @param {object} deps
   * @param {{commands: string[], message: string, perUser?: boolean}[]} deps.replies
   * @param {(message: string) => Promise<void>} deps.say
   */
  constructor({ replies, say }) {
    this.say = say;
    this.cooldown = new Cooldown(COOLDOWN_MS);
    this.byCommand = new Map();
    this.active = [];
    for (const r of replies) {
      const message = (r.message || '').trim();
      if (!message || !r.commands?.length) continue;
      const entry = { message, name: r.commands[0], perUser: Boolean(r.perUser) };
      this.active.push(entry.name);
      for (const c of r.commands) this.byCommand.set(c.toLowerCase(), entry);
    }
  }

  names() {
    return [...this.active];
  }

  // true, wenn die Nachricht ein bekannter Befehl ist (auch bei Sperre).
  handle(text, { source = 'chat', user = '' } = {}) {
    const word = firstWord(text);
    const entry = word ? this.byCommand.get(word) : undefined;
    if (!entry) return false;
    const key = entry.perUser ? `${entry.name}:${user.toLowerCase()}` : entry.name;
    const wait = this.cooldown.take(key);
    if (wait > 0) {
      log('Chat', `${entry.name}: Sperre aktiv, ${source} verworfen (noch ${Math.ceil(wait / 1000)} s)`);
      return true;
    }
    log('Chat', `${entry.name} (${source})`);
    const message = entry.message.split('{user}').join(sanitizeName(user));
    this.say(message).catch((err) => logErr('Chat', 'reply:', err.message));
    return true;
  }
}

module.exports = { ChatReplies, Cooldown, firstWord, sanitizeName, COOLDOWN_MS };
