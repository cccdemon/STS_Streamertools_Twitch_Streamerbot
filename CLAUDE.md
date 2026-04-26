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
| `spacefight` | cc-spacefight | 3002 | Fight engine, leaderboard, WS admin |
| `alerts` | cc-alerts | 3003 | Follow/cheer/raid/shoutout overlays, Claude AI, WS |
| `stats` | cc-stats | 3004 | Read-only aggregated stats from PostgreSQL, no WS |
| `admin` | cc-admin | 3005 | Shared admin pages, aggregated health check, no WS |
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
- `services/spacefight/public/spacefight-shared.js` — Shared lib for spacefight pages
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
| Alert bar | `/alerts/alerts.html` |
| Raid info | `/alerts/raid-info.html` |
| Shoutout info | `/alerts/shoutout-info.html` |

## REST API Endpoints

### Giveaway Service (`/giveaway/api/...`)
| Method | Path | Purpose |
|---|---|---|
| GET | `/giveaway/api/participants` | Current session participants |
| GET | `/giveaway/api/user/:username` | Single user giveaway data |
| GET | `/giveaway/api/sessions` | Session history |
| GET | `/giveaway/api/leaderboard` | Global leaderboard (watchtime) |
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

## Alert Overlays (`services/alerts/`)
All three overlays connect to alerts service WS via `/alerts/ws`.

| File | Purpose |
|---|---|
| `alerts.html` | Bottom-bar alert (follow, sub, bits, raid, subgift, subbomb, hypetrain, redeem, shoutout, outraid) |
| `raid-info.html` | Right-panel raid info with AI summary (Claude API, Firefly theme) |
| `shoutout-info.html` | Right-panel shoutout info with AI summary + chat reply via `/alerts/api/chat/send` |

Claude API key in `.env` as `ANTHROPIC_KEY` — never pass it as URL param. `POST /alerts/api/claude/summary` handles all AI calls.

### Sound files
Checked into `services/alerts/public/`:
`sound_follow.mp3`, `sound_sub.mp3`, `sound_bits.mp3`, `sound_bomb.mp3`, `sound_raid.mp3`, `sound_redeem.mp3`, `sound_hype.mp3`, `sound_outraid.mp3`, `sound_alert.ogg`, `sound_battle.mp3`, `sound_rip.mp3`, `sound_selfie.mp3`

OBS browser source: enable **"Control audio via OBS"** for audio to appear in the OBS mixer.

### Channel Point Rewards
Per-reward overlay config lives in the `CHANNEL_REWARDS` map in `alerts.html` — keyed by lowercased reward title. Each entry: `{ label, msg(user), stat, flash, sound }`. Add new rewards by extending this map; no server changes needed.

## Streamerbot C# Actions (`streamerbot/`)
All broadcasters send to `cc_api_session` (set by `CC_ApiRegister.cs`) via `CPH.WebsocketCustomServerBroadcast`.
Bridge receives the event and routes it to the correct Redis channel.

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
| `GW_A_ViewerTick.cs` | GW – Viewer Tick | Twitch Present Viewer | Sends viewer_tick to bridge |
| `GW_B_ChatMessage.cs` | GW – Chat Message | Twitch Chat Message | Sends chat_msg to bridge |
| `GW_TimeInfo.cs` | GW – Time Info | Command `!time` / `!coin` | Sends time_cmd to bridge |
| `GW_Leaderboard.cs` | GW – Leaderboard | Command `!top` | Queries stats API, posts top 3 to chat |
| `SF_FightCmd.cs` | SF – Fight Cmd | Command `!fight` | Sends fight_cmd to bridge |
| `SF_ChallengeAccept.cs` | SF – Challenge Accept | Command `!ja` | Accepts pending spacefight challenge |
| `SF_ChallengeDecline.cs` | SF – Challenge Decline | Command `!nein` | Declines pending spacefight challenge |
| `SF_ChatTracker.cs` | SF – Chat Tracker | Twitch Chat Message | Tracks active chatters for fight matchmaking |
| `SF_StreamOnline.cs` | SF – Stream Online | Stream Online | Sends stream_online → enables fights |
| `SF_StreamOffline.cs` | SF – Stream Offline | Stream Offline | Sends stream_offline → disables fights |

> Known issue (commits `e81f770`, `bec98cc`): each sub variant has its own action — should be consolidated.

## Data Storage
- **Redis (ephemeral)**: giveaway open/closed, current keyword, banned users, watchsec/msgs per user, spacefight live/active flags, first chatter toggle, session ID, Twitch user cache
- **PostgreSQL (persistent)**: `sessions`, `users` (giveaway winners, ticket counts), `spacefight_stats` (wins/losses), `spacefight_results` (fight history)

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
