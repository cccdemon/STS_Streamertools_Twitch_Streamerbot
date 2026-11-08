'use strict';

const WebSocket = require('ws');
const { config } = require('./config.js');
const { helix, resolveBroadcaster, validToken } = require('./auth.js');
const { log, logErr } = require('./log.js');

// EventSub-Client fuer den Chat. Uebernommen aus dem DerDeimos-Overlay
// (src/twitch/eventsub.js), aber nur mit channel.chat.message — die Alerts
// dieses Stacks laufen weiter ueber Streamerbot → overlay.html.

const DEFAULT_WS = 'wss://eventsub.wss.twitch.tv/ws';

// Der Token gehoert dem Broadcaster, deshalb liest er als er selbst mit.
const SUBSCRIPTIONS = [
  { type: 'channel.chat.message', version: '1', condition: (id) => ({ broadcaster_user_id: id, user_id: id }) },
];

class EventSubClient {
  constructor(onChat) {
    this.onChat = onChat;
    this.ws = null;
    this.sessionId = null;
    this.broadcaster = null;
    this.reconnectDelay = 1000;
    this.keepaliveTimer = null;
    this.reconnectTimer = null;
    this.pendingHandover = false;
    this.stopped = false;
    this.status = 'offline';
    this.seen = new Set(); // Message-IDs gegen Twitch-Redeliveries
  }

  async start() {
    this.stopped = false;
    if (!config.channel) {
      this.status = 'kein-kanal';
      log('EventSub', 'TWITCH_CHANNEL fehlt — Chatbefehle aus');
      return;
    }
    const token = await validToken();
    if (!token) {
      this.status = 'kein-token';
      log('EventSub', 'Kein Twitch-Token — /alerts/auth/login?key=ADMIN_TOKEN oeffnen und Kanal verbinden');
      return;
    }
    try {
      this.broadcaster = await resolveBroadcaster(config.channel);
      log('EventSub', `Kanal ${this.broadcaster.login} (${this.broadcaster.id})`);
    } catch (err) {
      logErr('EventSub', 'resolve:', err.message);
      this.status = 'kanal-fehler';
      return;
    }
    this.connect(DEFAULT_WS);
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.keepaliveTimer);
    clearTimeout(this.reconnectTimer);
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.status = 'offline';
  }

  connect(url) {
    this.status = 'verbinde';
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.on('open', () => log('EventSub', 'WS offen'));
    ws.on('message', (raw) => this.handleMessage(raw, ws).catch((e) => logErr('EventSub', e.message)));
    ws.on('error', (err) => logErr('EventSub', 'ws:', err.message));
    ws.on('close', (code) => {
      if (this.ws !== ws) return; // alter Socket nach Reconnect-Handover oder stop()
      this.status = 'getrennt';
      log('EventSub', `WS zu (${code})`);
      this.scheduleReconnect();
    });
  }

  scheduleReconnect() {
    if (this.stopped) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(delay * 2, 30_000);
    log('EventSub', `Reconnect in ${delay}ms`);
    this.reconnectTimer = setTimeout(() => this.connect(DEFAULT_WS), delay);
  }

  // Twitch schickt keepalive im vereinbarten Intervall. Bleibt es aus, gilt
  // die Verbindung als tot — selbst neu aufbauen statt auf TCP-Timeout warten.
  armKeepalive(seconds) {
    clearTimeout(this.keepaliveTimer);
    this.keepaliveTimer = setTimeout(() => {
      log('EventSub', 'Keepalive ausgeblieben, erzwinge Reconnect');
      this.ws?.terminate();
    }, (seconds + 5) * 1000);
  }

  async handleMessage(raw, ws) {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const { message_type: kind, message_id: id } = msg.metadata || {};

    if (id) {
      if (this.seen.has(id)) return;
      this.seen.add(id);
      if (this.seen.size > 500) this.seen = new Set([...this.seen].slice(-250));
    }

    if (kind === 'session_welcome') {
      const session = msg.payload.session;
      this.armKeepalive(session.keepalive_timeout_seconds ?? 10);
      // Bei einem Reconnect-Handover sind die Subscriptions schon aktiv und
      // wandern automatisch mit — nur bei einer neuen Session neu anlegen.
      const isHandover = this.pendingHandover;
      this.pendingHandover = false;
      this.sessionId = session.id;
      this.reconnectDelay = 1000;
      this.status = 'verbunden';
      if (!isHandover) await this.subscribeAll();
      return;
    }

    if (kind === 'session_keepalive') {
      this.armKeepalive(10);
      return;
    }

    if (kind === 'session_reconnect') {
      const url = msg.payload.session.reconnect_url;
      log('EventSub', 'Reconnect-Handover angefordert');
      this.pendingHandover = true;
      const old = ws;
      this.connect(url);
      setTimeout(() => old.close(), 5000);
      return;
    }

    if (kind === 'revocation') {
      log('EventSub', 'Subscription widerrufen:', msg.payload.subscription?.type);
      return;
    }

    if (kind === 'notification') {
      this.armKeepalive(10);
      if (msg.payload.subscription.type === 'channel.chat.message') this.onChat(msg.payload.event);
    }
  }

  async subscribeAll() {
    const id = this.broadcaster.id;
    for (const sub of SUBSCRIPTIONS) {
      try {
        await helix('/eventsub/subscriptions', {
          method: 'POST',
          body: {
            type: sub.type,
            version: sub.version,
            condition: sub.condition(id),
            transport: { method: 'websocket', session_id: this.sessionId },
          },
        });
        log('EventSub', 'abonniert:', sub.type);
      } catch (err) {
        logErr('EventSub', `subscribe(${sub.type}):`, err.message);
      }
    }
  }
}

module.exports = { EventSubClient };
