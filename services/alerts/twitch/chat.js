'use strict';

const { helix } = require('./auth.js');

// Schreibt eine Nachricht als der verbundene Broadcaster in den eigenen Chat.
// Braucht den Scope user:write:chat. Unabhaengig von Streamerbot — der alte
// Weg ch:chat_reply → Bridge → CC_ChatReply.cs bleibt fuer die anderen
// Funktionen bestehen.
async function sendChat(broadcaster, message) {
  if (!broadcaster?.id) throw new Error('kein Broadcaster aufgeloest');
  const res = await helix('/chat/messages', {
    method: 'POST',
    body: { broadcaster_id: broadcaster.id, sender_id: broadcaster.id, message },
  });
  const sent = res?.data?.[0];
  if (sent && !sent.is_sent) {
    throw new Error(`Chatnachricht verworfen: ${sent.drop_reason?.message || 'ohne Grund'}`);
  }
}

module.exports = { sendChat };
