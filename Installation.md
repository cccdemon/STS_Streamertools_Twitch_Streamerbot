# Installation – RDOC Streamer Tools

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
| Alerts (Follow/Sub/Bits/Raid/Shoutout/`!id` — **alles**) | `http://192.168.178.34/alerts/overlay.html` | 2560×1440 | ALLE Szenen |
| Spacefight | `http://192.168.178.34/spacefight/spacefight.html` | 1920×1080 oder 2560×1440 | Main / Gaming |
| HUD Chat | `http://192.168.178.34/alerts/chat.html?channel=justcallmedeimos` | 450×1080 (rechte Seite) | Main / Gaming |
| Hauling | `http://192.168.178.34/alerts/haul.html` | 2560×1440 | Main / Gaming |
| Bodycam-Szene | `http://192.168.178.34/gamescenes/sc-bodycam.html?player=Name` | 1920×1080 | Szenenwechsel |

> **`alerts.html`, `raid-info.html` und `shoutout-info.html` gibt es nicht mehr.**
> Sie liefern 404. Alle Alert-Typen rendert heute `overlay.html` — eine einzige
> Browserquelle statt drei. Wer die alten URLs noch in einer Szene hat, sieht
> dort dauerhaft nichts, egal was deployt wird.

> **Spacefight-Quelle:** Position 0/0, Größe = volle Leinwand. Die Seite baut in
> einem 1920×1080-Designraum und skaliert sich selbst auf die Quelle, der Kampf
> sitzt mittig, die Bestenliste am Bildrand. Eine 640×200-Quelle ist der alte
> Stand und schneidet heute ab.

### Testmodus

Für Einrichtung ohne Live-Event Quelle duplizieren und Parameter anhängen:

- `spacefight.html?test=1` — lokaler Testkampf
- `spacefight.html?scale=2` — Duell doppelt so groß
- `spacefight.html?wof=left` — Bestenliste an den linken Rand
- `overlay.html?demo=1` — Demo-Panel mit Knöpfen für jeden Alert-Typ
- `haul.html?demo=1` — Beispiel-Hauls im Loop

Alerts lassen sich auch aus dem Admin testen: `/admin/alerts-test.html`.

### Hinweise

- Alert-Overlay immer **ganz oben** in der Szenen-Reihenfolge, damit es die anderen überdeckt.
- Streamerbot-Host im Alert-Overlay ist fest eingebaut; pro Quelle überschreibbar mit `?sb=ws://host:port`.

### Nach einem Deploy: Quelle wirklich neu laden

Caddy schickt `Cache-Control: no-cache`, aber der Browser in OBS hält die Seite
trotzdem im eigenen Cache. Ein Szenenwechsel oder Quelle aus/an reicht nicht.

1. Quelle → **Eigenschaften** → **Cache der aktuellen Seite aktualisieren**
2. Bleibt es alt: die URL im normalen Browser auf dem Stream-PC öffnen. Sieht es
   dort neu aus, war es der OBS-Cache. Sieht es dort auch alt aus, zeigt die
   Quelle auf eine andere Adresse als den Server.

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

### 4. Queues anlegen

Streamerbot → **Queues** → **Add** für jede Queue aus Tabelle:

| Queue | Concurrent | Zweck |
|---|---|---|
| `cc-core` | 1 | Session-Register, darf nie parallel laufen |
| `cc-alerts` | 1 | Alerts sequenziell – verhindert überlappende Sounds |
| `cc-chat` | 2 | Chat-Antworten, niedrige Latenz OK |

### 5. Funktionsprüfung

1. Docker-Stack auf LXC starten → Bridge verbindet sich zu `ws://192.168.178.39:9090`
2. In Streamerbot-Logs sollte `[CC] API registriert – Session: …` erscheinen
3. Test: `!fight @user` im Chat → `SF – Fight Cmd` antwortet → Chat-Reply über `CC – Chat Reply Handler`
4. Health-Check im Browser öffnen: `http://192.168.178.34/health`

### Troubleshooting

- **Alle Actions loggen `WARNUNG: cc_api_session nicht gesetzt!`**
  → `CC – API Register` läuft nicht, Queue falsch, oder Trigger-Filter stimmt nicht. Zuerst diese Action prüfen.
- **Overlay lädt, aber keine Events kommen an**
  → WebSocket-Server-Index in Streamerbot prüfen (muss `0` sein), Bridge-Logs prüfen (`docker-compose logs -f bridge`).
- **Keine Sounds in OBS**
  → „Audio über OBS steuern" in der Browserquelle aktivieren.
