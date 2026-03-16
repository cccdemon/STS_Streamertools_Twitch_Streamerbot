# Chaos Crew – Giveaway System v4

HUD-styled Giveaway-System für Twitch Streams. Daten werden persistent in
Streamerbot Global Variables gespeichert. Die Web-Oberfläche läuft als
Docker-Container (Nginx) und kommuniziert per WebSocket mit Streamerbot.

---

## Schnellstart

### Voraussetzungen

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installiert
- [Streamerbot](https://streamer.bot) v1.0.4 oder neuer
- OBS Studio

### 1. Container starten

```bash
docker-compose up -d
```

Erreichbar unter: `http://localhost:8080`

### 2. Streamerbot einrichten

Öffne Streamerbot und lege **3 Actions** an:

#### Action 1: GW – Viewer Tick
| Feld     | Wert                        |
|----------|-----------------------------|
| Name     | GW – Viewer Tick            |
| Trigger  | Present Viewer              |
| Code     | `streamerbot/GW_A_ViewerTick.cs` |

#### Action 2: GW – Chat Message
| Feld     | Wert                           |
|----------|--------------------------------|
| Name     | GW – Chat Message              |
| Trigger  | Twitch → Chat Message          |
| Code     | `streamerbot/GW_B_ChatMessage.cs` |

#### Action 3: GW – WS Handler
| Feld     | Wert                              |
|----------|-----------------------------------|
| Name     | GW – WS Handler                   |
| Trigger  | Core → WebSocket → Custom Server → Custom Server Message |
| Code     | `streamerbot/GiveawayWS_Handler.cs` |

Für jede Action: Sub-Actions → Add → Core → C# Code → Execute Method: `Execute`

#### Custom WebSocket Server aktivieren
```
Streamerbot → Servers/Clients → WebSocket Servers → Add
Port:     9090
Name:     WebSocken  (oder beliebig)
Enabled:  ✓
```

### 3. OBS Browser Sources einrichten

| Source           | URL                                                                 | Größe       |
|------------------|---------------------------------------------------------------------|-------------|
| Giveaway Overlay | `http://localhost:8080/giveaway-overlay.html?host=HOST&port=9090`  | 320 × 400px |
| Join Animation   | `http://localhost:8080/giveaway-join.html?host=HOST&port=9090`     | 620 × 110px |
| HUD Chat         | `http://localhost:8080/chat.html?channel=DEIN_KANAL`               | beliebig    |

`HOST` = IP-Adresse des PCs mit Streamerbot (z.B. `192.168.178.39`)

**Wichtig:** In OBS → Browser Source → Hintergrundfarbe auf **transparent** stellen.

---

## Admin Panel

```
http://localhost:8080/giveaway-admin.html
```

Einstellungen im Panel (werden lokal gespeichert):
- **WS Host / Port**: IP und Port des Streamerbot Custom WS Servers
- **Minuten pro Ticket**: Watchtime-Schwelle für ein Ticket (Standard: 120 Min)

---

## Giveaway Ablauf

1. **Keyword setzen** (Admin Panel → Keyword // Teilnahme)
   - Beispiel: `!mitmachen`
   - Zuschauer schreiben das Keyword im Chat → werden registriert
   - Kein Keyword = alle Zuschauer nehmen automatisch teil

2. **Giveaway öffnen** → Button "ÖFFNEN"

3. Stream läuft → Tickets werden automatisch vergeben:
   - **1 Ticket pro 2 Stunden** Watchtime (nur wenn OBS streamt)
   - **1 Ticket pro 50 Chat-Nachrichten** (Spam-geschützt)

4. **Gewinner ziehen** → Button "GEWINNER ZIEHEN"
   - Gewinner wird im Overlay angezeigt (30 Sekunden)
   - Reroll möglich

5. **Giveaway schließen** → Button "SCHLIESSEN"

---

## Ticket-System

### Berechnung
```
Tickets = floor(watchSec / 7200) + floor(msgs / 50)
```

### Spam-Schutz (Chat-Nachrichten)
| Regel         | Wert                              |
|---------------|-----------------------------------|
| Mindestlänge  | 3 Zeichen                         |
| Cooldown      | 1 Nachricht pro 10 Sekunden zählt |
| Duplikat      | Gleiche Nachricht wie zuvor = 0   |

### Gewinnchancen
```
Chance(User) = Tickets(User) / Gesamt-Tickets × 100
```

---

## Testen

### Test Console (manuell)
```
http://localhost:8080/giveaway-test.html
```

Ermöglicht manuelles Senden aller WS-Events und Testen der Join-Animation,
Gewinner-Anzeige und Stream-Simulation.

### Automatische Test Suite
```
http://localhost:8080/tests/test-runner.html
```

Führt 11 automatisierte Tests durch:
- WS-Verbindung
- Daten abrufen
- Giveaway öffnen/schließen
- Tickets hinzufügen/entfernen
- Ban/Unban
- Keyword setzen
- Session-Registrierungen
- Reset

**Hinweis:** Tests modifizieren Daten in Streamerbot. Nicht während einem
aktiven Giveaway ausführen. Reset am Ende löscht alle Testdaten automatisch.

---

## Datei-Struktur

```
chaos-crew-giveaway/
├── docker-compose.yml          # Docker Compose Konfiguration
├── Dockerfile                  # Nginx-basiertes Container-Image
├── README.md                   # Diese Datei
├── nginx/
│   └── nginx.conf              # Nginx Server-Konfiguration
├── web/
│   ├── giveaway-admin.html     # Admin Panel (HTML)
│   ├── giveaway-admin.css      # Admin Panel (CSS)
│   ├── giveaway-admin.js       # Admin Panel (JS)
│   ├── giveaway-overlay.html   # OBS Overlay (HTML)
│   ├── giveaway-overlay.css    # OBS Overlay (CSS)
│   ├── giveaway-overlay.js     # OBS Overlay (JS)
│   ├── giveaway-join.html      # Join-Animation (HTML)
│   ├── giveaway-join.css       # Join-Animation (CSS)
│   ├── giveaway-join.js        # Join-Animation (JS)
│   ├── giveaway-test.html      # Test Console (HTML)
│   ├── giveaway-test.css       # Test Console (CSS)
│   ├── giveaway-test.js        # Test Console (JS)
│   ├── chat.html               # HUD Chat (HTML)
│   ├── chat.css                # HUD Chat (CSS)
│   └── chat.js                 # HUD Chat (JS)
├── streamerbot/
│   ├── GW_A_ViewerTick.cs      # Action: Viewer Tick
│   ├── GW_B_ChatMessage.cs     # Action: Chat Message
│   └── GiveawayWS_Handler.cs   # Action: WebSocket Handler
└── tests/
    ├── test-runner.html         # Test Suite UI
    └── tests.js                 # Test Suite Logik
```

---

## Streamerbot Global Variables (Referenz)

| Variable            | Typ    | Persistent | Beschreibung                    |
|---------------------|--------|------------|---------------------------------|
| `gw_open`           | string | ja         | `"true"` / `"false"`            |
| `gw_keyword`        | string | ja         | Teilnahme-Keyword               |
| `gw_index`          | string | ja         | JSON-Array aller User-Keys      |
| `gw_u_{username}`   | string | ja         | JSON User-Objekt                |
| `gw_overlay_session`| string | nein       | Session-ID des Overlays         |
| `gw_join_session`   | string | nein       | Session-ID der Join-Animation   |
| `gw_lastmsg_{user}` | string | nein       | Letzte Chat-Nachricht (Duplikat)|
| `gw_lasttime_{user}`| string | nein       | Letzter Chat-Timestamp          |

### User-Objekt Format
```json
{
  "display":    "Username",
  "watchSec":   3600,
  "msgs":       42,
  "tickets":    1,
  "banned":     false,
  "registered": true
}
```

---

## WebSocket Event-Protokoll

### Client → Streamerbot

| Event              | Parameter              | Beschreibung                  |
|--------------------|------------------------|-------------------------------|
| `gw_get_all`       | –                      | Alle Teilnehmer abrufen       |
| `gw_overlay_register` | –                   | Overlay-Session registrieren  |
| `gw_join_register` | –                      | Join-Overlay Session reg.     |
| `gw_cmd`           | `cmd`, `user?`, `keyword?` | Admin-Befehl ausführen    |

### gw_cmd Befehle

| cmd               | Parameter | Beschreibung           |
|-------------------|-----------|------------------------|
| `gw_open`         | –         | Giveaway öffnen        |
| `gw_close`        | –         | Giveaway schließen     |
| `gw_add_ticket`   | `user`    | Ticket hinzufügen      |
| `gw_sub_ticket`   | `user`    | Ticket entfernen       |
| `gw_ban`          | `user`    | User bannen            |
| `gw_unban`        | `user`    | User entbannen         |
| `gw_set_keyword`  | `keyword` | Keyword setzen         |
| `gw_get_keyword`  | –         | Keyword abrufen        |
| `gw_reset`        | –         | Alle Daten löschen     |

### Streamerbot → Client

| Event        | Beschreibung                            |
|--------------|-----------------------------------------|
| `gw_data`    | Vollständige Teilnehmerliste            |
| `gw_status`  | Giveaway-Status (open/closed)           |
| `gw_ack`     | Bestätigung einer Aktion                |
| `gw_keyword` | Aktuelles Keyword                       |
| `gw_overlay` | Overlay-Update vom Admin-Panel          |
| `gw_join`    | Neuer Teilnehmer (Join-Animation)       |

---

## Häufige Probleme

**WS: OFFLINE im Admin Panel**
- Streamerbot läuft? Custom WS Server auf Port 9090 aktiv?
- Firewall blockiert Port 9090?
- Host-IP korrekt in den Einstellungen?

**Overlay zeigt nichts in OBS**
- Browser Source URL korrekt? `host=` Parameter gesetzt?
- In OBS: Browser Source → Interact → F12 → Console auf Fehler prüfen
- Overlay muss sich einmal registriert haben (kurz im Browser öffnen)

**Tickets zählen nicht hoch**
- Ist OBS live? `CPH.ObsIsStreaming(0)` muss true sein
- Ist das Giveaway geöffnet? (`gw_open = "true"`)
- Keyword gesetzt? User muss Keyword zuerst geschrieben haben

**Tests schlagen fehl**
- Streamerbot Custom WS Server aktiv?
- Alle 3 Actions angelegt und aktiviert?
- Kein aktives Giveaway während Tests laufen lassen

---

## Docker Befehle

```bash
# Starten
docker-compose up -d

# Stoppen
docker-compose down

# Nach Datei-Änderungen neu bauen
docker-compose up -d --build

# Logs anzeigen
docker-compose logs -f

# Container-Status
docker-compose ps

# Shell im Container
docker exec -it chaos-crew-giveaway sh
```

---

*Chaos is a Plan. o7*
