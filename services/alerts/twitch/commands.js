'use strict';

const { helix } = require('./auth.js');
const { firstWord, Cooldown, sanitizeName, COOLDOWN_MS } = require('./replies.js');
const { tryYearNet, FINANCIAL_YEAR_URL } = require('./financial.js');
const store = require('./store.js');
const { log, logErr } = require('./log.js');

// Chatbefehle mit Logik, alle fuer jeden Zuschauer. Technik wie im
// DerDeimos-Overlay (src/twitch/commands.js):
//   !followage   seit wann der Fragende folgt (Sperre je Zuschauer)
//   !ziele       aktive Abo-Ziele aus dem Twitch-Creator-Dashboard
//   !kraken      Stand der Kraken-Verlosung (Jahresgewinn aus CC-Financial)

const COMMANDS = {
  '!followage': 'followage',
  '!ziele': 'goals',
  '!kraken': 'kraken',
};

// Twitch-Zieltypen, die als Abo-Ziel gelten. "subscription" zaehlt Abo-Punkte,
// "subscription_count" Abos, die "new_"-Varianten nur neue Abos im Stream.
const GOAL_LABELS = {
  subscription: 'Abo-Ziel',
  subscription_count: 'Abo-Ziel',
  new_subscription: 'Neue-Abos-Ziel',
  new_subscription_count: 'Neue-Abos-Ziel',
};

const euro = (n) => `${Math.round(Number(n) || 0).toLocaleString('de-DE')} €`;
const euroCent = (n) => `${(Number(n) || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Kalenderdifferenz als "seit 2 Jahren, 3 Monaten, 5 Tagen". Unter einem Tag: "seit heute".
function formatSince(fromIso, now = new Date()) {
  const from = new Date(fromIso);
  if (Number.isNaN(from.getTime())) return '';
  let years = now.getFullYear() - from.getFullYear();
  let months = now.getMonth() - from.getMonth();
  let days = now.getDate() - from.getDate();
  if (days < 0) {
    months -= 1;
    days += new Date(now.getFullYear(), now.getMonth(), 0).getDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  const parts = [];
  if (years > 0) parts.push(plural(years, 'Jahr', 'Jahren'));
  if (months > 0) parts.push(plural(months, 'Monat', 'Monaten'));
  if (days > 0) parts.push(plural(days, 'Tag', 'Tagen'));
  return parts.length ? `seit ${parts.join(', ')}` : 'seit heute';
}

// Antworttext fuer !ziele aus der Helix-Antwort von GET /goals.
function formatGoals(goals) {
  const subs = (goals || []).filter((g) => GOAL_LABELS[g?.type]);
  if (!subs.length) return 'Gerade läuft kein Abo-Ziel.';
  return subs.map((g) => {
    const current = Number(g.current_amount) || 0;
    const target = Number(g.target_amount) || 0;
    const pct = target > 0 ? Math.min(100, Math.floor((current / target) * 100)) : 0;
    const rest = Math.max(0, target - current);
    const desc = String(g.description || '').trim();
    const head = desc ? `${GOAL_LABELS[g.type]} „${desc}“` : GOAL_LABELS[g.type];
    const tail = rest > 0 ? `noch ${rest}` : 'Ziel erreicht!';
    return `${head}: ${current} / ${target} (${pct} %), ${tail}`;
  }).join(' | ');
}

// Antworttext fuer !kraken.
function formatKraken(current, target) {
  const cur = Number(current) || 0;
  const tgt = Number(target) || 100000;
  if (cur >= tgt) {
    return `Kraken-Verlosung: ${euroCent(cur)} von ${euro(tgt)} Jahresgewinn erreicht, die Drake Kraken wird verlost! Nachsehen: ${FINANCIAL_YEAR_URL}`;
  }
  const pct = (Math.max(0, cur / tgt) * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 });
  return `Ab ${euro(tgt)} Jahresgewinn verlosen wir eine Drake Kraken. `
    + `Aktueller Stand: ${euroCent(cur)} / ${euro(tgt)} (${pct} %). Nachsehen: ${FINANCIAL_YEAR_URL}`;
}

class ChatCommands {
  /**
   * @param {object} deps
   * @param {() => ({ id: string, login: string } | null)} deps.getBroadcaster
   * @param {(message: string) => Promise<void>} deps.say
   * @param {number} deps.krakenTarget
   */
  constructor({ getBroadcaster, say, krakenTarget }) {
    this.getBroadcaster = getBroadcaster;
    this.say = say;
    this.krakenTarget = krakenTarget;
    this.cooldown = new Cooldown(COOLDOWN_MS);
  }

  names() {
    return Object.keys(COMMANDS);
  }

  // true, wenn die Nachricht einer dieser Befehle ist (auch bei Sperre).
  handle(event) {
    const word = firstWord(event?.message?.text);
    const kind = word ? COMMANDS[word] : undefined;
    if (!kind) return false;

    const source = `chat:${event.chatter_user_login}`;
    const perUser = kind === 'followage';
    const wait = this.cooldown.take(perUser ? `${kind}:${event.chatter_user_id}` : kind);
    if (wait > 0) {
      log('Chat', `!${kind}: Sperre aktiv, ${source} verworfen (noch ${Math.ceil(wait / 1000)} s)`);
      return true;
    }
    log('Chat', `!${kind} (${source})`);

    const run = {
      followage: () => this.followage(event),
      goals: () => this.goals(),
      kraken: () => this.kraken(),
    }[kind];
    run().catch((err) => logErr(`Chat.${kind}`, err.message));
    return true;
  }

  async followage(event) {
    const b = this.getBroadcaster();
    if (!b?.id) throw new Error('kein Broadcaster aufgeloest');
    const name = sanitizeName(event.chatter_user_name || event.chatter_user_login);
    if (event.chatter_user_id === b.id) {
      await this.say(`@${name} das hier ist dein eigener Kanal.`);
      return;
    }
    const res = await helix('/channels/followers', {
      query: { broadcaster_id: b.id, user_id: event.chatter_user_id },
    });
    const followedAt = res?.data?.[0]?.followed_at;
    if (!followedAt) {
      await this.say(`@${name} du folgst dem Kanal noch nicht.`);
      return;
    }
    const day = new Date(followedAt).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' });
    await this.say(`@${name} folgt ${formatSince(followedAt)} (Follow am ${day}).`);
  }

  async goals() {
    const b = this.getBroadcaster();
    if (!b?.id) throw new Error('kein Broadcaster aufgeloest');
    const res = await helix('/goals', { query: { broadcaster_id: b.id } });
    await this.say(formatGoals(res?.data));
  }

  async kraken() {
    // Stand frisch von financial.raumdock.org. Faellt die Seite aus, gilt der
    // zuletzt geholte Wert aus Redis.
    let current = await tryYearNet();
    if (current !== null) {
      await store.setKrakenLast(current).catch(() => {});
    } else {
      current = await store.getKrakenLast().catch(() => null);
      if (current === null) {
        await this.say(`Der Kraken-Stand ist gerade nicht abrufbar. Nachsehen: ${FINANCIAL_YEAR_URL}`);
        return;
      }
    }
    await this.say(formatKraken(current, this.krakenTarget));
  }
}

module.exports = { ChatCommands, formatSince, formatGoals, formatKraken };
