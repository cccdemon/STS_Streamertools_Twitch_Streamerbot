# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# RDOC - Streamer Tools

## Project Overview
Twitch streamer toolset: Spacefight chat game, HUD chat overlay, fullscreen alert
overlay, hauling overlay, OBS scene overlays, and Streamerbot C# actions.
Dockerized microservices stack: Bridge + Spacefight + Alerts + Stats + Admin +
Gamescenes + Caddy + Redis + PostgreSQL.

The UI runs on the **RDOC Brand Kit** — see "Brand layer" below.

> The giveaway system was split out into its own repository (`CC-Giveaway`) and
> removed here — no watchtime, coins, tickets or draws in this stack. What is
> deliberately *not* renamed: the `chaos-crew` docker network, the `chaoscrew`
> DB name/user and the `cc-` container prefix (renaming orphans the Postgres
> volume), the `.cc-*` CSS prefix and `CC.validate` namespace (JS, HTML and the
> browser test suite are coupled to them), and the Twitch chat strings that
> greet viewers — that is the streamer's community name, not the tool's brand.

## Architecture

### Services (all in `services/`)
| Service | Container | Port | Purpose |
|---|---|---|---|
| `bridge` | cc-bridge | 3000 | Streamerbot WS client → Redis pub/sub fan-out |
| `spacefight` | cc-spacefight | 3002 | Fight engine, leaderboard, WS admin, pixel-ship arena overlay |
| `alerts` | cc-alerts | 3003 | Alert overlay, HUD chat, hauling, `!id` profile, Claude AI, WS |
| `stats` | cc-stats | 3004 | Read-only spacefight stats from PostgreSQL, no WS |
| `admin` | cc-admin | 3005 | Shared admin pages, aggregated health check, no WS |
| `gamescenes` | cc-gamescenes | 3006 | Static OBS scene overlays, no WS |
| Caddy | cc-web | 80/443 | Reverse proxy, path-based routing to services |
| Redis | cc-redis | 6379 | Ephemeral state (DB 0 = prod, DB 1 = tests) |
| PostgreSQL | cc-postgres | 5432 | Persistent data |
| Redis UI | cc-redis-ui | 8081 | Redis Commander |
| Backup | cc-backup | – | Daily cron backup at 03:00 |

Port 3001 is free — it belonged to the removed giveaway service.

Every Node service is the same shape: `express` + optional `ioredis`/`ws`/`pg`,
one `server.js`, a `public/` static dir, no build step, no framework, no
bundler. Services share **no** npm package — code reuse happens by copying
files (see "Duplicated frontend files").

Each compose service has a `wget /health` healthcheck and `depends_on:
condition: service_healthy` on redis/postgres, so a service that fails its
health endpoint blocks everything downstream from starting.

### Caddy Path Routing
All traffic goes through Caddy on port 80. Path prefix is stripped before proxying:
| Path | Service | Notes |
|---|---|---|
| `/spacefight/*` | spacefight:3002 | REST + WS (`/spacefight/ws`) |
| `/alerts/*` | alerts:3003 | REST + WS (`/alerts/ws`) |
| `/stats/*` | stats:3004 | REST only |
| `/admin/*` | admin:3005 | Static admin pages |
| `/gamescenes/*` | gamescenes:3006 | Static scene overlays |
| `/bridge/*` | bridge:3000 | Health only |
| `/health` | admin:3005 | Aggregated health |
| `/redis-ui/*` | redis-ui:8081 | Redis Commander |
| `/` | → `/admin/` | Root redirect |

Because Caddy does `uri strip_prefix`, every service sees paths **without** its
prefix. Server code registers `/api/...` and `/health`; the browser calls
`/<service>/api/...`. Never hardcode the prefix server-side — and in `public/`
JS use a **relative** path (`fetch('api/spacefight/...')`), never a
root-relative one, or it 404s through Caddy.

`caddy/Caddyfile.ssl` is the HTTPS variant and is kept in sync by hand; the
non-SSL `Caddyfile` is the reference. `CADDY_CONFIG` in `.env` picks one.

### Event Flow
```
Streamerbot (WS :9090)
  ├─ alert actions ──────────────────────────────────► alerts/public/overlay.html
  │   (direct WS to Streamerbot, cc_alert_session — Bridge/Redis NOT involved)
  │
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

Note the split: live alerts do **not** travel this path — `overlay.html` talks
to Streamerbot directly. Only `first_chatter` still uses `ch:alerts`.

## Key Files
- `services/bridge/server.js` — Streamerbot WS client + Redis pub/sub router (`ROUTES`)
- `services/spacefight/server.js` — Spacefight REST + WS + fight engine
- `services/spacefight/public/spacefight.js` — Pixel-ship arena renderer (canvas particles + DOM ships, sprite sheets, RAF loop) **and** the `runFight` engine
- `services/spacefight/public/assets/ships/` — Per-ship sprite sheets (PNG, 32×32 × 12 frames); contract in the folder README
- `services/alerts/server.js` — Alert REST + WS + Claude AI + `/api/profile`
- `services/alerts/profile.js` — Pure `!id` dossier builder, unit-tested
- `services/alerts/public/overlay.html` — **The** alert renderer (inline JS/CSS)
- `services/alerts/public/chat.js` — HUD chat overlay logic
- `services/stats/server.js` — Read-only stats REST (no Redis, no WS)
- `services/admin/server.js` — Aggregated health + static admin pages. Ends in a
  `app.get('*')` SPA catch-all → `index.html`, so a typo'd admin path renders the
  dashboard instead of 404ing. `GET /health` fans out to the five service
  `/health` endpoints with a 3 s timeout each and returns 503 `degraded` if any
  fails
- `services/admin/public/admin-shared.js` — Canonical shared lib: `CC.validate`, nav bar, debug console
- `services/admin/public/rdoc-brand.css` — **Generated** brand tokens; never hand-edit
- `services/admin/public/rdoc-admin.css` — Admin page styles; maps brand tokens to app names
- `services/alerts/public/rdoc-overlay.css` — **The overlay design system.** HUD
  primitives (`.ov-signet`, `.ov-panel`, `.ov-tick`, `.ov-eyebrow`, `.ov-state`,
  `.ov-ident`) plus the HUD-chat and spacefight-arena styles. The rules it
  encodes are written at the top of the file — read that header before
  touching any overlay
- `caddy/Caddyfile` — Reverse proxy config
- `postgres/init.sql` — Schema; runs **only** on a fresh volume
- `streamerbot/SETUP.md` — Action import + queue setup

### Duplicated frontend files (important)
Each service's Docker build context is its own directory, so it cannot reach
another service's `public/`. Everything shared is therefore a copy.

**Byte-identical, one canonical source** — edit the canonical file, then copy it
over the rest:

| Files | Canonical | Verify |
|---|---|---|
| `{admin,spacefight,stats}/public/*-shared.js` | `admin/public/admin-shared.js` | `md5sum services/*/public/*-shared.js` |
| `{admin,spacefight,stats,alerts,gamescenes}/public/rdoc-brand.css` | RDOC-Brandkit `digital/web/brand.css` | `md5sum services/*/public/rdoc-brand.css` |
| `{alerts,spacefight}/public/rdoc-overlay.css` | `alerts/public/rdoc-overlay.css` | `md5sum services/*/public/rdoc-overlay.css` |
| `{admin,spacefight,stats,alerts}/public/favicon.{svg,ico}` | RDOC-Brandkit `digital/web/` | – |

`rdoc-brand.css` has **five** copies — `gamescenes` is easy to miss because it
has no other brand file. `gamescenes/public/favicon.svg` is **not** the kit
favicon (different hash) and is intentionally left out of the refresh loop.

The shared lib has **three** copies, not four: the alerts service ships only
OBS overlays now, and overlays never load it.

**Deliberately different per service** — do not assume a change in one applies
to the others:
- `rdoc-admin.css` — three versions in `admin/`, `spacefight/`, `stats/`. Only
  the `:root` token-mapping block at the top is meant to stay in sync.
- `rdoc-logo.svg` / `rdoc-logo-mono.svg` — only in `admin/`, `spacefight/`,
  `stats/`. Overlays never draw the lockup.

## Brand layer (RDOC Brand Kit)

All colour and type come from the **RDOC Brand Kit** (separate repo,
`RDOC-Brandkit/brandkit`), which is a generator: `scripts/tokens.js` emits
`digital/web/brand.css`. This project only consumes it.

Load order on every page: `rdoc-brand.css` first, then the page's own
`rdoc-admin.css` / `rdoc-overlay.css` / inline `<style>`. Every `<html>` carries
`data-theme="dark"`.

### Where colour may be defined
1. `rdoc-brand.css` — generated, never hand-edit.
2. The `:root` block of `rdoc-admin.css` / `rdoc-overlay.css`, which maps brand
   tokens to app names (`--bg`, `--bg2`, `--bg3`, `--text`, `--dim`, `--accent`,
   `--struct`, `--ok`, `--warn`, `--err`, `--border`).

Nowhere else. No hex and no inline `style="color:..."` in HTML or JS — add a
class. The exception is `rgba()` literals in the overlay files: `rgba()` cannot
take a CSS variable as a component, and OBS ships an older CEF than a desktop
browser, which is also why `color-mix()` is used only in the admin CSS.

`overlay.html`, `haul.html` and `sc-bodycam.html` are standalone by design
(inline JS/CSS); they link `rdoc-brand.css` for the tokens but keep their own
`<style>`, and they each restate the HUD primitives locally. `chat.html` and
`spacefight.html` are not standalone — they get everything from
`rdoc-overlay.css`.

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
- A state is never colour alone — it carries a word or icon (`SPIEL: AKTIV`,
  `WS: OFFLINE`, `PASS`).
- No gradient, glow, shadow or bevel, anywhere. Scanline layers, `text-shadow`
  glows and multi-stop hairlines were removed for this.
- Michroma (`--rdoc-font-display`) has **exactly one cut (400)** and runs at
  `letter-spacing: 0`. Emphasis via size or colour, never `font-weight`.
- The dock ring appears exactly once per lockup **and once per overlay view**.
  Never rebuild the wordmark as text — embed `rdoc-logo.svg`.
- Ring minimum size: 32 px regular, 24–32 px for the micro cut. The nav ring in
  `admin-shared.js` is the micro cut at 24 px; its path is a verbatim copy of
  `digital/icon/rdoc_signet_micro_copper.svg` with `fill="currentColor"`.
  Re-copy it from the kit rather than retyping coordinates.
- Overlay eyebrow labels use `0.3em` tracking instead of the token `0.07em` —
  they are read across a room at 1920 px. Only intentional type deviation.

### How an overlay spends colour
Every OBS source follows the same budget. It is the thing most likely to drift,
because inline styles in the standalone overlays make it easy to add "just one
more" accent:

| Slot | Colour | Notes |
|---|---|---|
| Signet | Copper | Once per view, ≥32 px, **never animated** |
| The one event / primary action | Copper | Event label, jackpot tag, rank 1 |
| Frame, corner ticks, rules, panel edges, table heads, section markers, avatar edge, one data series | Patina | Structure is never the accent |
| Username, message, stat number | Off White | A name is body voice — Plex Sans, not Michroma |
| Secondary lines, stat labels, starfield | Steel | |
| Win/loss, difficulty, low HP, link state, explosion | functional | Always beside its own word |

Consequences that are easy to get wrong:

- **The username is not an accent.** It used to change colour per event type,
  which put three or four accents on one alert and made the event legible only
  to someone who had learnt the code. The event is named in words instead.
- **Copper is never a border and never a frame.** `cc-frame-gold` survives as a
  class name because `buildAlert()` writes it, but it pulses Patina.
- **Body copy is never Copper.** The `H()` helper in `overlay.html` wraps
  emphasis in `.cc-em` (Plex Sans Semibold, a real cut), not in the accent.
- **A state colour is never decoration.** Warning yellow on an achievement chip
  or in a confetti burst spends a state on ornament.
- The two arena series are Copper (attacker) and Patina (defender) — the only
  pairing in the palette that separates at 640×200 over live video. One lookup,
  `sideColor()`, feeds the projectile, the spark and the sprite so they cannot
  drift apart.
- The spacefight placeholder sprite sheet hashes the ship name to a **hull from
  the neutrals**, not to a free hue. An unshipped class can no longer introduce
  an off-brand colour.

### Where each overlay spends its signet
| Overlay | Placement |
|---|---|
| `overlay.html` | Alert label row, shoutout panel, resub fullscreen — three views that never co-exist (shoutout and resub cover the alert with a backdrop) |
| `overlay.html` — `!id` dossier, compact corner alert | **No signet.** Both can be on screen while a centre alert is showing |
| `chat.html` | `.ov-ident` bar under the message column |
| `spacefight.html` | `#sf-ident`, bottom-left, opposite the Bestenliste |
| `haul.html` | `#ident`, bottom-left under the lane |
| `sc-bodycam.html` | `#ident`, bottom-right |

The SVG is a verbatim copy of `digital/icon/rdoc_signet_copper.svg` with `fill`
switched to `currentColor`. It is pasted per file because overlays share no
build context — re-copy it from the kit, never retype the coordinates.

### Light mode
`rdoc-brand.css` ships a complete measured light palette, but the app layer is
not wired for it: `data-theme="dark"` is hardcoded on every page. Without it an
OBS source reporting `prefers-color-scheme: light` would flip the overlay
tokens mid-stream.

### Refreshing the assets after a Brand Kit change
```bash
BK=../RDOC-Brandkit/brandkit
for s in admin spacefight stats alerts gamescenes; do
  cp $BK/digital/web/brand.css   services/$s/public/rdoc-brand.css
done
for s in admin spacefight stats alerts; do
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
- Spacefight overlay → `ws://server/spacefight/ws`
- Alert overlay (test channel only) → `ws://server/alerts/ws`

Every browser WS client sends `{ event: 'cc_identify', role: '<name>' }` on open.
Known roles: `spacefight-admin`, `spacefight-overlay`.

## OBS Overlay URLs
| Overlay | Path |
|---|---|
| Alert overlay (fullscreen, **the** alert renderer) | `/alerts/overlay.html` (clean/live by default; `?demo=1` = demo panel) |
| HUD Chat | `/alerts/chat.html?channel=DEIN_KANAL` |
| Hauling | `/alerts/haul.html` |
| Spacefight | `/spacefight/spacefight.html` (`?test=1` for local test fights) |
| Bodycam scene | `/gamescenes/sc-bodycam.html?player=Name` |

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
| GET | `/alerts/api/twitch/user/:login` | Twitch Helix user profile (cached) |
| POST | `/alerts/api/claude/summary` | AI summary; no built-in panel uses it any more |
| POST | `/alerts/api/profile` | `!id` dossier: enriches the Twitch/Hauling fields in the body with spacefight stats (server-to-server), returns an `alertType:'profile'` payload. Logic in `alerts/profile.js` (pure, unit-tested) |

### Stats Service (`/stats/api/...`)
Same three read paths as spacefight, but served straight from PostgreSQL with no
Redis and no WS. Duplicated on purpose so stats pages never touch the game
service.

### Health
| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Aggregated health (admin fans out to all services) |
| GET | `/<service>/health` | Per-service health (bridge, spacefight, alerts, stats, gamescenes) |

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
- Colour and type come only from the RDOC tokens — see "Brand layer". No hex in
  HTML or JS, no inline `style="color:..."`; add a class instead
- WebSocket events: `{ event: 'name', ... }` format
- Admin commands: `{ event: 'sf_cmd', cmd: '...' }`
- New WS events/cmds must be added to `ALLOWED_EVENTS`/`ALLOWED_CMDS` in the
  shared lib — **in all three copies**
- `CC.validate` namespace for all input sanitization (XSS, prototype pollution, WS payload validation)
- Debug console auto-intercepts all WS send/recv, fetch, button clicks — shown at bottom of all admin pages
- All services use `log(tag, ...args)` / `logErr(tag, ...args)` helpers — never raw `console.log`
- `sanitizeUsername(s)` — lowercase, alphanumeric + underscore, max 25 chars —
  defined separately in each `server.js` and in the C# actions; must stay
  consistent C# ↔ JS

## Spacefight Overlay (`services/spacefight/`)
The OBS overlay (`/spacefight/spacefight.html`, 640×200, transparent) is a
pixel-ship arena, not a text fight card. Both pilots fly pixel-art ships that
drift, fire projectiles, recoil on hit and explode on death. The outcome still
comes from the 5-round `runFight` engine in `spacefight.js` — only the renderer
changed; queue, cooldown, WS protocol, REST API and admin commands are untouched.

| Layer | Tech | Purpose |
|---|---|---|
| Background | Canvas `#sf-canvas` | Parallax starfield (3 depths) |
| Ships | DOM `<div class="ship">` with sprite-sheet `background-position` | GPU-translated; name label + HP bar are sibling DOM elements |
| Particles | Same canvas as background | Projectiles, muzzle flashes, impact sparks, explosion sparks, screen shake |

A single `requestAnimationFrame` loop drives starfield motion, ship state
interpolation (spring easing toward target position), sprite frame animation and
canvas particles. Round events (`hit_a/hit_d/miss_a/miss_d/kill_a/kill_d`) fire
on a `setTimeout` schedule and mutate ship state; the loop interpolates between
them.

### Sprite sheets
Per-ship PNGs live in `services/spacefight/public/assets/ships/<slug>.png`. Slug
is the lowercased ship class with non-alphanumerics → `-` (e.g. `ORIGIN 300I` →
`origin-300i.png`); `shipSlug()` implements this and is unit-tested in the
browser suite. Sheet format: 12 frames × 32×32 px, horizontal strip — idle 0–3,
thrust 4–6, hit 7, explosion 8–11. Sheets render at 2× scale with
`image-rendering: pixelated`. Missing or failed-to-load sheets fall back to a
procedural placeholder coloured from the class-name hash, so the overlay never
breaks. Full contract: `services/spacefight/public/assets/ships/README.md`.

Defender ships are mirrored at render time via `transform: scaleX(-1)` — ship
the right-facing variant only.

## Alert Overlays (`services/alerts/`)
`overlay.html` is **the single alert renderer** (source of truth). The legacy
`alerts.html`, `raid-info.html` and `shoutout-info.html` panels were removed —
all alert types render in `overlay.html`. C# actions must match its
`buildAlert()` field contract (see `streamerbot/SETUP.md`).

| File | Purpose |
|---|---|
| `overlay.html` | Fullscreen 1920×1080 overlay: centre alert + corner channel + Latest widget + cinematic shoutout + resub fullscreen + Canvas raid fleet. Standalone (inline JS/CSS). **Clean/live by default** (transparent, connects the Streamerbot WS, sound on); `?demo=1` shows a demo panel and does NOT connect live; `?sb=ws://host:port` overrides the WS. Assets in `public/assets/`, sounds in `public/sounds/` |
| `haul.html` | Hauling overlay for cargo runs. Standalone |
| `chat.html` / `chat.js` | HUD chat overlay; consumes `ch:chat` via `/alerts/ws`. Uses `rdoc-overlay.css` |

**Live alerts:** `overlay.html` connects directly to the Streamerbot WS server,
sends `{event:'cc_alert_register'}` and receives per-event custom broadcasts
(flat payload with a top-level `alertType`). Bridge/Redis is NOT in the live
alert path. The Streamerbot host is hardcoded in `overlay.html` — override per
source with `?sb=`.

**Profile dossier (`!id`):** `alertType: 'profile'` is not a transient
`buildAlert` alert — it is its own right-edge slide-in panel (`showProfile`).
Payload built by `alerts/profile.js`: `user, login, avatar,
fields[{label,value}], achievements[{icon,label}], statusLine`. Flow:
`CC_Id.cs` does no HTTP (Streamerbot inline lacks `System.Net`) — it broadcasts
raw Twitch/Hauling fields as `profile_request`; the overlay POSTs them to
`/alerts/api/profile`, gets the enriched payload back, then renders.

> Since the giveaway service left, `aggregateProfile()` no longer has a
> watchtime source: `watchSec`, `giveawayWins` and `msgs` are hardcoded 0 and
> `buildProfile` renders them as `—`. The dead HTTP lookup was removed so `!id`
> does not stall on a 3 s timeout. Re-add a lookup there if this stack ever
> gets a watchtime source again.

**Overlay `buildAlert` alertTypes + fields:** `follow`(user,avatar) ·
`cheer`(user,amount,avatar) · `sub`(user,tier,avatar) ·
`resub`(user,tier,cumulativeMonths,avatar) ·
`subgift`(user,recipient,amount,tier,avatar) · `subbomb`(user,amount,tier,avatar) ·
`raid`(user,amount,avatar,game) · `redeem`(user,reward,avatar) ·
`shoutout`(user,avatar,game) · `hypetrain`(level) · `outraid`(user,amount) ·
`streamstart`. Field reads are defensive (`avatar||profileImageUrl`,
`months||cumulativeMonths`, `amount||bits||viewers`). tier expects
`1000/2000/3000`.

**Admin test path:** the overlay opens a second WS to `/alerts/ws`
(`connectAdmin`) that only enqueues `_test`-flagged alerts, so real Streamerbot
events never double-fire. `/admin/alerts-test.html` sends
`{ event:'cc_test', alertType, ... }` → `injectTestAlert()` sanitizes and
`broadcastAll`s a `_test` alert → the overlay shows it. `cc_test` is in
`ALLOWED_EVENTS`.

Claude API key in `.env` as `ANTHROPIC_KEY` — never pass it as a URL param.

### Sound files
Two locations, both checked in:
- `services/alerts/public/sounds/` — used by `overlay.html`
- `services/alerts/public/sound_*.mp3` / `.ogg` — flat legacy copies

OBS browser source: enable **"Control audio via OBS"** for audio to appear in
the OBS mixer.

### Channel Point Rewards
Per-reward config lives in the `REWARDS` map inside `overlay.html`, keyed by
lowercased reward title. Extend the map to add a reward; no server change needed.

## Streamerbot C# Actions (`streamerbot/`)
**Two broadcast targets:**
- **Alert actions** send directly to `cc_alert_session` (set by
  `CC_AlertRegister.cs`) → `overlay.html`. They do not go through Bridge/Redis.
  Payload is flat with a top-level `alertType` plus the exact fields
  `buildAlert()` reads.
- **Spacefight/Chat actions** send to `cc_api_session` (set by
  `CC_ApiRegister.cs`) → Bridge → Redis channel.

Full setup/import guide: `streamerbot/SETUP.md`.

| File | Trigger | Target | Sends |
|---|---|---|---|
| `CC_ApiRegister.cs` | WS Custom Server Message | – | saves `cc_api_session` (Bridge) |
| `CC_AlertRegister.cs` | WS Custom Server Message | – | saves `cc_alert_session` (overlay.html) |
| `CC_HaulRegister.cs` | WS Custom Server Message | – | saves the hauling overlay session |
| `CC_ChatReply.cs` | WS Custom Server Message | chat | forwards chat_reply to Twitch chat |
| `CC_Follow.cs` | Twitch Follow | overlay | `alertType:follow` (user, avatar) |
| `CC_Cheer.cs` | Twitch Cheer | overlay | `alertType:cheer` (user, amount, avatar) |
| `CC_Sub.cs` ⭐ | Twitch Sub + Resub + GiftSub + CommunityGiftSub (all four on this one action) | overlay | auto: `sub`/`resub`/`subgift`/`subbomb`; tier normalized to `1000/2000/3000` |
| `CC_RaidBroadcaster.cs` | Twitch Raid | overlay | `alertType:raid` (user, amount, avatar, game) + chat msg |
| `CC_Redeem.cs` | Channel Point Redeem | overlay | `alertType:redeem`; overlay maps the reward via `REWARDS` |
| `CC_Shoutout.cs` | Command `!so` | overlay | `alertType:shoutout` + native Twitch shoutout |
| `CC_Id.cs` | Command `!id` | overlay | `alertType:profile_request`; overlay enriches via `/alerts/api/profile` |
| `CC_HypeTrain.cs` | Twitch Hype Train | overlay | `alertType:hypetrain` (level) |
| `CC_OutRaid.cs` | Twitch Raid Started / `!raid` | overlay | `alertType:outraid` (user, amount) |
| `CC_StreamStart.cs` | Stream Online | overlay | `alertType:streamstart` |
| `CC_ClipCreated.cs` | Clip Created | chat | clip title + URL |
| `CC_AdBreakStart.cs` / `CC_AdBreakEnd.cs` | Ad Break Start/End | chat | ad notices |
| `CC_FirstChatter.cs` | Chat Message | Bridge | `first_chatter` → `ch:alerts` → welcome chat reply |
| `Hauling.cs`, `Haulingsaldo.cs`, `Haulingtop.cs`, `Hauldelete.cs`, `Haulreset.cs` | Hauling commands | overlay/chat | hauling points and leaderboard |
| `SF_FightCmd.cs` | Command `!fight` | Bridge | `fight_cmd` |
| `SF_ChallengeAccept.cs` / `SF_ChallengeDecline.cs` | `!ja` / `!nein` | Bridge | accept/decline challenge |
| `SF_ChatTracker.cs` | Twitch Chat Message | Bridge | tracks active chatters |
| `SF_StreamOnline.cs` / `SF_StreamOffline.cs` | Stream Online/Offline | Bridge | enables/disables fights |

> Sub-variant consolidation is done: `CC_Sub.cs` handles all four sub events;
> `CC_Resub` / `CC_SubGift` / `CC_SubBomb` are gone.
> The `GW_*` actions were removed with the giveaway service.

## Data Storage

### Redis (ephemeral, DB 0)
| Key | Type | Written by |
|---|---|---|
| `sf_live` | `'true'`/`'false'` | spacefight — set by `stream_online`/`stream_offline` |
| `sf_game_active` | `'true'`/`'false'` | spacefight — set by `sf_start`/`sf_stop` |
| `sf:index` | sorted set (score = wins) | spacefight leaderboard ranking |
| `sf:dedup:<winner>:<loser>` | string, `EX 12 NX` | spacefight — blocks duplicate result writes for 12s |
| `cc_first_chatter_enabled` | `'true'`/`'false'` | alerts — first-chatter toggle |
| Twitch user cache | string | alerts — `getCachedTwitchUser` |

A fight only runs when **both** `sf_live` and `sf_game_active` are `'true'`.

### PostgreSQL (persistent)
`spacefight_stats` (wins/losses per user) and `spacefight_results` (fight
history, indexed on `winner` and `loser`). The giveaway tables (`users`,
`sessions`, `session_participants`, `watchtime_events`, `giveaway_draws`,
`debug_log`, view `winner_history`) are gone from `init.sql`; existing installs
keep them — no DROP is issued.

`init.sql` runs **only** on a fresh volume. Schema changes must be added as
numbered idempotent files in `postgres/migrations/` and applied by hand:

```bash
docker exec -i cc-postgres psql -U chaoscrew -d chaoscrew < postgres/migrations/00X_name.sql
```

The three files currently in `postgres/migrations/` (`002_debug_log`,
`003_giveaway_draws`, `004_giveaway_draws_prize`) are all giveaway-era and apply
to **no** table in the current `init.sql`. There is no `001`. Do not treat them
as a schema baseline — the next migration is `005`.

## Files in the repo that are NOT the stack

Do not take these as current — several predate the giveaway removal and still
describe `services/giveaway`, `gw_cmd` or giveaway overlays:

| Path | Status |
|---|---|
| `services/giveaway/` | Untracked leftover — only `node_modules/` + `package-lock.json`, no `server.js`, no compose entry. Safe to delete; it exists because git does not remove ignored dirs |
| `bugreport.md` | Old review. Its P0 (spacefight `public/` using root `/api/...` behind Caddy) **is already fixed** — all frontend fetches are relative now |
| `plan-fixes.md` | Fix plan for the same review; sections about `services/giveaway/server.js` are moot |
| `future-idea.md` | Public-deploy plan; carries its own "veraltet" banner about the giveaway split |
| `Overlay-Redesign mit Animationen/` | Design handoff dump (`Overlay Redesign.dc.html`, assets, a duplicate copy of the alert sounds). Not built, not served |
| `README.md` / `Installation.md` | German user-facing setup docs. Accurate on setup, but overlap this file — when they and CLAUDE.md disagree about architecture, the code wins, then CLAUDE.md |

## Known Issues

### Security — no auth on admin surfaces
- WS admin commands (`sf_cmd`) are accepted from any client reaching
  `/spacefight/ws`. No authentication exists.
- `POST /alerts/api/chat/send`, `/alerts/api/claude/summary` and
  `/alerts/api/profile` are public through Caddy — no token required.
- **Planned fix**: `ADMIN_TOKEN` env var; WS `{ event: 'cc_auth', token }`
  handshake before `handleSfCmd`; `x-admin-token` header on mutation REST
  endpoints.

### Streamerbot host is hardcoded
`overlay.html` embeds the Streamerbot WS address. Override per OBS source with
`?sb=ws://host:port`, or edit the constant.

## Environment
Copy `.env.example` → `.env`. Note that `.env.example` is **incomplete**: the
alerts service also reads `ANTHROPIC_KEY`, `TWITCH_CLIENT_ID` and
`TWITCH_CLIENT_SECRET`, which are not listed there. Without them
`/alerts/api/claude/summary` returns 503 and `/alerts/api/twitch/user/:login`
returns 503.

`.env` also carries the deploy target (`SSH_HOST`, `SSH_PORT`, `SSH_USER`,
`SSH_PASSWORD`, `SSH_DEPLOY_PATH`) and `CADDY_CONFIG` (`Caddyfile` or
`Caddyfile.ssl`).

Per-service connection vars (`PORT`, `REDIS_*`, `PG_*`, `SB_*`,
`BRIDGE_URL`/`SPACEFIGHT_URL`/`ALERTS_URL`/`STATS_URL`/`GAMESCENES_URL`) are
injected by `docker-compose.yml`, not by `.env` directly.

## Development

### Commands (run from `services/<name>/`)
```bash
npm start              # production start
npm run dev            # start with --watch (auto-restart on change)
```

There is **no** `test` script in any `package.json`, so `npm test` fails. Tests
that do exist:

- **alerts**: `services/alerts/tests/profile.test.js`, real `node:test`. Run it
  as `node --test tests/profile.test.js` from `services/alerts/` — pointing
  `node --test` at the directory fails on this Node version.
- **browser**: open `/admin/tests/test-runner.html`; suite in
  `services/admin/public/tests/test-suite.js`. Covers `CC.validate`, the nav
  bar and `shipSlug`.

If more Node tests are added, use `node --test` and Redis **DB 1** — never DB 0.

### Docker
```bash
docker compose up -d --build      # rebuild after code changes
docker compose logs -f <service>  # tail service logs
docker compose restart <service>  # restart one service
docker compose ps                 # health status
```

Frontend-only changes still need a rebuild of that service: `public/` is baked
into the image, not bind-mounted.

**Caddy is the exception.** The root `Dockerfile` (the only file at repo root
that is a Dockerfile) builds the `web` service from `caddy:2-alpine` and `COPY`s
`caddy/Caddyfile` in — but compose then bind-mounts
`./caddy/${CADDY_CONFIG}:/etc/caddy/Caddyfile:ro` over it, so the mount wins and
the `COPY` is dead weight. Routing changes need only `docker compose restart
web`, never `--build`. Node services are all `node:20-alpine`, so `fetch` and
`AbortSignal.timeout` (used in the admin health fan-out) are available.

### Backup
`cc-backup` dumps PostgreSQL daily at 03:00 to `/backups/postgres/`, retention
via `KEEP_DAYS` in `docker-compose.yml`. Manual: `docker exec cc-backup sh
/backup.sh`. Scripts in `backup/`.

### Deploy
The live stack runs on the LXC host in `.env` (`SSH_HOST`), path
`SSH_DEPLOY_PATH` (`/opt/streamertools`), checked out on branch
**`architecture-switch`** — not `main`. Deploy is: push the branch → SSH in →
`git pull` → `docker compose up -d --build`. Add `--remove-orphans` when a
service was removed from the compose file.

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
