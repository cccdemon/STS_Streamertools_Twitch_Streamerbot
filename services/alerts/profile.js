'use strict';

// ════════════════════════════════════════════════════════
// CHAOS CREW – Profil-/Steckbrief-Logik (!id)
// Reine Funktionen, kein IO → unit-testbar (node --test).
// server.js aggregiert die Rohdaten (Twitch + Giveaway +
// Spacefight + Hauling) und ruft buildProfile().
// ════════════════════════════════════════════════════════

function toInt(v) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; }
function toNum(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; }

// Sekunden → kompakte Watchtime-Anzeige
function formatWatchtime(sec) {
  sec = Math.max(0, toInt(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h >= 24) {
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h`;
  }
  if (h >= 1) return `${h}h ${m}m`;
  return `${m}m`;
}

// Watchtime-Rang nach Stunden (Name + Icon)
function watchtimeRank(sec) {
  const h = toInt(sec) / 3600;
  if (h >= 150) return { icon: '👑', label: 'Legende' };
  if (h >= 50)  return { icon: '🛡', label: 'Urgestein' };
  if (h >= 10)  return { icon: '⭐', label: 'Veteran' };
  if (h >= 1)   return { icon: '🔆', label: 'Stammgast' };
  return { icon: '🌱', label: 'Frischling' };
}

// Followage (Tage) → lesbarer String, null wenn unbekannt
function formatFollowage(days) {
  const d = toInt(days);
  if (d <= 0) return null;
  if (d < 31) return `${d} Tag${d === 1 ? '' : 'e'}`;
  if (d < 365) { const mo = Math.floor(d / 30); return `${mo} Monat${mo === 1 ? '' : 'e'}`; }
  const y = Math.floor(d / 365);
  const mo = Math.floor((d % 365) / 30);
  return `${y} Jahr${y === 1 ? '' : 'e'}${mo > 0 ? ` ${mo} Mon` : ''}`;
}

function tierLabel(tier) {
  const t = String(tier || '1000');
  if (t === '3000') return 'Tier 3';
  if (t === '2000') return 'Tier 2';
  return 'Tier 1';
}

// Errungenschaften aus vorhandenen Channel-Daten ableiten
function buildAchievements(d) {
  const a = [];
  const wr = watchtimeRank(d.watchSec);
  a.push({ icon: wr.icon, label: wr.label });
  if (d.isSub) {
    a.push({ icon: '⭐', label: `Abonnent${d.subMonths > 0 ? ` · ${d.subMonths} Mon` : ''}` });
  }
  if (d.giveawayWins > 0) a.push({ icon: '🎁', label: `${d.giveawayWins}× Giveaway-Sieger` });
  if (d.sfWins > 0)       a.push({ icon: '🚀', label: `Raumkampf ${d.sfWins}–${d.sfLosses}` });
  if (d.haulPoints > 0)   a.push({ icon: '📦', label: `Hauling: ${d.haulRank || d.haulPoints + 'P'}` });
  if (d.bitsTotal > 0)    a.push({ icon: '💎', label: `${d.bitsTotal} Bits gespendet` });
  if (d.followageDays >= 365) a.push({ icon: '🎖', label: 'Über 1 Jahr Follower' });
  return a;
}

// „Netter Satz" – höchste passende Stufe gewinnt
function buildStatusLine(d) {
  const h = toInt(d.watchSec) / 3600;
  if (d.isSub && h >= 50)  return 'Rückgrat der Crew — aktiver Abonnent und Dauergast.';
  if (d.isSub)             return 'Treues Crewmitglied mit Abo-Abzeichen.';
  if (h >= 50)             return 'Urgestein der Community — fast immer an Bord.';
  if (h >= 10)             return 'Aktiver Member der Community.';
  if (d.giveawayWins > 0 || d.sfWins > 0) return 'Bekanntes Gesicht in den Crew-Games.';
  if (d.followageDays >= 30) return 'Etabliertes Crewmitglied.';
  return 'Neu an Bord — willkommen, Pilot!';
}

// Hauptfunktion: Rohdaten → vollständiges Overlay-Payload (alertType:'profile')
function buildProfile(raw) {
  const d = {
    login:        String(raw.login || raw.user || '').toLowerCase(),
    display:      raw.display || raw.user || raw.login || '???',
    avatar:       raw.avatar || raw.profileImageUrl || '',
    followageDays: toInt(raw.followageDays),
    isSub:        !!raw.isSub,
    subTier:      raw.subTier || '1000',
    subMonths:    toInt(raw.subMonths),
    bitsTotal:    toInt(raw.bitsTotal),
    watchSec:     toInt(raw.watchSec),
    coins:        toNum(raw.coins),
    giveawayWins: toInt(raw.giveawayWins),
    msgs:         toInt(raw.msgs),
    sfWins:       toInt(raw.sfWins),
    sfLosses:     toInt(raw.sfLosses),
    haulPoints:   toInt(raw.haulPoints),
    haulRank:     raw.haulRank || '',
  };

  const followageStr = formatFollowage(d.followageDays);

  // Feld-Grid für das Steckbrief-Rendering (Label/Wert)
  const fields = [
    { label: 'WATCHTIME', value: formatWatchtime(d.watchSec) },
    { label: 'FOLLOWER SEIT', value: followageStr || '—' },
    { label: 'ABONNENT', value: d.isSub ? `Ja · ${tierLabel(d.subTier)}${d.subMonths > 0 ? ` · ${d.subMonths} Mon` : ''}` : 'Nein' },
    { label: 'BITS GESPENDET', value: d.bitsTotal > 0 ? String(d.bitsTotal) : '—' },
    { label: 'COINS', value: d.coins > 0 ? d.coins.toFixed(2) : '—' },
    { label: 'NACHRICHTEN', value: d.msgs > 0 ? String(d.msgs) : '—' },
    { label: 'GIVEAWAY-SIEGE', value: d.giveawayWins > 0 ? String(d.giveawayWins) : '—' },
    { label: 'RAUMKAMPF', value: (d.sfWins || d.sfLosses) ? `${d.sfWins}S / ${d.sfLosses}N` : '—' },
  ];
  if (d.haulPoints > 0) fields.push({ label: 'HAULING', value: d.haulRank || `${d.haulPoints} P` });

  return {
    alertType:   'profile',
    login:       d.login,
    user:        d.display,
    avatar:      d.avatar,
    watchtimeStr: formatWatchtime(d.watchSec),
    followageStr,
    fields,
    achievements: buildAchievements(d),
    statusLine:  buildStatusLine(d),
  };
}

module.exports = {
  buildProfile, buildAchievements, buildStatusLine,
  formatWatchtime, watchtimeRank, formatFollowage, tierLabel,
};
