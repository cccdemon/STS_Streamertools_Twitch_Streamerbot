# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Chaos Crew - Streamer Tools

## Project Overview
Twitch streamer toolset: Giveaway system, Spacefight chat game, HUD chat overlay, Alert overlays, and Streamerbot C# actions.
Dockerized microservices stack: Bridge + Giveaway + Spacefight + Alerts + Stats + Admin + Caddy + Redis + PostgreSQL.

## Architecture

### Services (all in `services/`)
| Service | Container | Port | Purpose |
|---|---|---|---|
| `bridge` | cc-bridge | 3000 | Streamerbot WS client → Redis pub/sub fan-out |
| `giveaway` | cc-giveaway | 3001 | Watchtime engine, coin calc, winner draw, WS admin |
| `spacefight` | cc-spacefight | 3002 | Fight engine, leaderboard, WS admin, pixel-ship arena overlay |
| `alerts` | cc-alerts | 3003 | Follow/cheer/raid/shoutout overlays, Claude AI, WS |
| `stats` | cc-stats | 3004 | Read-only aggregated stats from PostgreSQL, no WS |
| `admin` | cc-admin | 3005 | Shared admin pages, aggregated health check, no WS |
| `gamescenes` | cc-gamescenes | 3006 | Static OBS scene-transition overlays, no WS |
| Caddy | cc-web | 80/443 | Reverse proxy, path-based routing to services |
| Redis | cc-redis | 6379 | Ephemeral state (DB 0 = prod, DB 1 = tests) |
| PostgreSQL | cc-postgres | 5432 | Persistent data |
| Redis UI | cc-redis-ui | 8081 | Redis Commander |
| Backup | cc-backup | – | Daily cron backup at 03:00 |

### Caddy Path Routing
All traffic goes through Caddy on port 80. Path prefix is stripped before proxying:
| Path | Service | Notes |
|---|---|---|
| `/giveaway/*` | giveaway:3001 | REST + WS (`/giveaway/ws`) |
| `/spacefight/*` | spacefight:3002 | REST + WS (`/spacefight/ws`) |
| `/alerts/*` | alerts:3003 | REST + WS (`/alerts/ws`), HUD chat overlay |
| `/stats/*` | stats:3004 | REST only |
| `/admin/*` | admin:3005 | Static admin pages |
| `/gamescenes/*` | gamescenes:3006 | Static scene overlays (e.g. `/gamescenes/sc-bodycam-jerichoramirez.html`) |
| `/bridge/*` | bridge:3000 | Health only |
| `/health` | admin:3005 | Aggregated health |
| `/redis-ui/*` | redis-ui:8081 | Redis Commander |
| `/` | → `/admin/` | Root redirect |

### Event Flow
```
Streamerbot (WS :9090)
  └─ bridge/server.js ──publishes──► Redis pub/sub channels
        ch:giveaway    ──subscribe──► giveaway/server.js  ──broadcast──► browser WS
        ch:spacefight  ──subscribe──► spacefight/server.js ──broadcast──► browser WS
        ch:alerts      ──subscribe──► alerts/server.js    ──broadcast──► browser WS
        ch:chat        ──subscribe──► alerts/server.js    (HUD chat)
        ch:chat_reply  ◄──publish───  giveaway/server.js  (→ Streamerbot)
```

### Redis Pub/Sub Channels (Bridge routes)
| Event | Channel(s) |
|---|---|
| `viewer_tick`, `chat_msg`, `time_cmd` | `ch:giveaway` |
| `chat_msg` (HUD), `clip_created`, `ad_break_start`, `ad_break_end` | `ch:chat` |
| `fight_cmd`, `spacefight_challenge`, `spacefight_result`, `spacefight_rejected`, `stream_online`, `stream_offline` | `ch:spacefight` |
| `follow`, `cheer`, `raid`, `shoutout`, `first_chatter` | `ch:alerts` |
| `chat_reply` (outbound) | `ch:chat_reply` |

## Key Files
- `services/bridge/server.js` — Streamerbot WS client + Redis pub/sub router
- `services/giveaway/server.js` — Giveaway REST + WS + watchtime engine
- `services/giveaway/watchtime.js` — Coin/ticket calculation engine
- `services/giveaway/public/giveaway-shared.js` — Shared lib for giveaway pages
- `services/giveaway/public/giveaway-admin.js` — Giveaway admin panel logic
- `services/spacefight/server.js` — Spacefight REST + WS + fight engine
- `services/spacefight/public/spacefight.js` — Pixel-ship arena renderer (canvas particles + DOM ships, sprite sheets, RAF loop)
- `services/spacefight/public/spacefight-shared.js` — Shared lib for spacefight pages
- `services/spacefight/public/assets/ships/` — Per-ship-class sprite sheets (PNG, 32×32 × 12 frames); contract in folder README
- `services/alerts/server.js` — Alert overlays REST + WS + Claude AI
- `services/alerts/public/alerts-shared.js` — Shared lib for alert overlays
- `services/alerts/public/chat.js` — HUD chat overlay logic
- `services/stats/server.js` — Read-only stats REST (no Redis, no WS)
- `services/stats/public/stats.js` — Stats page logic
- `services/stats/public/stats-shared.js` — Shared lib for stats page
- `services/admin/server.js` — Aggregated health + static admin pages
- `services/admin/public/admin-shared.js` — Shared lib: `CC.validate`, nav bar, debug console
- `caddy/Caddyfile` — Reverse proxy config

## WS Connections (per service)
Admin pages connect to their own service WS via Caddy:
- Giveaway admin → `ws://server/giveaway/ws`
- Spacefight admin → `ws://server/spacefight/ws`
- Alert overlays → `ws://server/alerts/ws`

Every browser WS client sends `{ event: 'cc_identify', role: '<name>' }` on open.

Known roles: `giveaway-admin`, `spacefight-admin`, `giveaway-test`, `spacefight-overlay`, `shoutout-overlay`, `raid-overlay`

## OBS Overlay URLs
| Overlay | Path |
|---|---|
| Giveaway overlay | `/giveaway/giveaway-overlay.html` |
| Join animation | `/giveaway/giveaway-join.html` |
| Spacefight | `/spacefight/spacefight.html` |
| HUD Chat | `/alerts/chat.html?channel=DEIN_KANAL` |
| Alert overlay (Redesign, fullscreen, **the** alert renderer) | `/alerts/overlay.html` (clean/live by default; `?demo=1` = demo panel) |
| HUD Chat | `/alerts/chat.html?channel=DEIN_KANAL` |
| Bodycam scene | `/gamescenes/sc-bodycam.html?player=Name` |

## REST API Endpoints

### Giveaway Service (`/giveaway/api/...`)
| Method | Path | Purpose |
|---|---|---|
| GET | `/giveaway/api/participants` | Current session participants |
| GET | `/giveaway/api/user/:username` | Single user giveaway data |
| GET | `/giveaway/api/sessions` | Session history |
| GET | `/giveaway/api/leaderboard` | Global leaderboard (watchtime) |
| GET | `/giveaway/api/draws` | Draw audit trail (`?session=`, `?full=1`, `?limit=`) |
| GET | `/giveaway/api/ws/clients` | Connected WS clients |

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
| POST | `/alerts/api/chat/send` | Send Twitch chat (via Streamerbot) |
| GET | `/alerts/api/twitch/user/:login` | Twitch user profile (cached) |
| POST | `/alerts/api/claude/summary` | AI summary for overlays |
| POST | `/alerts/api/profile` | `!id` Steckbrief: enriches Twitch/Hauling fields (body) with watchtime+giveaway+spacefight (server-to-server), returns `alertType:'profile'` payload. Logic in `alerts/profile.js` (pure, unit-tested). |

### Stats Service (`/stats/api/...`)
| Method | Path | Purpose |
|---|---|---|
| GET | `/stats/api/sessions` | Session history |
| GET | `/stats/api/leaderboard` | Global leaderboard |
| GET | `/stats/api/winners` | Past giveaway winners |
| GET | `/stats/api/spacefight/leaderboard` | Spacefight leaderboard |
| GET | `/stats/api/spacefight/history` | Fight history |
| GET | `/stats/api/spacefight/player/:username` | Single player stats |

### Health
| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Aggregated health (all services) |
| GET | `/<service>/health` | Per-service health (bridge, giveaway, spacefight, alerts, stats) |

## Admin WS Commands

`gw_cmd` payload (`{ event: 'gw_cmd', cmd: '...' }`):
| cmd | Effect |
|---|---|
| `gw_open` | Open giveaway |
| `gw_close` | Close giveaway |
| `gw_draw_winner` | Draw random winner (weighted by tickets) |
| `gw_set_keyword` | Set join keyword (+ `keyword` field) |
| `gw_get_keyword` | Request current keyword |
| `gw_add_ticket` | Add tickets (+ `username`, `amount`) |
| `gw_sub_ticket` | Remove tickets (+ `username`, `amount`) |
| `gw_ban` / `gw_unban` | Ban/unban user |
| `gw_reset` | Full giveaway reset |
| `cc_first_chatter_toggle` | Toggle first-chatter welcome feature |

`sf_cmd` payload (`{ event: 'sf_cmd', cmd: '...' }`):
| cmd | Effect |
|---|---|
| `sf_start` | Activate spacefight game |
| `sf_stop` | Deactivate spacefight game |
| `sf_reset` | Reset all stats + history |
| `sf_delete_player` | Remove player (+ `username`) |
| `sf_edit_player` | Edit player stats (+ `username`, `wins`, `losses`) |

## Conventions
- German UI text throughout (Twitch streamer is German-speaking)
- All admin pages load `admin-shared.js` (in `services/admin/public/`) as first script in `<body>`
- OBS overlays do NOT include `admin-shared.js` (no nav/debug console)
- CSS files: `chaos-crew-admin.css` (admin pages), `chaos-crew-overlay.css` (OBS overlays) — copied per-service
- WebSocket events: `{ event: 'name', ... }` format
- Admin commands: `{ event: 'gw_cmd|sf_cmd', cmd: '...' }`
- New WS events/cmds must be added to `ALLOWED_EVENTS`/`ALLOWED_CMDS` in `admin-shared.js`
- `CC.validate` namespace for all input sanitization (XSS, prototype pollution, WS payload validation)
- Debug console auto-intercepts all WS send/recv, fetch, button clicks — shown at bottom of all admin pages
- All services use `log(tag, ...args)` / `logErr(tag, ...args)` helpers — never raw `console.log`
- `sanitizeUsername(s)` — lowercase, alphanumeric + underscore, max 25 chars — must be consistent C# ↔ JS

## Spacefight Overlay (`services/spacefight/`)
The OBS overlay (`/spacefight/spacefight.html`, 640×200, transparent) is a pixel-ship arena, not a text fight card. Both pilots are flying pixel-art ships that drift, fire projectiles, recoil on hit, and explode on death. Combat outcome still comes from the existing 5-round `runFight` engine in `spacefight.js` — only the renderer changed; the fight queue, cooldown, WS protocol, REST API, and admin commands are untouched.

| Layer | Tech | Purpose |
|---|---|---|
| Background | Canvas `#sf-canvas` | Parallax starfield (3 depths) |
| Ships | DOM `<div class="ship">` with sprite-sheet `background-position` | GPU-translated; name label + HP bar are sibling DOM elements |
| Particles | Same canvas as background | Projectiles, muzzle flashes, impact sparks, explosion sparks, screen shake |

A single `requestAnimationFrame` loop drives starfield motion, ship state interpolation (spring easing toward target position), sprite frame animation, and canvas particles. Round events (`hit_a/hit_d/miss_a/miss_d/kill_a/kill_d`) fire on `setTimeout` schedule and mutate ship state; the loop interpolates between them.

### Sprite sheets
Per-ship PNGs live in `services/spacefight/public/assets/ships/<slug>.png`. Slug is the lowercased ship class with non-alphanumerics → `-` (e.g. `ORIGIN 300I` → `origin-300i.png`). Sheet format: 12 frames × 32×32 px, horizontal strip — idle 0–3, thrust 4–6, hit 7, explosion 8–11. Sheets render at 2× scale (64×64 displayed) with `image-rendering: pixelated`. Missing or failed-to-load sheets fall back to a procedural placeholder colored from the class-name hash, so the overlay never breaks. Full contract: `services/spacefight/public/assets/ships/README.md`.

Defender ships are mirrored at render time via `transform: scaleX(-1)` — ship the right-facing variant only.

## Alert Overlays (`services/alerts/`)
`overlay.html` is **the single alert renderer** (source of truth). The legacy
`alerts.html`, `raid-info.html`, `shoutout-info.html` panels were **removed** —
all alert types now render in `overlay.html`. C# actions must match its
`buildAlert()` field contract (see `streamerbot/SETUP.md`).

| File | Purpose |
|---|---|
| `overlay.html` | **Redesign** — fullscreen 1920×1080 sci-fi overlay: big center alert + compact corner channel + Latest widget + cinematic shoutout + resub-fullscreen + Canvas raid Reaper fleet. Standalone (inline JS/CSS, no external js/css). **Clean/live by default** (transparent, connects Streamerbot WS at `ws://192.168.178.39:9090`, sound on); `?demo=1` shows demo panel+backdrop (muted, does NOT connect live); `?sb=ws://host:port` overrides WS. Assets in `public/assets/`, sounds in `public/sounds/`. |
| `chat.html` / `chat.js` | HUD chat overlay (separate; consumes `ch:chat` via `/alerts/ws`) |

**Live alerts:** `overlay.html` connects directly to the Streamerbot WS server, sends `{event:'cc_alert_register'}`, and receives per-event custom broadcasts (flat payload with top-level `alertType`). Bridge/Redis is NOT in the live alert path.

**Profil-Steckbrief (`!id`):** alertType `profile` is NOT a transient `buildAlert` alert — own right-edge slide-in dossier panel (`showProfile`, 560px card, header „RDOC · GEHEIMDIENSTINFORMATIONEN · CONFIDENTIAL", 12s, no dim backdrop). Payload (built by `alerts/profile.js`): `user, login, avatar, fields[{label,value}], achievements[{icon,label}], statusLine`. Flow: `CC_Id.cs` does NO HTTP (Streamerbot inline lacks `System.Net`) — it broadcasts raw Twitch/Hauling fields as alertType `profile_request` to `cc_alert_session`; the overlay (`loadProfileRequest`) POSTs them to `/alerts/api/profile` (same origin), gets the enriched `profile` payload back, then `showProfile`. Admin preview: ALERT TEST → "PROFIL (!id)" sends `cc_test` alertType `profile` → `injectTestAlert` server-aggregates + broadcasts a full `profile`.

**Overlay `buildAlert` alertTypes + fields:** `follow`(user,avatar) · `cheer`(user,amount,avatar) · `sub`(user,tier,avatar) · `resub`(user,tier,cumulativeMonths,avatar) · `subgift`(user,recipient,amount,tier,avatar) · `subbomb`(user,amount,tier,avatar) · `raid`(user,amount,avatar,game) · `redeem`(user,reward,avatar) · `shoutout`(user,avatar,game) · `hypetrain`(level) · `outraid`(user,amount) · `streamstart`. Field reads are defensive (`avatar||profileImageUrl`, `months||cumulativeMonths`, `amount||bits||viewers`). tier expects `1000/2000/3000`.

**Admin test path:** overlay opens a 2nd WS to `/alerts/ws` (`connectAdmin`) that only enqueues `_test`-flagged alerts (real Streamerbot events never double-fire). Admin page `/admin/alerts-test.html` sends `{ event:'cc_test', alertType, user, recipient, amount, tier, months, level, reward, game, avatar }` → `alerts/server.js` `injectTestAlert()` sanitizes + `broadcastAll` a `_test` alert → overlay shows it. `cc_test` is in `ALLOWED_EVENTS` (admin-shared.js).

Claude API key in `.env` as `ANTHROPIC_KEY`. `POST /alerts/api/claude/summary` handles AI calls (no longer used by a built-in panel; available for future use).

### Sound files
Checked into `services/alerts/public/`:
`sound_follow.mp3`, `sound_sub.mp3`, `sound_bits.mp3`, `sound_bomb.mp3`, `sound_raid.mp3`, `sound_redeem.mp3`, `sound_hype.mp3`, `sound_outraid.mp3`, `sound_alert.ogg`, `sound_battle.mp3`, `sound_rip.mp3`, `sound_selfie.mp3`

OBS browser source: enable **"Control audio via OBS"** for audio to appear in the OBS mixer.

### Channel Point Rewards
Per-reward overlay config lives in the `CHANNEL_REWARDS` map in `alerts.html` — keyed by lowercased reward title. Each entry: `{ label, msg(user), stat, flash, sound }`. Add new rewards by extending this map; no server changes needed.

## Streamerbot C# Actions (`streamerbot/`)
**Two broadcast targets:**
- **Alert actions** send directly to `cc_alert_session` (set by `CC_AlertRegister.cs`) → `overlay.html`. They do NOT go through the Bridge/Redis. Payload is flat with a top-level `alertType` + the exact fields `overlay.html` `buildAlert()` reads.
- **Giveaway/Spacefight/Chat actions** send to `cc_api_session` (set by `CC_ApiRegister.cs`) → Bridge → Redis channel.

Full setup/import guide: `streamerbot/SETUP.md`.

| File | Trigger | Target | Sends |
|---|---|---|---|
| `CC_ApiRegister.cs` | WS Custom Server Message | – | saves `cc_api_session` (Bridge) |
| `CC_AlertRegister.cs` | WS Custom Server Message | – | saves `cc_alert_session` (overlay.html) |
| `CC_ChatReply.cs` | WS Custom Server Message | chat | forwards chat_reply to Twitch chat |
| `CC_Follow.cs` | Twitch Follow | overlay | `alertType:follow` (user, avatar) |
| `CC_Cheer.cs` | Twitch Cheer | overlay | `alertType:cheer` (user, amount, avatar) |
| `CC_Sub.cs` ⭐ | Twitch Sub + Resub + GiftSub + CommunityGiftSub (all 4 on this one action) | overlay | auto: `sub`/`resub`/`subgift`/`subbomb`; tier normalized to `1000/2000/3000` |
| `CC_RaidBroadcaster.cs` | Twitch Raid | overlay | `alertType:raid` (user, amount, avatar, game) + chat msg |
| `CC_Redeem.cs` | Channel Point Redeem | overlay | `alertType:redeem` (user, reward, avatar) — overlay maps reward via `REWARDS` |
| `CC_Shoutout.cs` | Command `!so` | overlay | `alertType:shoutout` (user, avatar, game) + native Twitch shoutout |
| `CC_Id.cs` | Command `!id` | overlay | broadcasts `alertType:profile_request` (raw Twitch/Hauling fields, no C# HTTP); overlay enriches via `/alerts/api/profile` → dossier (watchtime, achievements, status) |
| `CC_HypeTrain.cs` | Twitch Hype Train | overlay | `alertType:hypetrain` (level) |
| `CC_OutRaid.cs` | Twitch Raid Started / `!raid` | overlay | `alertType:outraid` (user, amount) |
| `CC_StreamStart.cs` | Stream Online | overlay | `alertType:streamstart` |
| `CC_Clip.cs` | Command `!clip` | chat | creates a Twitch clip (`CPH.CreateClip()`) + posts URL |
| `CC_ClipCreated.cs` | Clip Created | chat | clip title + URL |
| `CC_AdBreakStart.cs` / `CC_AdBreakEnd.cs` | Ad Break Start/End | chat | ad notices |
| `CC_FirstChatter.cs` | Chat Message | Bridge | first_chatter → ch:alerts → welcome chat reply |
| `GW_A_ViewerTick.cs` | Twitch Present Viewer | Bridge | viewer_tick |
| `GW_B_ChatMessage.cs` | Twitch Chat Message | Bridge | chat_msg |
| `GW_TimeInfo.cs` | Command `!time` / `!coin` | Bridge | time_cmd |
| `GW_Leaderboard.cs` | Command `!top` | chat | queries stats API, posts top 3 |
| `SF_FightCmd.cs` | Command `!fight` | Bridge | fight_cmd |
| `SF_ChallengeAccept.cs` / `SF_ChallengeDecline.cs` | `!ja` / `!nein` | Bridge | accept/decline challenge |
| `SF_ChatTracker.cs` | Twitch Chat Message | Bridge | tracks active chatters |
| `SF_StreamOnline.cs` / `SF_StreamOffline.cs` | Stream Online/Offline | Bridge | enables/disables fights |

> ✅ Sub-variant consolidation done: `CC_Sub.cs` handles all four sub events; `CC_Resub/CC_SubGift/CC_SubBomb` removed.
> Alert delivery is overlay-direct: the Bridge→ch:alerts path no longer carries follow/cheer/raid/sub/shoutout (only `first_chatter`).

## Data Storage
- **Redis (ephemeral)**: giveaway open/closed, current keyword, banned users, watchsec/msgs per user, spacefight live/active flags, first chatter toggle, session ID, Twitch user cache
- **PostgreSQL (persistent)**: `sessions`, `users` (giveaway winners, ticket counts), `session_participants` (per-session snapshot), `watchtime_events` (tick/chat_bonus audit), `giveaway_draws` (full draw audit trail — winner, eligible snapshot, rand, totals), `spacefight_stats` (wins/losses), `spacefight_results` (fight history), `debug_log`

## Known Issues (as of 2026-05-06)

### Security — no auth on admin surfaces
- WS admin commands (`gw_cmd`, `sf_cmd`) are accepted from any client reaching `/giveaway/ws` or `/spacefight/ws`. No authentication exists yet.
- `POST /alerts/api/chat/send` and `POST /alerts/api/claude/summary` are public through Caddy — no token required.
- **Planned fix**: `ADMIN_TOKEN` env var; WS `{ event: "cc_auth", token }` handshake before `handleAdminCmd`/`handleSfCmd`; `x-admin-token` header on mutation REST endpoints.

### Routing bugs
- `caddy/Caddyfile.ssl` proxies `/api/*` and `/health` to a nonexistent `api:3000` service. The non-SSL `caddy/Caddyfile` is correct — use it as the reference.
- Spacefight public JS (`spacefight.js`, `spacefight-admin.js`) fetches root-relative `/api/spacefight/...` paths, which 404 through Caddy. Should be `/spacefight/api/spacefight/...`.

### Data integrity — FIXED 2026-06-25
- ~~`spacefight_result` saved twice~~ FIXED: dead pub/sub `spacefight_result` handler removed (overlay is sole producer, sends via WS only); `saveSpacefightResult` now guards with a 12s Redis `sf:dedup:<winner>:<loser>` NX-lock (covers multiple open overlays each running their own `runFight`).
- ~~`closeGiveaway()` double-counts lifetime totals~~ FIXED: `UPDATE sessions ... WHERE id=$1 AND closed_at IS NULL` guard; lifetime upsert only runs when `rowCount>0` (first close wins).
- ~~`gw_draw_winner` `times_won` no-op~~ FIXED: rewritten as testable `WatchtimeEngine.drawWinner(sessionId, {test})`. Upserts the winner into `users` (no more silent no-op), crypto-weighted pick, fully transactional, works even after close. `times_won` counts once per session and is reroll-safe (decrements previous session winner on re-draw).

### Giveaway draw auditability (Nachvollziehbarkeit)
Every draw writes a row to `giveaway_draws` (see Data Storage). `eligible_snapshot` (ordered username+coins) + `total_coins` + `rand_value` make any draw reproducible: walk the snapshot accumulating coins until `rand_value < acc` → winner. `is_test=true` rows (overlay/admin test draws) are audited but never touch `users`/`sessions`. Query via `GET /giveaway/api/draws` (`?session=<id>`, `?full=1` for snapshot, `?limit=`).

> Schema note: `giveaway_draws` is created by `init.sql` (fresh volume), `migrations/003_giveaway_draws.sql` (existing volume — NOT auto-applied), AND guaranteed at giveaway-service startup via `ensureSchema()`. The startup ensure is the reliable path; migrations are not auto-run by compose.

## Development

### Commands (run from `services/<name>/`)
```bash
npm start              # production start
npm run dev            # start with --watch (auto-restart on change)
npm test               # node --test tests/*.test.js (uses Redis DB 1)
```

Browser tests: open `/admin/tests/test-runner.html` in a browser.

### Docker
```bash
docker-compose up -d           # start all services
docker-compose up -d --build   # rebuild after code changes
docker-compose logs -f giveaway # tail service logs
```

### Redis
- DB 0 = production, DB 1 = tests — never use DB 0 in test code

### Deploy
Push to git → SSH into LXC → pull + `docker-compose up -d --build`

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
