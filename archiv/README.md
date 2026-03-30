# Chaos Crew – Giveaway System v4

HUD-styled Giveaway-System für Twitch Streams mit Chat-Game (Raumkampf),
Wall of Fame, Debug-Console und vollständiger Input-Validierung.
Daten persistent in Redis gespeichert, Web-Oberfläche als Docker-Container,
Kommunikation per WebSocket mit Streamerbot.

---

## Schnellstart

### Voraussetzungen

- [Docker](https://www.docker.com/products/docker-desktop/) installiert
- [Streamerbot](https://streamer.bot) v1.0.4 oder neuer
- OBS Studio

### 1. Konfigurieren

```bash
cp .env.example .env
# .env anpassen: SB_HOST = IP des PCs mit Streamerbot
```

### 2. Container starten

```bash
docker compose up -d --build
```

Control Center: `http://<SERVER-IP>/`  
Redis Admin:    `http://<SERVER-IP>:8081/`

### 3. Streamerbot einrichten

Alle C# Actions sind unter `http://<SERVER-IP>/streamerbot.html` mit Copy-Button abrufbar.

Lege **6 Actions** in Streamerbot an:

| Action | Trigger | Datei |
|---|---|---|
| GW – Viewer Tick | Twitch → Present Viewer | `GW_A_ViewerTick.cs` |
| GW – Chat Message | Twitch → Chat Message (alle) | `GW_B_ChatMessage.cs` |
| GW – WS Handler | Core → WebSocket → Custom Server Message | `GiveawayWS_Handler.cs` |
| Spacefight – Result Handler | Core → WebSocket → Custom Server Message | `Spacefight_Handler.cs` |
| Spacefight – Chat Forwarder | Twitch → Chat Message (Filter: `!fight`) | `SF_ChatForwarder.cs` |
| Spacefight – Stream Status | Twitch → Stream Online + Stream Offline | `SF_StreamStatus.cs` |

Für jede Action: Sub-Actions → Add → Core → **C# Execute Code** → Methode: `Execute`

#### Custom WebSocket Server aktivieren

```
Streamerbot → Servers/Clients → WebSocket Servers → Add
Port:    9090
Name:    WebSocken
Enabled: checked
```

#### Stream Status Action einrichten

Die `SF_StreamStatus`-Action braucht **zwei Trigger** in Streamerbot:
- Twitch → Stream Online → Action ausführen
- Twitch → Stream Offline → Action ausführen

### 4. OBS Browser Sources einrichten

| Source | URL | Größe |
|---|---|---|
| Giveaway Overlay | `http://SERVER/giveaway-overlay.html?host=SB_IP&port=9090` | 320 × 400 px |
| Join Animation | `http://SERVER/giveaway-join.html?host=SB_IP&port=9090` | 620 × 110 px |
| HUD Chat | `http://SERVER/chat.html?channel=DEIN_KANAL` | beliebig |
| Raumkampf | `http://SERVER/spacefight.html?host=SB_IP&port=9090&apihost=SERVER` | 640 × 200 px |

`SERVER` = IP des LXC/Docker-Hosts (z.B. `192.168.178.34`)  
`SB_IP`  = IP des PCs mit Streamerbot (z.B. `192.168.178.39`)

**Wichtig:** `apihost=` muss beim Raumkampf explizit auf die SERVER-IP gesetzt werden,
da `host=` auf die Streamerbot-IP zeigt und die API dort nicht läuft.

---

## Giveaway Ablauf

1. **Keyword setzen** → Admin Panel → Keyword eingeben (z.B. `!mitmachen`)
2. **Giveaway öffnen** → Button "ÖFFNEN"
3. Stream läuft, Tickets werden automatisch vergeben (nur wenn OBS live)
4. **Gewinner ziehen** → Button "GEWINNER ZIEHEN" → Overlay zeigt Gewinner 30s
5. **Giveaway schließen** → Button "SCHLIESSEN"

---

## Ticket-System

### Berechnung (Dezimalwerte)

```
Tickets = watchSec / 7200
```

Watchtime wird nur für **registrierte Teilnehmer** gezählt (Keyword erforderlich).

| Quelle | Zuwachs |
|---|---|
| 1 Minute Watchtime (Viewer Tick) | +60s |
| 1 Chat-Nachricht | +5s Watchtime |
| 2 Stunden Watchtime | = 1.0 Ticket |
| 1 Stunde Watchtime | = 0.5 Ticket |

### Spam-Schutz

| Regel | Wert |
|---|---|
| Mindestlänge | 3 Zeichen |
| Cooldown | max 1 Nachricht pro 10 Sekunden |
| Duplikat | gleiche Nachricht wie zuvor wird ignoriert |
| Bots | streamelements, nightbot u.a. werden ignoriert |

### InvariantCulture-Fix (deutsches Windows)

Auf deutschen Windows-Systemen interpretiert `Convert.ToDouble("1.0000")` den Punkt
als Tausendertrennzeichen. Alle Parse-Operationen nutzen daher `GetDbl()` mit
`CultureInfo.InvariantCulture`. Tickets werden als String `"1.0000"` gespeichert.

---

## Raumkampf (Spacegame)

Chat-Game für Twitch-Zuschauer. Ergebnisse werden in Redis gespeichert und in
einer Wall of Fame (Best Space Pilots) angezeigt.

### Starten

```
!fight @username
```

### Voraussetzungen für einen Kampf

| Bedingung | Beschreibung |
|---|---|
| Stream läuft | Streamerbot meldet `sf_status live=true` |
| Gegner im Chat aktiv | Gegner hat in den letzten **5 Minuten** geschrieben |
| Cooldown eingehalten | 30 Sekunden pro Angreifer |
| Kein Selbst-Fight | Angreifer darf nicht Verteidiger sein |

Wenn eine Bedingung nicht erfüllt ist, postet Streamerbot eine Meldung:

```
# Stream offline:
@User Kein Treibstoff, keine Munition – der Hangar ist offline!

# Gegner nicht im Chat:
@User Kein Kontakt zu Gegner. Ziel ist nicht in Reichweite!
```

### Wall of Fame (OBS Overlay)

- Erscheint automatisch nach jedem Kampf für **15 Sekunden**
- Zeigt Top-10 Piloten: Rang, Wins, Losses, Winrate
- Sieger wird hervorgehoben
- Schließt automatisch nach 15s, manuell mit X-Button

### Raumkampf Admin Panel

URL: `http://SERVER/spacefight-admin.html`

- Wall of Fame Tabelle mit Medals
- Kampf-Historie (letzte 20 Kämpfe)
- Spieler-Suche mit Rang und Stats
- Reset mit Bestätigungs-Dialog
- Auto-Refresh alle 30 Sekunden

### Schiffsklassen

| Schiff | Stärke |
|---|---|
| Perseus, Hammerhead, Vanguard | Stark |
| Constellation, Arrow, Origin 300i, Gladius, Sabre, Hornet | Mittel |
| Aurora | Schwach |

### OBS Browser Source Parameter

| Parameter | Beschreibung |
|---|---|
| `host=` | Streamerbot WS-IP |
| `port=` | Streamerbot WS-Port (Standard: 9090) |
| `apihost=` | Docker-Host-IP für API/Redis |
| `apiport=` | API-Port (Standard: 3000) |
| `test=1` | Test-Modus: Demo-Kämpfe, kein Stream-Check |

---

## Web-Oberflächen

| URL | Beschreibung |
|---|---|
| `/` | Control Center |
| `/giveaway-admin.html` | Giveaway Admin Panel |
| `/stats.html` | Statistiken |
| `/giveaway-test.html` | Test Console |
| `/spacefight-admin.html` | Raumkampf Admin (WoF, Historie, Reset) |
| `/tests/test-runner.html` | Automatische Test Suite |
| `/streamerbot.html` | C# Actions mit Copy-Button |

### Debug Console

Jede Admin-Seite hat eine Debug Console am unteren Rand (28px, immer sichtbar).
Klick öffnet das Panel mit vollständigem WS- und HTTP-Traffic-Log:

- Pfeil cyan = ausgehend (WS Send / HTTP Request)
- Pfeil grün = eingehend (WS Receive / HTTP Response)
- X rot = Fehler / Disconnect
- Punkt gold = Connect / Disconnect Info

Klick auf eine Zeile expandiert das JSON. Filter-Feld für Live-Suche.

---

## Sicherheit

| Layer | Schutz |
|---|---|
| Browser (`validate.js`) | XSS-Escaping, Prototype-Pollution-Block, WS-Whitelist, URL-Param-Sanitierung |
| Node.js API | `safeJsonParse()`, Username-Regex, Längenlimits |
| C# (Streamerbot) | Regex auf Usernames, Control-Char-Strip, max 500 Zeichen Messages |

---

## Infrastruktur

### Ports

| Port | Dienst |
|---|---|
| `80` | Web (Caddy) |
| `443` | HTTPS (wenn DOMAIN gesetzt) |
| `3000` | Node.js API |
| `8081` | Redis Commander |

### SSL

```bash
# HTTP only (Standard)
DOMAIN=

# Let's Encrypt SSL
DOMAIN=stream.example.com
CADDY_CONFIG=Caddyfile.ssl
```

### Backup

```bash
# Automatisch täglich 03:00 Uhr
# Manuell:
docker exec chaos-crew-backup /backup.sh
```

Aufbewahrung: 30 Tage (`KEEP_DAYS` in `.env`)

### Docker Befehle

```bash
docker compose up -d --build          # Alles starten/neu bauen
docker compose up -d --build web      # Nur Web (CSS/HTML/JS)
docker compose up -d --build api      # Nur API (server.js)
docker compose logs -f                # Logs
docker compose down                   # Stoppen (Daten bleiben)
docker compose down -v                # Stoppen + Daten löschen
```

---

## Streamerbot Global Variables

| Variable | Persistent | Beschreibung |
|---|---|---|
| `gw_open` | ja | Giveaway offen/geschlossen |
| `gw_keyword` | ja | Teilnahme-Keyword |
| `gw_index` | ja | JSON-Array User-Keys |
| `gw_u_{username}` | ja | JSON User-Objekt |
| `gw_overlay_session` | nein | Session-ID Overlay |
| `gw_join_session` | nein | Session-ID Join-Animation |
| `gw_api_session` | nein | Session-ID Node.js API |
| `gw_spacefight_session` | nein | Session-ID Raumkampf |
| `sf_stream_live` | nein | Stream-Status für Raumkampf |
| `sf_last_{w}_{l}` | nein | Dedup-Key Kampfergebnisse |

---

## Redis Key Schema

| Key | Typ | Beschreibung |
|---|---|---|
| `gw_open` / `gw_keyword` / `gw_index` | String | Giveaway-State |
| `gw_u_{username}` | String | JSON User-Objekt |
| `api:session:{id}` | Hash | Session-Metadaten |
| `api:winners` | List | Gewinner-History |
| `api:stats:{username}` | Hash | Lifetime User-Stats |
| `sf:stats:{username}` | Hash | Raumkampf-Stats |
| `sf:index` | Sorted Set | Rangliste (Score = Wins) |
| `sf:history` | List | Letzte 500 Kämpfe |

---

## REST API

### Giveaway

| Method | Endpoint | Beschreibung |
|---|---|---|
| GET | `/health` | Status |
| GET | `/api/participants` | Teilnehmer |
| GET | `/api/winners` | Gewinner-History |
| GET | `/api/leaderboard` | Watchtime-Rangliste |
| GET | `/api/user/:username` | User-Stats |

### Raumkampf

| Method | Endpoint | Beschreibung |
|---|---|---|
| POST | `/api/spacefight` | Kampfergebnis speichern |
| GET | `/api/spacefight/leaderboard` | Wall of Fame |
| GET | `/api/spacefight/player/:username` | Spieler-Stats + Rang |
| GET | `/api/spacefight/history` | Kampf-Historie |
| POST | `/api/spacefight/reset` | Reset |

---

## Häufige Probleme

**Raumkampf: keine Reaktion auf !fight**
- `SF_ChatForwarder.cs` eingespielt? Trigger: Twitch Chat Message, Filter: `!fight`
- `SF_StreamStatus.cs` konfiguriert mit Stream Online/Offline Trigger?
- Debug Console: kommen `chat_msg` Events an der Browser Source an?
- URL enthält `?host=SB_IP&port=9090&apihost=SERVER-IP`?

**Wall of Fame erscheint nicht**
- `apihost=` Parameter gesetzt? API unter `http://SERVER:3000/health` erreichbar?
- Kämpfe bereits stattgefunden? `spacefight-admin.html` prüfen

**Kampf-Ergebnis doppelt im Chat**
- `Spacefight_Handler.cs` neu einspielen (enthält Deduplication)

**WS: OFFLINE**
- Streamerbot WS Server Port 9090 aktiv? Firewall?

**Tickets = 10000 statt 1**
- Deutsches Windows: `GiveawayWS_Handler.cs` neu einspielen (InvariantCulture-Fix)

---

## Dateistruktur

```
chaos-crew-giveaway/
├── docker-compose.yml
├── Dockerfile                    # Caddy Web Server
├── .env.example
├── caddy/                        # Caddyfile (HTTP + SSL)
├── api/server.js                 # Node.js API + Spacefight Endpoints
├── redis/redis.conf
├── backup/backup.sh
├── web/
│   ├── validate.js               # Input Validation (alle Seiten)
│   ├── nav.css/js                # Navigation + Debug Console
│   ├── giveaway-admin.*          # Giveaway Admin
│   ├── giveaway-overlay.*        # OBS Overlay
│   ├── giveaway-join.*           # Join Animation
│   ├── giveaway-test.*           # Test Console
│   ├── spacefight.*              # Raumkampf OBS Overlay + WoF
│   ├── spacefight-admin.*        # Raumkampf Admin Panel
│   ├── chat.*                    # HUD Chat
│   ├── stats.*                   # Statistiken
│   └── streamerbot.html          # C# Actions Viewer
├── streamerbot/
│   ├── GW_A_ViewerTick.cs
│   ├── GW_B_ChatMessage.cs
│   ├── GiveawayWS_Handler.cs
│   ├── Spacefight_Handler.cs
│   ├── SF_ChatForwarder.cs       # NEU: !fight → Overlay
│   └── SF_StreamStatus.cs        # NEU: Stream Online/Offline
└── tests/
    └── tests.js
```

---

*Chaos is a Plan. o7*
