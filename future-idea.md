# Public Deployment Plan — Chaos Crew Suite

## Context

Heute läuft die komplette Suite (Bridge, Giveaway, Spacefight, Alerts, Stats, Admin, Caddy, Redis, PG) auf der LXC `192.168.178.34` im Heimnetz. Streamerbot (Windows-PC, `192.168.178.39:9090`) und OBS sind ebenfalls lokal.

Ziel: Suite auf einem **vorhandenen Public-Server** mit **eigener Domain** und HTTPS betreiben — Streamerbot und OBS bleiben **zuhause**.

Die Knackpunkte für den Move:

1. **Bridge ist WS-Client zu Streamerbot** ([services/bridge/server.js:90-98](services/bridge/server.js#L90-L98)) — der Public-Server muss Streamerbot:9090 erreichen, ohne dass Streamerbot öffentlich exponiert wird. → **WireGuard**.
2. **Caddyfile.ssl ist veraltet** ([caddy/Caddyfile.ssl](caddy/Caddyfile.ssl)) — referenziert noch den alten `api:3000` Monolith und einen `/srv/web` Static-Root, die es im Microservice-Stack nicht mehr gibt. Muss vor HTTPS-Switch komplett neu geschrieben werden.
3. **Admin-WS-Commands sind ungesichert** — `gw_cmd` ([services/giveaway/server.js:174](services/giveaway/server.js#L174)) und `sf_cmd` (analog in spacefight) akzeptieren jeden Verbindungsaufbau, kein Token. Im Heimnetz egal, public ein Vollzugriff.
4. **REST-Endpoints `/alerts/api/chat/send` und `/alerts/api/claude/summary` sind ungesichert** ([services/alerts/server.js:267, :229](services/alerts/server.js#L267)) — public bedeutet: jeder kann Twitch-Chat als der Streamer spammen / Anthropic-Quota verbrennen.
5. **Browser-WS-Code ist bereits HTTPS-aware** (`location.protocol === 'https:' ? 'wss:' : 'ws:'`) — kein Frontend-Code-Change für TLS notwendig.

---

## Architektur nach dem Move

```
[ Heim-PC (Win) ]                              [ Public-Server ]
  Streamerbot WS :9090                            Caddy :443 (HTTPS, Let's Encrypt)
  WireGuard Client (10.8.0.2)  ◄── UDP :51820 ──► WireGuard Server (10.8.0.1)
  OBS Browser Sources ─────────── HTTPS/WSS ────►  bridge → connects 10.8.0.2:9090
                                                  giveaway / spacefight / alerts / stats / admin
                                                  redis / postgres / backup
```

- Bridge-Container nutzt `SB_HOST=10.8.0.2` (Heim-PC im WG-Netz) — Container kann Host-Routen nach `wg0` über das default Docker-Bridge-Netz erreichen, sofern `net.ipv4.ip_forward=1` (Standard auf Linux-Hosts mit Docker).
- Streamerbot-WS-Server wird so konfiguriert, dass er auf `0.0.0.0:9090` (oder gezielt `10.8.0.2:9090`) lauscht — niemals auf der Public-IP.

---

## Änderungen (in Reihenfolge der Umsetzung)

### Phase A — Infrastruktur (Server-Host)

1. **WireGuard installieren** (`apt install wireguard-tools`).
2. **Schlüsselpaar serverseitig** generieren, `wg0.conf` mit Heim-PC als Peer:
   - Server: `10.8.0.1/24`, Listen `:51820/udp`.
   - Peer (Heim): `10.8.0.2/32`, Public-Key vom Heim-PC.
3. **Heim-PC**: WireGuard für Windows installieren, Konfig importieren, `PersistentKeepalive=25` setzen (NAT-Traversal).
4. **Streamerbot-WS-Server** auf `0.0.0.0:9090` binden (sonst nur localhost).
5. **Firewall Public-Server**: 80/tcp, 443/tcp, 51820/udp inbound; 8081 (redis-ui) nur auf localhost binden statt `0.0.0.0`.
6. **DNS A-Record**: `cc.deinedomain.tld` → Server-Public-IP.

### Phase B — Caddy / TLS / Auth (Repo-Änderungen)

1. **`caddy/Caddyfile.ssl` komplett neu schreiben** — Path-Routing aus aktuellem `Caddyfile` übernehmen, plus:
   - `tls` Block über `{$DOMAIN}` (Auto-HTTPS via Let's Encrypt).
   - `basicauth` Matcher für `/admin/*`, `/giveaway/giveaway-admin*`, `/spacefight/spacefight-admin*`, `/redis-ui/*`, `/giveaway/giveaway-test*`. Bcrypt-Hash via `caddy hash-password`, Username + Hash in `.env` als `ADMIN_USER` / `ADMIN_HASH`.
   - HSTS-Header bleibt drin.
   - CORS auf `Access-Control-Allow-Origin {$DOMAIN}` einschränken statt `*`.
2. **`.env` ergänzen**:
   ```
   DOMAIN=cc.deinedomain.tld
   CADDY_CONFIG=Caddyfile.ssl
   SB_HOST=10.8.0.2
   ADMIN_TOKEN=<32-Byte-Hex>
   ADMIN_USER=streamer
   ADMIN_HASH=<bcrypt von 'caddy hash-password'>
   PG_PASSWORD=<random>
   REDIS_UI_PASSWORD=<random>
   ```
3. **`docker-compose.yml`**:
   - `redis-ui`: Port-Mapping `"127.0.0.1:8081:8081"` (nicht extern offen).
   - Neue Env-Var `ADMIN_TOKEN` an `giveaway`, `spacefight`, `alerts` durchreichen.

### Phase C — App-seitige Auth (Repo-Änderungen)

Ohne diese Schritte wären `gw_cmd`/`sf_cmd`/`chat/send`/`claude/summary` zwar TLS-gesichert, aber jeder mit der URL kann sie aufrufen.

1. **`services/giveaway/server.js`** — im WS-Message-Handler bei `case 'gw_cmd'` zuerst prüfen:
   `if (msg.token !== process.env.ADMIN_TOKEN) { send({event:'gw_ack',type:'unauthorized'}); break; }`.
2. **`services/spacefight/server.js`** — analog für `sf_cmd`.
3. **`services/alerts/server.js`** — `/api/chat/send` und `/api/claude/summary`: Middleware, die `req.headers['x-admin-token'] === process.env.ADMIN_TOKEN` verlangt; sonst 401. `/api/twitch/user/:login` darf public bleiben (nur lookup).
4. **`services/giveaway/public/giveaway-admin.js`** + **`services/spacefight/public/spacefight-admin.js`**:
   - Beim Connect Token aus `localStorage` lesen; falls leer → `prompt('Admin Token:')` → speichern.
   - Token in jedes ausgehende `gw_cmd`/`sf_cmd` Payload als `token`-Feld einfügen.
   - Bei `unauthorized`-Ack: localStorage löschen, neu prompten.
5. **`services/alerts/public/raid-info.html`** + **`shoutout-info.html`**:
   - Diese laufen als OBS-Browser-Sources ohne User-Interaction → Token via URL-Query (`?t=TOKEN`) lesen und als Header `X-Admin-Token` an die fetches anhängen.
   - OBS-URLs werden so um `?t=…` ergänzt — Token liegt nur lokal in der OBS-Source-URL.
6. **`services/admin/public/admin-shared.js`** — falls dort Fetch-Calls Richtung geschützte Endpoints gehen (Debug-Console nutzt fetch-Intercept), Header automatisch anhängen.

### Phase D — Frontend / OBS

1. **OBS-Browser-Sources** in OBS umstellen auf `https://cc.deinedomain.tld/...` (statt `http://192.168.178.34/...`):
   - `/alerts/alerts.html`
   - `/alerts/raid-info.html?t=TOKEN`
   - `/alerts/shoutout-info.html?t=TOKEN`
   - `/alerts/chat.html?channel=DEIN_KANAL`
   - `/giveaway/giveaway-overlay.html`
   - `/giveaway/giveaway-join.html`
   - `/spacefight/spacefight.html`
2. **Streamerbot-Actions** prüfen — falls hardcoded URLs auf `http://192.168.178.34` zeigen (z.B. `GW_Leaderboard.cs` `Fetch URL`), auf neue Domain umstellen. Bridge-WS-Connection des Streamerbot bleibt unverändert (Streamerbot ist ja der Server).

### Phase E — Daten-Migration vom LXC

1. **LXC-Stack stoppen**.
2. **PG dump**: `docker exec cc-postgres pg_dump -U chaoscrew chaoscrew > cc.sql`.
3. **Redis dump**: `docker exec cc-redis redis-cli SAVE`, dann `dump.rdb` aus dem Volume kopieren.
4. **Auf neuem Server**: SQL einspielen, RDB ins Redis-Volume vor erstem Start, dann `docker compose up -d --build`.
5. **Smoke-Test** über `/health` und Admin-Page.

---

## Kritische Dateien (zum Editieren)

| Datei | Was ändert sich |
|---|---|
| [caddy/Caddyfile.ssl](caddy/Caddyfile.ssl) | Komplette Neuschreibung (Path-Routing + basicauth + TLS-Block) |
| [docker-compose.yml](docker-compose.yml) | redis-ui Port-Bind localhost; ADMIN_TOKEN env an 3 Services |
| [.env.example](.env.example) | Neue Variablen (DOMAIN, CADDY_CONFIG, ADMIN_TOKEN, ADMIN_USER, ADMIN_HASH) |
| [services/giveaway/server.js](services/giveaway/server.js) | Token-Check in `gw_cmd` Branch |
| [services/spacefight/server.js](services/spacefight/server.js) | Token-Check in `sf_cmd` Branch |
| [services/alerts/server.js](services/alerts/server.js) | Auth-Middleware für `chat/send` + `claude/summary` |
| [services/giveaway/public/giveaway-admin.js](services/giveaway/public/giveaway-admin.js) | Token aus localStorage / prompt, in cmds einfügen |
| [services/spacefight/public/spacefight-admin.js](services/spacefight/public/spacefight-admin.js) | dito |
| [services/alerts/public/raid-info.html](services/alerts/public/raid-info.html) | Token aus `?t=` Query-Param, X-Admin-Token Header |
| [services/alerts/public/shoutout-info.html](services/alerts/public/shoutout-info.html) | dito |

Wiederverwendbare Helper, die schon existieren:
- `CC.validate` ([services/admin/public/admin-shared.js](services/admin/public/admin-shared.js)) — Input-Sanitizing bleibt unverändert.
- WS-URL-Konstruktion via `location.protocol === 'https:' ? 'wss:' : 'ws:'` ist überall schon HTTPS-aware ([services/giveaway/public/giveaway-admin.js:36](services/giveaway/public/giveaway-admin.js#L36) u.a.).

---

## Verifikation (End-to-End nach dem Switch)

1. `wg show` auf Server → Heim-Peer `latest handshake` < 60s. Ping `10.8.0.2` von Server geht.
2. `curl https://cc.deinedomain.tld/health` → JSON aller Services `ok`, **bridge.streamerbot=connected**.
3. `https://cc.deinedomain.tld/admin/` → Browser fragt nach basicauth, danach Dashboard sichtbar.
4. `https://cc.deinedomain.tld/giveaway/giveaway-admin.html` → basicauth + Token-Prompt; nach Eingabe: WS connect grün, `gw_get_keyword` liefert Keyword zurück.
5. OBS-Source `https://cc.deinedomain.tld/giveaway/giveaway-overlay.html` lädt ohne Mixed-Content-Warnung; Test-Tickets werden live broadcastet.
6. Streamerbot-Action `!time` im Twitch-Chat → Reply erscheint im Chat (round-trip via WG → Bridge → Giveaway → ch:chat_reply → Streamerbot → Twitch).
7. **Negativ-Test**: `curl -X POST https://cc.deinedomain.tld/alerts/api/chat/send -d '{"message":"hi"}' -H 'Content-Type: application/json'` ohne Token → **401**.
8. **Negativ-Test**: WS connect zu `wss://cc.deinedomain.tld/giveaway/ws`, sende `{event:'gw_cmd',cmd:'gw_reset'}` ohne `token` → `unauthorized` Ack, kein Reset.
