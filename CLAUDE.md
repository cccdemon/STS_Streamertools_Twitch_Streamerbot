# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# RDOC - Streamer Tools

## Project Overview
Twitch streamer toolset: Spacefight chat game, HUD chat overlay, Alert overlays, and Streamerbot C# actions.
Dockerized microservices stack: Bridge + Spacefight + Alerts + Stats + Admin + Caddy + Redis + PostgreSQL.

The UI was rebranded from "Chaos Crew" to **RDOC** and now consumes the RDOC
Brand Kit (see "Brand layer" below). Two things deliberately kept the old
names because renaming them breaks running infrastructure or is community
copy, not UI branding:

- `docker-compose.yml`: network `chaos-crew`, DB name/user `chaoscrew`,
  container prefix `cc-`. Renaming these orphans the Postgres volume.
- Twitch chat strings that greet viewers ("Willkommen in der Chaos Crew")
  in `services/alerts/server.js` and `streamerbot/CC_Sub.cs` /
  `CC_Resub.cs` / `CC_AdBreakEnd.cs`. That is the streamer's community
  name, not the tool's brand.
- CSS class prefix `.cc-*` and the `CC.validate` namespace - JS, HTML and
  the browser test suite are all coupled to them.

> The giveaway system was split out into its own repository (`CC-Giveaway`) and
> removed here — no watchtime, coins, tickets, or draws in this stack.
> `services/giveaway/` may still exist locally as an untracked leftover
> (`node_modules` + `package-lock.json`). It is dead — no Dockerfile, no
> `server.js`, no compose entry. Safe to delete; never reference it.

## Architecture

### Services (all in `services/`)
| Service | Container | Port | Purpose |
|---|---|---|---|
| `bridge` | cc-bridge | 3000 | Streamerbot WS client → Redis pub/sub fan-out |
| `spacefight` | cc-spacefight | 3002 | Fight engine, leaderboard, WS admin |
| `alerts` | cc-alerts | 3003 | Follow/cheer/raid/shoutout overlays, Claude AI, WS |
| `stats` | cc-stats | 3004 | Read-only spacefight stats from PostgreSQL, no WS |
| `admin` | cc-admin | 3005 | Shared admin pages, aggregated health check, no WS |
| Caddy | cc-web | 80/443 | Reverse proxy, path-based routing to services |
| Redis | cc-redis | 6379 | Ephemeral state (DB 0 = prod, DB 1 = tests) |
| PostgreSQL | cc-postgres | 5432 | Persistent data |
| Redis UI | cc-redis-ui | 8081 | Redis Commander |
| Backup | cc-backup | – | Daily cron backup at 03:00 |

Every Node service is the same shape: `express` + optional `ioredis`/`ws`/`pg`,
one `server.js`, a `public/` static dir, no build step, no framework, no
bundler. Services share **no** npm package — code reuse happens by copying
files (see "Duplicated frontend files" below).

Each compose service has a `wget /health` healthcheck and `depends_on:
condition: service_healthy` on redis/postgres, so a service that fails its
health endpoint blocks everything downstream from starting.

### Caddy Path Routing
All traffic goes through Caddy on port 80. Path prefix is stripped before proxying:
| Path | Service | Notes |
|---|---|---|
| `/spacefight/*` | spacefight:3002 | REST + WS (`/spacefight/ws`) |
| `/alerts/*` | alerts:3003 | REST + WS (`/alerts/ws`), HUD chat overlay |
| `/stats/*` | stats:3004 | REST only (spacefight) |
| `/admin/*` | admin:3005 | Static admin pages |
| `/bridge/*` | bridge:3000 | Health only |
| `/health` | admin:3005 | Aggregated health |
| `/redis-ui/*` | redis-ui:8081 | Redis Commander |
| `/` | → `/admin/` | Root redirect |

Because Caddy does `uri strip_prefix`, every service sees paths **without** its
prefix. Server code registers `/api/...` and `/health`; the browser calls
`/<service>/api/...`. Never hardcode the prefix server-side.

### Event Flow
```
Streamerbot (WS :9090)
  └─ bridge/server.js ──publishes──► Redis pub/sub channels
        ch:spacefight  ──subscribe──► spacefight/server.js ──broadcast──► browser WS
        ch:alerts      ──subscribe──► alerts/server.js    ──broadcast──► browser WS
        ch:chat        ──subscribe──► alerts/server.js    (HUD chat)
        ch:chat_reply  ◄──publish───  spacefight/server.js (→ Streamerbot)
                       ◄──publish───  alerts/server.js    (POST /api/chat/send)
```

Bridge is a pure router: it holds no state and owns the `ROUTES` map
(`services/bridge/server.js`). An inbound event whose name is not a `ROUTES`
key is dropped silently — adding a new Streamerbot event means adding it to
`ROUTES` **and** to `ALLOWED_EVENTS` in the shared frontend lib.

### Redis Pub/Sub Channels (Bridge `ROUTES`)
| Event | Channel(s) |
|---|---|
| `chat_msg` (HUD), `clip_created`, `ad_break_start`, `ad_break_end` | `ch:chat` |
| `fight_cmd`, `spacefight_challenge`, `spacefight_result`, `spacefight_rejected`, `stream_online`, `stream_offline` | `ch:spacefight` |
| `follow`, `cheer`, `raid`, `shoutout`, `first_chatter` | `ch:alerts` |
| `chat_reply` (outbound) | `ch:chat_reply` |

## Key Files
- `services/bridge/server.js` — Streamerbot WS client + Redis pub/sub router (`ROUTES`)
- `services/spacefight/server.js` — Spacefight REST + WS + fight engine
- `services/alerts/server.js` — Alert overlays REST + WS + Claude AI
- `services/alerts/public/chat.js` — HUD chat overlay logic
- `services/stats/server.js` — Read-only stats REST (no Redis, no WS)
- `services/admin/server.js` — Aggregated health + static admin pages
- `services/admin/public/admin-shared.js` — Canonical shared lib: `CC.validate`, nav bar, debug console
- `services/admin/public/rdoc-brand.css` — **Generated** brand tokens, copied from RDOC-Brandkit. Never hand-edit
- `services/admin/public/rdoc-admin.css` — Admin page styles; maps brand tokens to app names
- `services/alerts/public/rdoc-overlay.css` — OBS overlay styles (HUD chat + spacefight)
- `caddy/Caddyfile` — Reverse proxy config
- `postgres/init.sql` — Schema; runs **only** on a fresh volume

### Duplicated frontend files (important)
Each service's Docker build context is its own directory, so it cannot reach
another service's `public/`. Everything shared is therefore a copy.

**Byte-identical, one canonical source** — edit the canonical file, then copy
it over the rest:

| Files | Canonical | Verify |
|---|---|---|
| `{admin,alerts,spacefight,stats}/public/*-shared.js` | `admin/public/admin-shared.js` | `md5sum services/*/public/*-shared.js` |
| `{admin,alerts,spacefight,stats}/public/rdoc-brand.css` | RDOC-Brandkit `digital/web/brand.css` | `md5sum services/*/public/rdoc-brand.css` |
| `{alerts,spacefight}/public/rdoc-overlay.css` | `alerts/public/rdoc-overlay.css` | `md5sum services/*/public/rdoc-overlay.css` |
| `{admin,alerts,spacefight,stats}/public/favicon.{svg,ico}` | RDOC-Brandkit `digital/web/` | – |

Editing one shared lib and not the others silently desyncs `CC.validate`,
`ALLOWED_EVENTS` and `ALLOWED_CMDS` per service.

**Deliberately different per service** — do not assume a change in one
applies to the others:
- `rdoc-admin.css` — three versions in `admin/`, `spacefight/`, `stats/`.
  Only the `:root` token-mapping block at the top is meant to stay in sync;
  everything below is page-specific.
- `rdoc-logo.svg` / `rdoc-logo-mono.svg` — only in `admin/`, `spacefight/`,
  `stats/`. The alerts service serves OBS overlays only and never draws the
  lockup.

## Brand layer (RDOC Brand Kit)

All colour and type come from the **RDOC Brand Kit** (separate repo,
`RDOC-Brandkit/brandkit`), which is a generator: `scripts/tokens.js` emits
`digital/web/brand.css`. This project only consumes it.

Load order on every page: `rdoc-brand.css` first, then the page's own
`rdoc-admin.css` or `rdoc-overlay.css`. Every `<html>` carries
`data-theme="dark"`.

### Where colour may be defined
1. `rdoc-brand.css` — generated, never hand-edit.
2. The `:root` block of `rdoc-admin.css` / `rdoc-overlay.css`, which maps
   brand tokens to app names (`--bg`, `--bg2`, `--bg3`, `--text`, `--dim`,
   `--accent`, `--struct`, `--ok`, `--warn`, `--err`, `--border`).

Nowhere else. HTML and JS carry no hex values and no inline colour — add a
class instead. The one exception is `rgba()` literals inside the overlay
files: `rgba()` cannot take a CSS variable as a component, and OBS ships an
older CEF than a desktop browser, which is also why `color-mix()` is used
only in the admin CSS.

### Colour roles
| Token | App name | Used for |
|---|---|---|
| `--rdoc-accent` Copper `#C48A4A` | `--accent` | **one** action per view, event labels, rank 1 |
| `--rdoc-accent-2` Patina `#4FB5B5` | `--struct` | structure: nav, table heads, panel titles, one data series |
| `--rdoc-success/-warning/-error/-info` | `--ok`/`--warn`/`--err` | states only |
| `--rdoc-space` / `--rdoc-graphite` | `--bg` / `--border` | background, borders; `--bg2`/`--bg3` are `color-mix` of the two |
| `--rdoc-text` / `--rdoc-text-muted` | `--text` / `--dim` | Off White text, Steel secondary |

### Invariants the build cannot check
- Patina is **never** a state and never the signet ring.
- A state is never colour alone — it carries a word or icon
  (`SPIEL: AKTIV`, `WS: OFFLINE`, `PASS`).
- No gradient, glow, shadow or bevel, anywhere. The old scanline layers,
  `text-shadow` glows and multi-stop hairlines were removed for this. The
  alert reveal wipe in `alerts.html` is a hard-edged mask, not a fade.
- Michroma (`--rdoc-font-display`) has **exactly one cut (400)** and runs at
  `letter-spacing: 0`. Emphasis via size or colour, never `font-weight`.
- The dock ring appears exactly once per lockup. Never rebuild the wordmark
  as text — embed `rdoc-logo.svg`.
- Ring minimum size: 32 px regular, 24–32 px for the micro cut. The nav ring
  in `admin-shared.js` is the micro cut at 24 px; its path is a verbatim copy
  of `digital/icon/rdoc_signet_micro_copper.svg` with `fill="currentColor"`.
  Re-copy it from the kit rather than retyping coordinates.
- Overlay eyebrow labels use `0.3em` tracking instead of the token `0.07em`
  — they are read across a room at 1920 px. This is the only intentional
  deviation from the type tokens.

### Light mode
`rdoc-brand.css` ships a complete measured light palette, but the app layer
is not wired for it: `data-theme="dark"` is hardcoded on every page. Without
it an OBS source reporting `prefers-color-scheme: light` would flip the
overlay tokens mid-stream.

### Refreshing the assets after a Brand Kit change
```bash
BK=../RDOC-Brandkit/brandkit
for s in admin spacefight stats alerts; do
  cp $BK/digital/web/brand.css   services/$s/public/rdoc-brand.css
  cp $BK/digital/web/favicon.svg services/$s/public/favicon.svg
  cp $BK/digital/web/favicon.ico services/$s/public/favicon.ico
done
for s in admin spacefight stats; do
  cp $BK/digital/logo/rdoc_logo_horizontal_dark.svg          services/$s/public/rdoc-logo.svg
  cp $BK/digital/logo/rdoc_logo_horizontal_mono-offwhite.svg services/$s/public/rdoc-logo-mono.svg
done
md5sum services/*/public/rdoc-brand.css
```

## WS Connections (per service)
Admin pages connect to their own service WS via Caddy:
- Spacefight admin → `ws://server/spacefight/ws`
- Alert overlays → `ws://server/alerts/ws`

Every browser WS client sends `{ event: 'cc_identify', role: '<name>' }` on open.

| Role | Sent from |
|---|---|
| `spacefight-admin` | `spacefight/public/spacefight-admin.js` |
| `spacefight-overlay` | `spacefight/public/spacefight.js` |
| `raid-overlay` | `alerts/public/raid-info.html` (inline) |
| `shoutout-overlay` | `alerts/public/shoutout-info.html` (inline) |

`alerts.html`, `raid-info.html` and `shoutout-info.html` keep their JS **inline**
— there is no `alerts.js` / `raid-info.js` / `shoutout-info.js`. Only
`chat.js`, `spacefight.js`, `spacefight-admin.js`, `stats.js`, `index.js` and
`streamerbot-data.js` are external.

## OBS Overlay URLs
| Overlay | Path |
|---|---|
| Spacefight | `/spacefight/spacefight.html` |
| HUD Chat | `/alerts/chat.html?channel=DEIN_KANAL` |
| Alert bar | `/alerts/alerts.html` |
| Raid info | `/alerts/raid-info.html` |
| Shoutout info | `/alerts/shoutout-info.html` |

## REST API Endpoints
Paths below are as seen **through Caddy**; server code omits the prefix.

### Spacefight Service (`/spacefight/api/...`)
| Method | Path | Purpose |
|---|---|---|
| GET | `/spacefight/api/spacefight/leaderboard` | Win/loss stats |
| GET | `/spacefight/api/spacefight/history` | Recent fight results |
| GET | `/spacefight/api/spacefight/player/:username` | Single player stats |
| POST | `/spacefight/api/spacefight` | Record fight result |

### Alerts Service (`/alerts/api/...`)
| Method | Path | Purpose |
|---|---|---|
| POST | `/alerts/api/chat/send` | Publish to `ch:chat_reply` → Streamerbot → Twitch chat |
| GET | `/alerts/api/twitch/user/:login` | Twitch Helix user profile (not cached) |
| POST | `/alerts/api/claude/summary` | AI summary for raid/shoutout overlays |

### Stats Service (`/stats/api/...`)
Same three read paths as spacefight, but served straight from PostgreSQL with
no Redis and no WS. Duplicated on purpose so stats pages never touch the
game service.

### Health
| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Aggregated health (admin fans out to all services) |
| GET | `/<service>/health` | Per-service health (bridge, spacefight, alerts, stats) |

## Admin WS Commands

`sf_cmd` payload (`{ event: 'sf_cmd', cmd: '...' }`):
| cmd | Effect |
|---|---|
| `sf_start` | Activate spacefight game |
| `sf_stop` | Deactivate spacefight game |
| `sf_reset` | Reset all stats + history |
| `sf_delete_player` | Remove player (+ `username`) |
| `sf_edit_player` | Edit player stats (+ `username`, `wins`, `losses`) |
| `cc_first_chatter_toggle` | Toggle first-chatter welcome feature |

## Conventions
- German UI text throughout (Twitch streamer is German-speaking)
- All admin pages load the shared lib as first script in `<body>`
- OBS overlays do NOT include the shared lib (no nav/debug console in stream)
- Colour and type come only from the RDOC tokens — see "Brand layer". No hex
  in HTML or JS, no inline `style="color:..."`; add a class instead
- WebSocket events: `{ event: 'name', ... }` format
- Admin commands: `{ event: 'sf_cmd', cmd: '...' }`
- New WS events/cmds must be added to `ALLOWED_EVENTS`/`ALLOWED_CMDS` in the
  shared lib — **in all four copies**
- `CC.validate` namespace for all input sanitization (XSS, prototype pollution, WS payload validation)
- Debug console auto-intercepts all WS send/recv, fetch, button clicks — shown at bottom of all admin pages
- All services use `log(tag, ...args)` / `logErr(tag, ...args)` helpers — never raw `console.log`
- `sanitizeUsername(s)` — lowercase, alphanumeric + underscore, max 25 chars — defined
  separately in each `server.js` and in the C# actions; must stay consistent C# ↔ JS

## Alert Overlays (`services/alerts/`)
All three overlays connect to alerts service WS via `/alerts/ws`.

| File | Purpose |
|---|---|
| `alerts.html` | Bottom-bar alert (follow, sub, bits, raid, subgift, subbomb, hypetrain, redeem, shoutout, outraid) |
| `raid-info.html` | Right-panel raid info with AI summary (Claude API, Firefly theme) |
| `shoutout-info.html` | Right-panel shoutout info with AI summary + chat reply via `/alerts/api/chat/send` |

Claude API key in `.env` as `ANTHROPIC_KEY` — never pass it as URL param.
`POST /alerts/api/claude/summary` handles all AI calls; the model id is
hardcoded in `services/alerts/server.js`. Prompts live in the `CLAUDE_PROMPTS`
map in the same file, keyed by `raid` / `shoutout`.

### Sound files
Checked into `services/alerts/public/`:
`sound_follow.mp3`, `sound_sub.mp3`, `sound_bits.mp3`, `sound_bomb.mp3`, `sound_raid.mp3`, `sound_redeem.mp3`, `sound_hype.mp3`, `sound_outraid.mp3`, `sound_alert.ogg`, `sound_battle.mp3`, `sound_rip.mp3`, `sound_selfie.mp3`

OBS browser source: enable **"Control audio via OBS"** for audio to appear in the OBS mixer.

### Channel Point Rewards
Per-reward overlay config lives in the `CHANNEL_REWARDS` map in `alerts.html` — keyed by lowercased reward title. Each entry: `{ label, msg(user), stat, flash, sound }`. Add new rewards by extending this map; no server changes needed.

## Streamerbot C# Actions (`streamerbot/`)
All broadcasters send to `cc_api_session` (set by `CC_ApiRegister.cs`) via `CPH.WebsocketCustomServerBroadcast`.
Bridge receives the event and routes it via `ROUTES` to the correct Redis channel.

| File | Action Name | Trigger | Purpose |
|---|---|---|---|
| `CC_ApiRegister.cs` | CC – API Register | WS Custom Server Message | Saves cc_api_session on connect |
| `CC_ChatReply.cs` | CC – Chat Reply Handler | WS Custom Server Message | Forwards chat_reply to Twitch chat |
| `CC_AlertRegister.cs` | CC – Alert Register | WS Custom Server Message | Registers overlay WS sessions |
| `CC_RaidBroadcaster.cs` | CC – Raid Broadcaster | Twitch Raid | Sends raid event to alerts overlay |
| `CC_Follow.cs` | CC – Follow | Twitch Follow | Sends follow event to alerts overlay |
| `CC_Cheer.cs` | CC – Cheer | Twitch Cheer | Sends cheer/bits event to alerts overlay |
| `CC_Shoutout.cs` | CC – Shoutout | Core Command `!so` | Shoutout to chat + Twitch native shoutout |
| `CC_ClipCreated.cs` | CC – Clip Created | Clip Created | Sends clip title + URL to chat |
| `CC_AdBreakStart.cs` | CC – Ad Break Start | Ad Break Start | Sends ad notice to chat |
| `CC_AdBreakEnd.cs` | CC – Ad Break End | Ad Break End | Sends ad-end notice to chat |
| `CC_FirstChatter.cs` | CC – First Chatter | Chat Message | Sends first_chatter event to API |
| `CC_Sub.cs` | CC – Sub | Twitch Sub | Sends sub event |
| `CC_Resub.cs` | CC – Resub | Twitch Resub | Sends resub event |
| `CC_SubGift.cs` | CC – SubGift | Twitch SubGift | Sends subgift event |
| `CC_SubBomb.cs` | CC – SubBomb | Twitch CommunityGiftSub | Sends subbomb event |
| `CC_Redeem.cs` | CC – Redeem | Channel Point Redeem | Sends redeem event (alerts overlay maps via `CHANNEL_REWARDS`) |
| `SF_FightCmd.cs` | SF – Fight Cmd | Command `!fight` | Sends fight_cmd to bridge |
| `SF_ChallengeAccept.cs` | SF – Challenge Accept | Command `!ja` | Accepts pending spacefight challenge |
| `SF_ChallengeDecline.cs` | SF – Challenge Decline | Command `!nein` | Declines pending spacefight challenge |
| `SF_ChatTracker.cs` | SF – Chat Tracker | Twitch Chat Message | Tracks active chatters for fight matchmaking |
| `SF_StreamOnline.cs` | SF – Stream Online | Stream Online | Sends stream_online → enables fights |
| `SF_StreamOffline.cs` | SF – Stream Offline | Stream Offline | Sends stream_offline → disables fights |

Import instructions and the Streamerbot queue setup are in
[Installation.md](Installation.md).

> Known issue (commits `e81f770`, `bec98cc`): each sub variant has its own action — should be consolidated.

## Data Storage

### Redis (ephemeral, DB 0)
| Key | Type | Written by |
|---|---|---|
| `sf_live` | `'true'`/`'false'` | spacefight — set by `stream_online`/`stream_offline` |
| `sf_game_active` | `'true'`/`'false'` | spacefight — set by `sf_start`/`sf_stop` |
| `sf:index` | sorted set (score = wins) | spacefight leaderboard ranking |
| `sf:dedup:<winner>:<loser>` | string, `EX 12 NX` | spacefight — blocks duplicate result writes for 12s |
| `cc_first_chatter_enabled` | `'true'`/`'false'` | alerts — first-chatter toggle |

A fight only runs when **both** `sf_live` and `sf_game_active` are `'true'`.

### PostgreSQL (persistent)
`spacefight_stats` (wins/losses per user) and `spacefight_results` (fight
history, indexed on `winner` and `loser`). The giveaway tables (`users`,
`sessions`, `session_participants`, `watchtime_events`) are gone from
`init.sql`; existing installs keep them — no DROP is issued.

`init.sql` runs **only** on a fresh volume. Schema changes must be added as
numbered idempotent files in `postgres/migrations/` and applied by hand:

```bash
docker exec -i cc-postgres psql -U chaoscrew -d chaoscrew < postgres/migrations/00X_name.sql
```

## Environment
Copy `.env.example` → `.env`. Note that `.env.example` is **incomplete**: the
alerts service also reads `ANTHROPIC_KEY`, `TWITCH_CLIENT_ID` and
`TWITCH_CLIENT_SECRET`, which are not listed there. Without them
`/alerts/api/claude/summary` returns 503 and `/alerts/api/twitch/user/:login`
returns 503.

Per-service connection vars (`PORT`, `REDIS_*`, `PG_*`, `SB_*`,
`BRIDGE_URL`/`SPACEFIGHT_URL`/`ALERTS_URL`/`STATS_URL`) are injected by
`docker-compose.yml`, not by `.env` directly.

## Development

### Commands (run from `services/<name>/`)
```bash
npm start              # production start
npm run dev            # start with --watch (auto-restart on change)
```

There is **no** `test` script and no `tests/` directory in any service —
`npm test` fails. The only automated tests are browser-side: open
`/admin/tests/test-runner.html` (suite in
`services/admin/public/tests/test-suite.js`). If Node tests are added, use
`node --test` and Redis **DB 1** — never DB 0.

### Docker
```bash
docker compose up -d --build      # rebuild after code changes
docker compose logs -f <service>  # tail service logs
docker compose restart <service>  # restart one service
docker compose ps                 # health status
```

Frontend-only changes still need a rebuild of that service: `public/` is baked
into the image, not bind-mounted.

### Backup
`cc-backup` dumps PostgreSQL daily at 03:00 to `/backups/postgres/`, retention
via `KEEP_DAYS` in `docker-compose.yml`. Manual: `docker exec cc-backup sh
/backup.sh`. Scripts in `backup/`.

### Deploy
Push to git → SSH into LXC → pull + `docker compose up -d --build`.

## Response Rules
- Be terse. No filler, no narration, no summaries of what you just did.
- Do not re-read files you already have in context. Use offset/limit when reading large files.
- Never read an entire file just to make a small edit — grep for the relevant section first.
- Do not echo back code you wrote. The diff is visible.
- Do not list "what changed" after edits unless explicitly asked.
- Do not use the Agent/subagent tool unless explicitly asked or the task clearly requires parallel exploration.
- Prefer Edit over Write for existing files — sends only the diff.
- When multiple independent edits are needed, batch them in one message.
- Skip pleasantries, greetings, and transition phrases. Just do the work.
