# Chaos Crew Giveaway System v5

## Architektur-Änderungen zu v4

**Problem v4:** Watchtime-Logik in Streamerbot GlobalVars → Race Conditions, kein Monitoring, keine Fehlertoleranz.

**Lösung v5:** Streamerbot ist nur noch Event-Forwarder. Die API übernimmt alles.

```
Twitch → Streamerbot → API (WebSocket Port 9090)
                       ↓
                   WatchtimeEngine (watchtime.js)
                   ├── Redis DB 0  (Live-State, atomic INCRBY)
                   └── PostgreSQL  (Persistent: Sessions, Events, History)
                       ↓
                   Browser-WS Port 9091
                       ↓
                   Web Frontends (via Caddy)
```

## Services

| Service | Port | Beschreibung |
|---|---|---|
| API REST | 3000 | REST Endpoints |
| API WS | 9091 | Browser WebSocket (Admin, Overlays) |
| PostgreSQL | 5432 | Persistente Daten |
| Redis | 6379 | Live-State (DB 0 = Prod, DB 1 = Test) |
| Caddy | 80/443 | Web + Reverse Proxy |
| Redis Commander | 8081 | Redis Admin UI |

## Deployment

```bash
cp .env.example .env
# .env anpassen (Passwörter, SB_HOST, DOMAIN)

docker compose up -d
```

## Tests

```bash
# Unit Tests (kein Docker nötig, keine echte DB)
cd api && npm test

# Alle Tests
node --test tests/*.test.js
```

Tests nutzen **Mock-Redis und Mock-PG** – die Produktion wird niemals berührt.

## Streamerbot Actions einrichten

**Neue Actions (ersetzen v4):**
- `GW_A_ViewerTick.cs` – Trigger: `Twitch → Present Viewer`
- `GW_B_ChatMessage.cs` – Trigger: `Twitch → Chat Message`
- `GW_TimeInfo.cs` – Trigger: `Core → Command → time`
- `CC_ChatReply.cs` – Trigger: `Core → WS → Custom Server Message`

**GlobalVar die Streamerbot braucht:**
- `cc_api_session` – wird automatisch gesetzt wenn die API sich verbindet

**Nicht mehr nötig (v4 Actions löschen):**
- `GiveawayWS_Handler.cs` – Logik jetzt in der API
- `GW_TicketInfo.cs` – ersetzt durch `GW_TimeInfo.cs`

## Backup & Restore

**Automatisch:** Täglich 03:00 Uhr via Cron im Backup-Container.

**Manuell:**
```bash
# Backup triggern
docker exec cc-backup sh /backup.sh

# Backup ansehen
ls /var/lib/docker/volumes/chaos-crew-v5_backup_data/_data/postgres/

# Restore (WARNUNG: überschreibt Daten!)
docker exec -it cc-backup sh /restore.sh /backups/postgres/chaoscrew_DATUM.sql.gz
```

**Aufbewahrung:** 30 Tage (konfigurierbar via `KEEP_DAYS` in docker-compose.yml).

## OBS Browser Source URLs

```
Giveaway Overlay:  http://192.168.178.34/giveaway-overlay.html?host=192.168.178.34&port=9091
Join Animation:    http://192.168.178.34/giveaway-join.html?host=192.168.178.34&port=9091
Spacefight:        http://192.168.178.34/spacefight.html?host=192.168.178.34&port=9091&apihost=192.168.178.34&forcelive=1
HUD Chat:          http://192.168.178.34/chat.html?channel=justcallmedeimos
```

**Wichtig:** Port ist jetzt **9091** (API Browser-WS), nicht mehr 9090 (Streamerbot).
