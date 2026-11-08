'use strict';

// Konfiguration der Twitch-Chatbefehle. Uebernommen aus dem DerDeimos-Overlay
// (src/config.js), auf den Alerts-Service zugeschnitten.

const num = (v, fallback) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
};

const WOW_DEFAULT = 'Unsere Gilde - Sturmhammer Garde, RP-PVE. Mehr unter https://wow.raumdock.org';
const BECHER_DEFAULT = 'Der RDOC Becher! Hier gibt es ihn: https://shop.raumdock.org/en-eur/products/rdoc-workers-mug';

const config = {
  clientId: process.env.TWITCH_CLIENT_ID || '',
  clientSecret: process.env.TWITCH_CLIENT_SECRET || '',
  channel: (process.env.TWITCH_CHANNEL || '').toLowerCase(),

  // Basis-URL, unter der der Browser den Alerts-Service erreicht, inklusive
  // Caddy-Praefix. Twitch akzeptiert als Redirect nur HTTPS oder
  // http://localhost — ohne Domain laeuft der Login ueber einen SSH-Tunnel auf
  // Caddy (Port 80 des Servers → localhost:8080).
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || 'http://localhost:8080/alerts').replace(/\/+$/, ''),

  adminToken: process.env.ADMIN_TOKEN || '',

  krakenTarget: num(process.env.KRAKEN_TARGET, 100000),

  // Feste Textantworten im Chat. Die *_TEXT-Variablen kommen ueber
  // docker-compose immer an, leer heisst dort "nicht gesetzt" — deshalb ||.
  chatReplies: [
    {
      commands: ['!wow'],
      message: process.env.WOW_TEXT || WOW_DEFAULT,
    },
    {
      commands: ['!becher'],
      message: process.env.BECHER_TEXT || BECHER_DEFAULT,
    },
  ],
};

// TWITCH_REDIRECT_URI ueberschreibt die abgeleitete URL — noetig, weil die
// Twitch-App der Suite nur "http://localhost" eingetragen hat. Caddy leitet
// /?state=.. dann an /alerts/auth/callback weiter (siehe caddy/Caddyfile).
function redirectUri() {
  return process.env.TWITCH_REDIRECT_URI || `${config.publicBaseUrl}/auth/callback`;
}

// Scopes, die die Chatbefehle brauchen.
const TWITCH_SCOPES = [
  'user:read:chat',           // channel.chat.message lesen
  'user:write:chat',          // Antworten in den Chat schreiben
  'moderator:read:followers', // !followage
  'channel:read:goals',       // !ziele
];

module.exports = { config, redirectUri, TWITCH_SCOPES };
