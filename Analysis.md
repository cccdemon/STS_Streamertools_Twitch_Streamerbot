# Streamertools Integration Analysis

## Ziel

Die Architektur ist so ausgelegt, dass Streamer.bot als leichtgewichtige Event-Quelle fungiert, während die eigentliche Giveaway-/Watchtime-Logik zentral in der Node.js-API umgesetzt wird.

Streamer.bot sendet nur rohe Events an die API. Die API verarbeitet diese Events, speichert Live-Zustand in Redis und historische Daten in PostgreSQL. Streamer.bot übernimmt optional die Rückgabe von Chat-Antworten an Twitch.

---

## Komponenten

### 1. Streamer.bot

Dateien:
- `streamerbot/GW_A_ViewerTick.cs`
- `streamerbot/GW_B_ChatMessage.cs`
- `streamerbot/GW_TimeInfo.cs`
- `streamerbot/CC_ChatReply.cs`

Aufgabe:
- Sammelt Twitch-Events: Viewer-Ticks, Chat-Messages, Commands.
- Filtert Bots und unsaubere Nutzernamen heraus.
- Sendet Event-Payloads per WebSocket an die API.
- Empfängt `chat_reply` Events von der API und postet sie in den Twitch-Chat.

Typische Events:
- `viewer_tick`
- `chat_msg`
- `time_cmd`
- `chat_reply`

---

### 2. API / Server

Dateien:
- `api/server.js`
- `api/watchtime.js`

Aufgabe:
- Empfängt Streamer.bot-Events per WebSocket.
- Führt Giveaway- und Watchtime-Logik aus.
- Verwaltet Live-Zustand in Redis.
- Speichert Sessions, Teilnehmer und Gewinner in PostgreSQL.
- Sendet Status- und Update-Events an WebSocket-Clients.

Wichtige Events im API-Handler:
- `viewer_tick` → `wte.handleViewerTick(...)`
- `chat_msg` → `wte.handleChatMessage(...)`
- `time_cmd` → `wte.getUserState(...)` + `chat_reply`
- `spacefight_result` → `saveSpacefightResult(...)`
- `stream_online` / `stream_offline` → `sf_status`

---

### 3. Frontend / Browser

Hauptpfade:
- `web/giveaway/giveaway-admin.js`
- `web/giveaway/giveaway-overlay.js`
- `web/games/spacefight.js`
- `web/chaos-crew-shared.js`

Aufgabe:
- Admin-Panel und Overlay verbinden sich per WebSocket mit der API.
- Overlay und Admin erhalten Teilnehmerlisten, Status und Gewinnerinformationen.
- Spacefight-UI registriert sich ebenfalls und ruft Status ab.

Wichtige WebSocket-Ereignisse:
- `gw_get_all`
- `gw_data`
- `gw_cmd`
- `gw_status`
- `gw_overlay`
- `gw_join`
- `sf_status`
- `sf_result`

---

## Datenfluss

1. Streamer.bot erkennt einen aktiven Viewer oder Chat-Event.
2. Streamer.bot sendet ein Event an die API.
3. Die API validiert die Nachricht und aktualisiert Redis / PostgreSQL.
4. Die API broadcastet Status-Events an WebSocket-Clients.
5. Das Overlay und das Admin-Panel zeigen die aktuellen Daten an.
6. Bei Chat-Command `!time` / `!coin` liefert die API eine Chat-Antwort zurück, die Streamer.bot in den Twitch-Chat postet.

---

## Wichtige Ziele der Integration

- Zentralisierung der Logik in der API.
- Minimierung des Zustands in Streamer.bot.
- Sicherstellung, dass Chat-Commands und Viewer-Ticks konsistent ausgewertet werden.
- Sicherstellung, dass Overlay und Admin-Panel denselben Live-Status sehen.
- Unterstützung von Spacefight-Events und Stream-Status über denselben WS-Mechanismus.

---

## Praktische Vorteile

- Bessere Testbarkeit: API-Logik ist von Streamer.bot entkoppelt.
- Einfachere Wartung: Änderungen am Giveaway geschehen in Node.js statt im C#-State.
- Flexiblere Persistenz: Redis für schnellen Live-Zustand, PostgreSQL für Historie.
- Saubere Chat-Integration: Twitch-Chat-Antworten passieren weiterhin über Streamer.bot.

---

## Spacefight-Spiel

Dateien:
- `web/games/spacefight.js`
- `web/games/spacefight-admin.js`
- `api/server.js` (Spacefight-API und WebSocket-Broadcast)
- `web/streamerbot-data.js` / Streamer.bot-Aktionen für `fight_cmd`, `spacefight_result`, `sf_status`

Aufgabe:
- Das Spiel ist ein Chat-basiertes Raumkampf-System, bei dem Viewer `!fight @gegner` auslösen.
- Die Spacefight-UI verbindet sich per WebSocket und registriert sich mit `gw_spacefight_register`.
- Der Client erhält `sf_status` vom WS, um zu wissen, ob der Stream live ist und Kämpfe zulässig sind.

Kernlogik im Browser:
- `parseCommand()` erkennt `!fight @user` und prüft:
  - Streamstatus (`streamLive`), aktiv über Streamer.bot oder Test/Force-Modus.
  - Chat-Präsenz des Zieles (letzte 5 Minuten aktive Nachrichten).
  - 30s Cooldown pro Angreifer.
- Wenn der Angriff zulässig ist, sendet der Client ein `spacefight_challenge` Event an Streamer.bot.
- Streamer.bot postet im Chat eine Herausforderung an den verteidigten User mit der Nachricht:
  „Willst du die Herausforderung annehmen (!ja) oder flüchten (!nein)?“
- Der Verteidiger kann mit `!ja` oder `!nein` antworten, was vom IRC-/Chat-Listener abgefangen und als `fight_accept` / `fight_decline` verarbeitet wird.
- Bei Annahme wird der Kampf in eine interne Queue gestellt und `nextFight()` gestartet.

Kampf-Engine:
- Zwei zufällige Schiffe werden gewählt, dann werden vier Runden simuliert.
- Treff- und Schadenswerte werden zufällig generiert und in einer kurzen Animation dargestellt.
- Der Kampf endet mit einem Sieger / Verlierer und einem `spacefight_result` Event.

Speichern und Auswertung:
- Nach dem Kampf wird das Ergebnis per POST an `/api/spacefight` gesendet.
- Der API-Server speichert Ergebnis und aktualisiert `spacefight_stats` in PostgreSQL.
- Ein Redis Sorted Set (`sfIndex`) wird mit Siegzahlen aktualisiert für Ranking/Leaderboard.

Wall of Fame / API:
- Die Spacefight-Seite lädt nach jedem Kampf die Bestenliste von `/api/spacefight/leaderboard`.
- Es gibt auch Endpunkte für einzelne Spielerstatistiken und Fight-Historie.

Integration mit Streamer.bot:
- Streamer.bot empfängt `spacefight_challenge`, `fight_accept`, `fight_decline`, `spacefight_rejected`, `spacefight_result` und sendet passende Chat-Nachrichten.
- Den Live-Status stellt ein Streamer.bot-Action `sf_status` sicher.
- Das Ergebnis landet am Ende wieder im Twitch-Chat über die Streamer.bot-Chat-Reply-Logik.

---

## Fazit

Die Architektur will erreichen, dass Streamer.bot nur als Event-Router dient und die eigentliche „Lösung“ in der Node.js-API liegt. Dadurch bleibt die Chat-/Overlay-Integration schlank, während die komplexen Giveaway-Regeln sauber zentralisiert sind.
