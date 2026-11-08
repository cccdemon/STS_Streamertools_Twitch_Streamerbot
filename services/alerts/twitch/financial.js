'use strict';

const { log, logErr } = require('./log.js');

// Nettogewinn des laufenden Jahres von financial.raumdock.org (CC-Financial).
// Uebernommen aus dem DerDeimos-Overlay (src/financial.js). Es gibt dort keine
// Jahres-Schnittstelle, nur die oeffentliche Monatssumme ohne Token. Die
// Jahresseite /financial/year rechnet alle zwoelf Monate zusammen, laufende
// Kosten kuenftiger Monate eingeschlossen — die Summe der zwoelf Monatswerte
// ergibt genau ihr "Net".

const FINANCIAL_BASE = 'https://financial.raumdock.org';
const FINANCIAL_YEAR_URL = `${FINANCIAL_BASE}/financial/year`;

const CACHE_MS = 5 * 60_000;
const TIMEOUT_MS = 8_000;

let cache = null; // { year, net, at }

// Kalenderjahr in deutscher Zeit, sonst kippt das Jahr um Mitternacht UTC.
function currentYear(now = new Date()) {
  return Number(new Intl.DateTimeFormat('de-DE', { year: 'numeric', timeZone: 'Europe/Berlin' }).format(now));
}

// Liefert den Jahres-Nettogewinn in Euro (zwei Nachkommastellen) oder wirft.
async function fetchYearNet(year = currentYear()) {
  if (cache && cache.year === year && Date.now() - cache.at < CACHE_MS) return cache.net;

  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const results = await Promise.all(months.map(async (period) => {
    const url = `${FINANCIAL_BASE}/api/public/financial-summary?period=${period}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`financial ${period} ${res.status}`);
    const body = await res.json();
    if (typeof body?.netResult !== 'number') throw new Error(`financial ${period} ohne netResult`);
    if (body.unconverted?.count > 0) {
      log('Financial', `${period}: ${body.unconverted.count} Buchungen ohne Wechselkurs fehlen in der Summe`);
    }
    return body.netResult;
  }));

  const net = Math.round(results.reduce((a, b) => a + b, 0) * 100) / 100;
  cache = { year, net, at: Date.now() };
  return net;
}

// Wie fetchYearNet, aber null statt Fehler — fuer Aufrufer mit Rueckfallwert.
async function tryYearNet() {
  try {
    return await fetchYearNet();
  } catch (err) {
    logErr('Financial', err.message);
    return null;
  }
}

module.exports = { fetchYearNet, tryYearNet, currentYear, FINANCIAL_BASE, FINANCIAL_YEAR_URL };
