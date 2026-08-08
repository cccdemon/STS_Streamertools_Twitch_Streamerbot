# RDOC — Streamer Tools

Twitch-Streamer-Toolset: Spacefight Chat-Game, HUD-Chat-Overlay, Alert-Overlays und Streamerbot-C#-Actions als dockerisierter Microservice-Stack.

Oberflaeche und Overlays folgen dem **RDOC Brand Kit** — siehe [Branding](#branding-rdoc-brand-kit).

---

## Was steckt drin

| Modul | Was es tut |
|---|---|
| **Spacefight** | Chat-Command `!fight @user`, animiertes OBS-Battle-Overlay, Win/Loss-Leaderboard |
| **Alerts** | Follow / Sub / Cheer / Raid / Shoutout-Overlays mit Sound + Claude-AI-Zusammenfassungen |
| **HUD Chat** | Twitch-Chat als Sci-Fi-OBS-Overlay |
| **Stats** | Read-only Wall of Fame & Kampf-Historie aus PostgreSQL |
| **Admin** | Aggregiertes Dashboard, Health-Check, Test-Konsolen |
| **Streamerbot Actions** | 22 C#-Actions die Twitch-Events in den Stack einspeisen und Replies senden |

---

## Architektur

```
┌─ Twitch ────────────────────────────────────────────────────────┐
│ Chat / Present Viewers / Follow / Sub / Cheer / Raid / IRC      │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌─ Heim-PC ───────────────────────────────┐    ┌─ Server (Docker) ────────────┐
│  Streamerbot 1.0.4  WS-Server :9090 ◄───┼────┼─ cc-bridge      :3000        │
│    └─ 22 C# Actions (siehe streamerbot/)│    │   (WS-Client → Redis Pub/Sub)│
│  OBS Studio  Browser-Sources ───────────┼────┼─► cc-web (Caddy) :80 / :443  │
└─────────────────────────────────────────┘    │   ├─► cc-spacefight :3002    │
                                               │   ├─► cc-alerts     :3003    │
                                               │   ├─► cc-stats      :3004    │
                                               │   └─► cc-admin      :3005    │
                                               │  cc-redis      :6379         │
                                               │  cc-postgres   :5432         │
                                               │  cc-backup     (cron 03:00)  │
                                               └──────────────────────────────┘
```

**Kommunikations-Flow:**
- Streamerbot ist **WS-Server** (`:9090`), Bridge ist **Client**, verbindet sich rein und hört auf Custom-Server-Messages.
- Bridge fan-outt eingehende Events nach Redis Pub/Sub-Channels (`ch:spacefight`, `ch:alerts`, `ch:chat`, `ch:chat_reply`).
- Services subscriben auf ihre Channels und broadcasten an verbundene Browser-Clients (Admin-Panels, OBS-Overlays) via eigene WS-Endpoints.
- Outbound geht alles über `ch:chat_reply` → Bridge → Streamerbot → Twitch.

Vollständige Detail-Architektur: siehe [CLAUDE.md](CLAUDE.md).

---

## Requirements

### Server (Docker-Host)

| | Mindest | Empfohlen |
|---|---|---|
| OS | Linux mit cgroups v2 (Debian 12, Ubuntu 22.04+, Proxmox-LXC `privileged` für PG) | Debian 12 / Ubuntu 24.04 |
| CPU | 1 Core | 2 Cores |
| RAM | 1 GB | 2 GB |
| Disk | 5 GB (Container + DB-Volume) | 20 GB |
| Docker | 20+ | aktuelle Stable |
| Docker Compose | v2 (`docker compose`, nicht `docker-compose`) | v2 |
| Netz | TCP 80 (HTTP) bzw. 443 (HTTPS) inbound, Outbound zum Heim-PC `:9090` (WS) | dito |

> **LXC-Hinweis:** Postgres-Container muss `privileged: true` (siehe `docker-compose.yml`) wegen AppArmor-Restriktionen auf Unix-Sockets in unprivileged LXCs. Der `lxc-entrypoint.sh` in `postgres/` patcht `unix_socket_directories` auf `/tmp`.

### Heim-PC (Streaming-Setup)

| | Version |
|---|---|
| Streamer.bot | **1.0.4** (mit `Newtonsoft.Json.dll` als Reference) |
| OBS Studio | 29+ mit aktiviertem WebSocket Server (`obs-websocket` 5.x, default Port `4455`) |
| Twitch-Account | Broadcaster, optional zusätzlicher Bot-Account |
| Netz | Erreichbar vom Server über LAN/VPN — Streamerbot-WS auf `0.0.0.0:9090` binden, **nicht** loopback |

### Externe Dienste / API-Keys

| Dienst | Pflicht? | Wofür | `.env`-Variable |
|---|---|---|---|
| Twitch API (Helix) | Ja, für Alerts | User-Profile-Lookups (Avatar, Game, Bio) für Raid-/Shoutout-Panels | `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` |
| Anthropic API | Optional | AI-Zusammenfassungen in Raid-Info / Shoutout-Info-Overlays | `ANTHROPIC_KEY` |
| eigene Domain | Optional | HTTPS via Caddy + Let's Encrypt | `DOMAIN`, `CADDY_CONFIG=Caddyfile.ssl` |

### Browser-Clients

OBS-integrierter Chromium (CEF) reicht für alle Overlays — moderne WS- und CSS-Features werden vorausgesetzt (CSS-Grid, ES2020, WebSocket).

---

## Schnellstart (LAN, HTTP)

```bash
git clone <repo-url> rdoc-streamertools
cd rdoc-streamertools
cp .env.example .env
# .env anpassen — siehe Tabelle unten
docker compose up -d
curl http://localhost/health   # erwartet: alle Services "ok"
```

### `.env` — Pflichtfelder

```env
# Heim-PC (Streamerbot WS-Server)
SB_HOST=192.168.178.39
SB_PORT=9090

# PostgreSQL
PG_DB=chaoscrew
PG_USER=chaoscrew
PG_PASSWORD=<random>

# Redis-Commander (basicauth)
REDIS_UI_USER=chaos
REDIS_UI_PASSWORD=<random>

# Optional: Domain für HTTPS
DOMAIN=
CADDY_CONFIG=Caddyfile           # bzw. Caddyfile.ssl mit DOMAIN gesetzt

# Twitch & Claude (für Alerts)
TWITCH_CLIENT_ID=
TWITCH_CLIENT_SECRET=
ANTHROPIC_KEY=
```

### Verifikation

```bash
docker compose ps                          # alle "healthy"
curl http://localhost/health               # JSON aller Services
docker compose logs -f bridge              # erwartet: [SB] Connected
```

Browser: `http://<server>/` → leitet auf `/admin/` (Dashboard).

---

## Service-Übersicht

| Container | Port | Aufgabe |
|---|---|---|
| `cc-bridge` | 3000 | Streamerbot-WS-Client → Redis Pub/Sub Router |
| `cc-spacefight` | 3002 | Fight-Engine + REST + WS-Admin |
| `cc-alerts` | 3003 | Alert-Overlays + Claude-AI + REST + WS |
| `cc-stats` | 3004 | Read-only-Statistiken (REST, kein WS) |
| `cc-admin` | 3005 | Admin-Dashboard + aggregierter Health |
| `cc-web` (Caddy) | 80 / 443 | Reverse-Proxy, Path-Routing |
| `cc-postgres` | 5432 | persistente Daten |
| `cc-redis` | 6379 | Live-State (DB 0 = Prod, DB 1 = Tests) |
| `cc-redis-ui` | 8081 | Redis Commander |
| `cc-backup` | – | täglich 03:00, 30-Tage-Retention |

### Caddy Path-Routing

| Pfad | → Service |
|---|---|
| `/spacefight/*` | spacefight:3002 (REST + WS auf `/spacefight/ws`) |
| `/alerts/*` | alerts:3003 (REST + WS auf `/alerts/ws`) |
| `/stats/*` | stats:3004 (REST) |
| `/admin/*` | admin:3005 (statische Admin-Pages) |
| `/bridge/*` | bridge:3000 (Health) |
| `/health` | admin:3005 (aggregiert) |
| `/redis-ui/*` | redis-ui:8081 |
| `/` | Redirect → `/admin/` |

---

## Streamerbot einrichten

### WS-Server aktivieren

`Servers/Clients` → `WebSocket Server` → **Address** `0.0.0.0`, **Port** `9090`, **Auto-Start** an. Server starten — Status muss `Listening` sein.

### Actions importieren

Die 26 C#-Actions liegen unter [streamerbot/](streamerbot/). Für jede Action:

1. **Actions** → Rechtsklick → **Add** → exakter Name (siehe Tabelle).
2. **Add Sub-Action** → **Core** → **C# → Execute C# Code** → Inhalt aus `.cs` einfügen.
3. **Save & Compile** → muss `Compiled successfully!` zeigen.
4. Trigger setzen.

| # | Action-Name | Datei | Trigger | Queue | Command |
|---|---|---|---|---|---|
| 1 | CC – API Register | `CC_ApiRegister.cs` | WS Custom Server Message | – | – |
| 2 | CC – Chat Reply Handler | `CC_ChatReply.cs` | WS Custom Server Message | – | – |
| 3 | CC – Alert Register | `CC_AlertRegister.cs` | WS Custom Server Message | – | – |
| 4 | CC – Raid Broadcaster | `CC_RaidBroadcaster.cs` | Twitch Raid | – | – |
| 5 | CC – Follow | `CC_Follow.cs` | Twitch Follow | – | – |
| 6 | CC – Cheer | `CC_Cheer.cs` | Twitch Cheer | – | – |
| 7 | CC – Sub | `CC_Sub.cs` | Twitch Sub | – | – |
| 8 | CC – Resub | `CC_Resub.cs` | Twitch Resub | – | – |
| 9 | CC – SubGift | `CC_SubGift.cs` | Twitch SubGift | – | – |
| 10 | CC – SubBomb | `CC_SubBomb.cs` | Twitch CommunityGiftSub | – | – |
| 11 | CC – Redeem | `CC_Redeem.cs` | Channel Point Redeem | – | – |
| 12 | CC – Shoutout | `CC_Shoutout.cs` | Core Command | – | `!so` (Mod) |
| 13 | CC – First Chatter | `CC_FirstChatter.cs` | Twitch Chat Message | – | – |
| 14 | CC – Clip Created | `CC_ClipCreated.cs` | Clip Created | – | – |
| 15 | CC – Ad Break Start | `CC_AdBreakStart.cs` | Ad Break Start | – | – |
| 16 | CC – Ad Break End | `CC_AdBreakEnd.cs` | Ad Break End | – | – |
| 17 | SF – Fight Cmd | `SF_FightCmd.cs` | Core Command | – | `!fight` |
| 18 | SF – Challenge Accept | `SF_ChallengeAccept.cs` | Core Command | – | `!ja` |
| 19 | SF – Challenge Decline | `SF_ChallengeDecline.cs` | Core Command | – | `!nein` |
| 20 | SF – Chat Tracker | `SF_ChatTracker.cs` | Twitch Chat Message | – | – |
| 21 | SF – Stream Online | `SF_StreamOnline.cs` | Stream Online | – | – |
| 22 | SF – Stream Offline | `SF_StreamOffline.cs` | Stream Offline | – | – |

> **Queues:** Chat-Message-getriebene Actions feuern parallel für jede Nachricht — Non-Blocking-Queue verhindert Race-Conditions. Alle anderen Actions: Default/None.

> **Bekannter Tech-Debt:** Sub/Resub/SubGift/SubBomb sind getrennte Actions (`e81f770`, `bec98cc`); sollten zu einer konsolidiert werden.

### Twitch- und OBS-Connection

- `Platforms` → `Twitch` → `Accounts` → Broadcaster (+ optional Bot) verbinden, `Auto Connect` an.
- `Stream Apps` → `OBS` → `OBS v5 WebSocket` → `127.0.0.1:4455` + Passwort aus OBS, `Auto Connect on Startup` an.

> `SF – Chat Tracker` nutzt `CPH.ObsIsStreaming(0)` als Gate — ohne aktive OBS-Verbindung **werden keine Events gesendet**.

---

## OBS Browser-Sources

Domain in den URLs ersetzen (`<server>` = IP oder Domain).

| Overlay | URL | Größe |
|---|---|---|
| Spacefight | `http://<server>/spacefight/spacefight.html?channel=DEIN_KANAL` | 1920 × 1080 |
| HUD Chat | `http://<server>/alerts/chat.html?channel=DEIN_KANAL` | 500 × 600 |
| Alert Bar | `http://<server>/alerts/alerts.html` | 1920 × 200 |
| Raid Info | `http://<server>/alerts/raid-info.html` | 400 × 600 |
| Shoutout Info | `http://<server>/alerts/shoutout-info.html` | 400 × 600 |

> **Audio in OBS-Mixer:** in den Browser-Source-Properties **„Control audio via OBS"** aktivieren.
>
> **Test-Modi:** `?test=1` am Spacefight-Overlay → spielt Demo-Daten ab, ohne dass ein Stream laufen muss.

---

## Admin-Pages

| URL | Zweck |
|---|---|
| `/admin/` | Übersicht + Health |
| `/spacefight/spacefight-admin.html` | Spacefight aktivieren/deaktivieren, Spieler editieren/löschen, Reset |
| `/stats/stats.html` | Leaderboards, Session-Historie, Spacefight-Stats |
| `/redis-ui/` | Redis Commander (basicauth aus `.env`) |

---

## Entwicklung

### Pro Service

```bash
cd services/<name>
npm start                  # Production
npm run dev                # node --watch (auto-restart on change)
npm test                   # node --test tests/*.test.js (nutzt Redis DB 1, falls Tests existieren)
```

### Browser-Tests

`/admin/tests/test-runner.html` im Browser öffnen.

### Docker-Workflow

```bash
docker compose up -d --build           # Rebuild nach Code-Änderung
docker compose logs -f <service>       # Logs streamen
docker compose restart <service>       # Einzelnen Service neu starten
docker compose ps                      # Health-Status
```

### Code-Konventionen

- UI-Texte sind durchgehend deutsch.
- Admin-Pages laden `services/admin/public/admin-shared.js` als erstes Script (Nav, Debug-Konsole, `CC.validate`).
- Farbe und Schrift kommen ausschliesslich aus den RDOC-Tokens — siehe [Branding](#branding-rdoc-brand-kit). Kein Hex in HTML oder JS.
- OBS-Overlays laden `admin-shared.js` **nicht** (kein Nav, keine Konsole im Stream).
- Neue WS-Events / `sf_cmd` müssen in `ALLOWED_EVENTS` / `ALLOWED_CMDS` in `admin-shared.js` registriert werden.
- Logging: `log(tag, ...)` / `logErr(tag, ...)` aus jedem Service — kein direktes `console.log`.
- `sanitizeUsername(s)` (lowercase, alphanumerisch + `_`, max 25 Zeichen) muss C# ↔ JS identisch bleiben.

---

## Branding (RDOC Brand Kit)

Die gesamte Oberflaeche laeuft auf dem **RDOC Brand Kit**
(`RDOC-Brandkit/brandkit`, eigenes Repo). Es ist ein Generator: Farben,
Typografie und die Wortmarke werden dort aus `scripts/tokens.js`,
`geometry.js` und `svg.js` erzeugt. Dieses Projekt ist reiner Konsument.

### Was aus dem Kit kopiert wird

Jeder Service hat seinen eigenen Docker-Build-Context und kann nicht auf
das `public/` eines anderen Service zugreifen. Die Brand-Assets liegen
darum als Kopie in jedem `public/`:

| Datei | Quelle im Brand Kit | liegt in |
|---|---|---|
| `rdoc-brand.css` | `digital/web/brand.css` | admin, spacefight, stats, alerts |
| `favicon.svg` | `digital/web/favicon.svg` | admin, spacefight, stats, alerts |
| `favicon.ico` | `digital/web/favicon.ico` | admin, spacefight, stats, alerts |
| `rdoc-logo.svg` | `digital/logo/rdoc_logo_horizontal_dark.svg` | admin, spacefight, stats |
| `rdoc-logo-mono.svg` | `digital/logo/rdoc_logo_horizontal_mono-offwhite.svg` | admin, spacefight, stats |

`rdoc-brand.css` ist **generierter Code — nie von Hand editieren.** Aendert
sich das Kit, neu kopieren:

```bash
BK=../RDOC-Brandkit/brandkit
for s in admin spacefight stats alerts; do
  cp $BK/digital/web/brand.css   services/$s/public/rdoc-brand.css
  cp $BK/digital/web/favicon.svg services/$s/public/favicon.svg
  cp $BK/digital/web/favicon.ico services/$s/public/favicon.ico
done
md5sum services/*/public/rdoc-brand.css   # muessen identisch sein
```

### Farbrollen

| Rolle | Token | Verwendung im Projekt |
|---|---|---|
| Space `#121416` | `--rdoc-space` | Seitenhintergrund |
| Graphite `#2B3135` | `--rdoc-graphite` | Rahmen, Trennlinien, Flaechen |
| Off White `#F2F2F0` | `--rdoc-text` | Text |
| Steel `#76828D` | `--rdoc-text-muted` | Sekundaertext |
| Copper `#C48A4A` | `--rdoc-accent` | **eine** Aktion pro Ansicht, Event-Label |
| Patina `#4FB5B5` | `--rdoc-accent-2` | Struktur: Nav, Tabellenkoepfe, Panel-Titel, eine Datenreihe |
| Success / Warning / Error / Info | `--rdoc-success` usw. | ausschliesslich Zustaende |

Regeln, die der Build nicht erzwingt und die beim Review geprueft werden
muessen:

- Patina ist **nie** ein Zustand und nie der Signet-Ring.
- Zustand ist nie nur Farbe — immer mit Wort oder Icon (`SPIEL: AKTIV`,
  `PASS`, `WS: OFFLINE`).
- Kein Gradient, Glow, Schatten oder Bevel. Deshalb sind Scanlines,
  `text-shadow` und die Verlaufs-Hairlines der alten Overlays entfernt.
- Michroma hat **genau einen Schnitt** und laeuft mit `letter-spacing: 0`.
  Betonung entsteht ueber Groesse oder Farbe, nie ueber `font-weight`.
- Der Dockingring erscheint pro Lockup genau einmal. Die Wortmarke wird
  nie als Text nachgebaut — immer `rdoc-logo.svg` einbinden.
- Mindestgroessen: Ring regulaer ab 32 px, Micro-Cut 24–32 px. Der
  Nav-Ring in `admin-shared.js` ist der Micro-Cut bei 24 px.

### Theme

Alle Seiten setzen `data-theme="dark"` auf `<html>`. `rdoc-brand.css`
bringt eine vollstaendige Light-Palette mit, aber das App-Layer ist noch
nicht darauf ausgelegt — ohne das Attribut wuerde eine OBS-Quelle mit
`prefers-color-scheme: light` die Overlay-Tokens umschalten.

### Wo Farbe definiert werden darf

Nur in `rdoc-brand.css` (generiert) und im `:root`-Block von
`rdoc-admin.css` / `rdoc-overlay.css`, der die Brand-Tokens auf die
App-Namen (`--bg`, `--accent`, `--struct`, `--ok`, `--err`) abbildet.
Kein HTML und kein JS enthaelt noch einen Hex-Wert — Ausnahme sind die
`rgba()`-Literale in den Overlay-Dateien, weil `rgba()` keine CSS-Variable
als Komponente akzeptiert und OBS ein aelteres CEF als der Browser
mitbringt (deshalb dort auch kein `color-mix()`).

---

## Backup & Restore

- **Automatisch:** `cc-backup` läuft als Cron im eigenen Container, dumpt PG täglich 03:00 nach `/backups/postgres/`.
- **Retention:** 30 Tage (über `KEEP_DAYS` in `docker-compose.yml` änderbar).

```bash
docker exec cc-backup sh /backup.sh                                 # manuell triggern
ls /var/lib/docker/volumes/streamertools_backup_data/_data/postgres # Dumps ansehen
docker exec -i cc-postgres psql -U chaoscrew -d chaoscrew < dump.sql   # restore
```

### DB-Migrationen

Liegen in [postgres/migrations/](postgres/migrations/) (idempotente SQL-Dateien). Manuell anwenden:

```bash
docker exec -i cc-postgres psql -U chaoscrew -d chaoscrew \
  < postgres/migrations/001_session_msgs.sql
```

`init.sql` läuft nur beim **ersten** Start eines frischen Volumes — Schema-Änderungen müssen als nummerierte Migration nachgereicht werden.

---

## Deploy

Push lokal → SSH in den Server → Pull + Rebuild:

```bash
git push
ssh root@<server> "cd /opt/streamertools && git pull && docker compose up -d --build"
```

Bei Schema-Änderung zusätzlich die Migration anwenden (siehe oben).

---

## Verzeichnisstruktur

```
.
├── caddy/                  # Caddyfile (HTTP) + Caddyfile.ssl (HTTPS, veraltet — siehe future-idea.md)
├── postgres/               # Postgres-Image (LXC-Workaround) + init.sql + migrations/
├── services/
│   ├── bridge/             # Streamerbot-WS-Client → Redis-Pub/Sub
│   ├── spacefight/         # Fight-Engine, REST, WS, Admin-Page, Overlay
│   ├── alerts/             # Alert-Overlays, HUD-Chat, Claude-AI-Endpoint
│   ├── stats/              # Read-only Aggregat-API + Stats-Page
│   └── admin/              # Aggregierter Health, statische Admin-Pages, admin-shared.js
│                           # jedes public/ enthaelt eine Kopie von rdoc-brand.css + Favicons
├── streamerbot/            # 26 C#-Actions
├── backup/                 # Backup-Script
├── docker-compose.yml
├── Dockerfile              # Caddy-Image (kopiert Caddyfile rein)
├── CLAUDE.md               # Detail-Architektur (für Claude Code)
├── Installation.md         # OBS + Streamerbot Setup-Walkthrough
└── future-idea.md          # Plan für Public-Server-Move (WireGuard, HTTPS, Auth)
```

---

## Lizenz / Status

Projekt-internes Tooling, kein offizielles Release. Patches & Issues willkommen.
