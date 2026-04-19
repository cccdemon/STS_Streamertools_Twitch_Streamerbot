# Installation – Chaos Crew Streamer Tools

Diese Anleitung beschreibt, wie OBS-Overlays und Streamerbot-Actions eingerichtet werden, damit das komplette System live läuft.

---

## OBS Layout – Einrichtungsanleitung

Basis-URL: `http://192.168.178.34` (LXC Host mit Caddy auf Port 80)

### Schritte für jedes Overlay

1. Rechtsklick in Szene → **Hinzufügen** → **Browserquelle**
2. Name vergeben → **OK**
3. URL aus Tabelle eintragen, Breite/Höhe gemäß Spalte
4. **„Audio über OBS steuern"** aktivieren (wichtig für Alert-Sounds im OBS-Mixer)
5. **„Shutdown source when not visible"** AUS, **„Refresh browser when scene becomes active"** AN

### Overlays

| Overlay | URL | Empf. Größe | Szene |
|---|---|---|---|
| Giveaway Overlay | `http://192.168.178.34/giveaway/giveaway-overlay.html` | 1920×1080 | Main / Gaming |
| Giveaway Join-Animation | `http://192.168.178.34/giveaway/giveaway-join.html` | 1920×1080 | Main / Gaming |
| Spacefight | `http://192.168.178.34/spacefight/spacefight.html` | 1920×1080 | Main / Gaming |
| HUD Chat | `http://192.168.178.34/alerts/chat.html?channel=justcallmedeimos` | 450×1080 (rechte Seite) | Main / Gaming |
| Alert Bar (Follow/Sub/Bits/Raid…) | `http://192.168.178.34/alerts/alerts.html` | 1920×200 (unten) | ALLE Szenen |
| Raid-Info Panel | `http://192.168.178.34/alerts/raid-info.html` | 600×1080 (rechts) | Main |
| Shoutout Panel | `http://192.168.178.34/alerts/shoutout-info.html` | 600×1080 (rechts) | Main |

### Testmodus

Für Einrichtung ohne Live-Event Quelle duplizieren und zusätzlichen Parameter anhängen:

- `spacefight.html?test=1`
- `giveaway-join.html?test=1`
- `raid-info.html?test=raid&user=TestRaider&viewers=42`
- `shoutout-info.html?test=shoutout&user=TestStreamer&game=Star+Citizen`

### Hinweise

- Alert Bar immer **ganz oben** in der Szenen-Reihenfolge legen, damit sie andere Overlays überdeckt.
- Optional: `?wshost=` und `?wsport=` setzen, falls die API über einen anderen Host erreichbar ist.

---

## Streamerbot Actions – Einrichtungsanleitung

### 1. WebSocket-Server einrichten (EINMALIG)

Streamerbot → **Servers/Clients** → **WebSocket Server** → Tab **Server** (NICHT Clients!)

- **Enabled:** ✅
- **Address:** `0.0.0.0`
- **Port:** `9090`
- **Endpoint:** `/` (leer lassen)
- **Index:** muss **0** sein (erster Eintrag in der Liste) — alle C# Actions senden mit Index `0`

Server starten. Die Bridge (LXC, 192.168.178.34) verbindet sich als Client und schickt `cc_api_register`.

### 2. Actions anlegen

Für **jede** `.cs`-Datei aus `streamerbot/`:

1. **Actions** → **Add** → Name wie in Tabelle („CC – …", „GW – …")
2. **Queue:** siehe Tabelle (sehr wichtig wegen Reihenfolge)
3. **Sub-Action hinzufügen** → **Core → Execute C# Code**
4. Inhalt der `.cs`-Datei **komplett** einfügen → **Compile** → muss grün sein
5. Oben **Triggers** Tab → Trigger gemäß Tabelle hinzufügen

### 3. Actions-Tabelle

| Datei | Action Name | Trigger | Queue |
|---|---|---|---|
| [CC_ApiRegister.cs](streamerbot/CC_ApiRegister.cs) | CC – API Register | **WebSocket Server** → **Message** (Filter: `event` = `cc_api_register`) | `cc-core` |
| [CC_ChatReply.cs](streamerbot/CC_ChatReply.cs) | CC – Chat Reply Handler | **WebSocket Server** → **Message** (Filter: `event` = `chat_reply`) | `cc-chat` |
| [CC_AlertRegister.cs](streamerbot/CC_AlertRegister.cs) | CC – Alert Register | **WebSocket Server** → **Open** | `cc-core` |
| [CC_Follow.cs](streamerbot/CC_Follow.cs) | CC – Follow | **Twitch → Follow** | `cc-alerts` |
| [CC_Cheer.cs](streamerbot/CC_Cheer.cs) | CC – Cheer/Bits Alert | **Twitch → Cheer** | `cc-alerts` |
| [CC_RaidBroadcaster.cs](streamerbot/CC_RaidBroadcaster.cs) | CC – Raid Broadcaster | **Twitch → Raid** | `cc-alerts` |
| [CC_Shoutout.cs](streamerbot/CC_Shoutout.cs) | CC – Shoutout | **Core → Command** → `!so` (Berechtigung: Moderator/Broadcaster) | `cc-chat` |
| [CC_FirstChatter.cs](streamerbot/CC_FirstChatter.cs) | CC – First Time Chatter | **Twitch → First Word** | `cc-chat` |
| [CC_ClipCreated.cs](streamerbot/CC_ClipCreated.cs) | CC – Clip Created | **Twitch → Clip Created** | `cc-chat` |
| [CC_AdBreakStart.cs](streamerbot/CC_AdBreakStart.cs) | CC – Ad Break Start | **Twitch → Ad Break Begin** | `cc-chat` |
| [CC_AdBreakEnd.cs](streamerbot/CC_AdBreakEnd.cs) | CC – Ad Break End | **Twitch → Ad Break End** | `cc-chat` |
| [GW_A_ViewerTick.cs](streamerbot/GW_A_ViewerTick.cs) | GW – Viewer Tick | **Twitch → Present Viewer** | `gw-tick` |
| [GW_B_ChatMessage.cs](streamerbot/GW_B_ChatMessage.cs) | GW – Chat Message | **Twitch → Chat Message** (keine Filter) | `gw-chat` |
| [GW_TimeInfo.cs](streamerbot/GW_TimeInfo.cs) | GW – Time Info | **Core → Command** → `!time` UND `!coin` | `gw-chat` |
| [GW_Leaderboard.cs](streamerbot/GW_Leaderboard.cs) | GW – Leaderboard | **Core → Command** → `!top` | `gw-chat` |

### 4. Queues anlegen

Streamerbot → **Queues** → **Add** für jede Queue aus Tabelle:

| Queue | Concurrent | Zweck |
|---|---|---|
| `cc-core` | 1 | Session-Register, darf nie parallel laufen |
| `cc-alerts` | 1 | Alerts sequenziell – verhindert überlappende Sounds |
| `cc-chat` | 2 | Chat-Antworten, niedrige Latenz OK |
| `gw-tick` | 1 | Viewer-Ticks alle X Sek, nie stauen |
| `gw-chat` | 2 | `!time`, `!top`, Chat-Messages parallel |

### 5. Funktionsprüfung

1. Docker-Stack auf LXC starten → Bridge verbindet sich zu `ws://192.168.178.39:9090`
2. In Streamerbot-Logs sollte `[CC] API registriert – Session: …` erscheinen
3. Test: `!time` im Chat → `GW – Time Info` antwortet → Chat-Reply über `CC – Chat Reply Handler`
4. Health-Check im Browser öffnen: `http://192.168.178.34/health`

### Troubleshooting

- **Alle Actions loggen `WARNUNG: cc_api_session nicht gesetzt!`**
  → `CC – API Register` läuft nicht, Queue falsch, oder Trigger-Filter stimmt nicht. Zuerst diese Action prüfen.
- **Overlay lädt, aber keine Events kommen an**
  → WebSocket-Server-Index in Streamerbot prüfen (muss `0` sein), Bridge-Logs prüfen (`docker-compose logs -f bridge`).
- **Keine Sounds in OBS**
  → „Audio über OBS steuern" in der Browserquelle aktivieren.
