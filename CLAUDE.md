# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Chaos Crew - Streamer Tools

## Project Overview
Twitch streamer toolset: Giveaway system, Spacefight chat game, HUD chat overlay, Alert overlays, and Streamerbot C# actions.
Dockerized stack: Node.js API + Redis + PostgreSQL + Caddy reverse proxy.

## Architecture
- **API Server** (`api/server.js`): Express REST + WebSocket (port 9091 browser WS, connects to Streamerbot on 9090)
- **Watchtime Engine** (`api/watchtime.js`): Coin/ticket calculation from viewer ticks + chat messages
- **Web Admin Pages** (`web/`): Admin panels, stats, test console — all use `chaos-crew-shared.js` for validation + nav + debug console
- **OBS Overlays** (`web/giveaway/giveaway-overlay.html`, `giveaway-join.html`, `web/chat.html`, `web/games/spacefight.html`, `web/alerts/alerts.html`): Lightweight, no shared JS (OBS browser sources)

## Key Files
- `web/chaos-crew-shared.js` — Shared module loaded by all admin pages: input validation (`CC.validate`), nav bar, debug console, WS event whitelist (`ALLOWED_EVENTS`, `ALLOWED_CMDS`)
- `api/server.js` — Main API: REST endpoints + WS server + Streamerbot client
- `api/watchtime.js` — Watchtime/coin engine with Redis keys
- `web/giveaway/giveaway-admin.js` — Giveaway admin panel logic
- `web/giveaway/giveaway-test.js` — Test console for simulating events
- `web/games/spacefight.js` — Spacefight game overlay + engine (connects to API on 9091)
- `web/games/spacefight-admin.js` — Spacefight admin panel (game toggle, leaderboard CRUD)
- `web/alerts/alerts.html` — Alert overlay (follow, sub, bits, raid, redeem, hype train)

## Event Flow
- Streamerbot sends raw events to API (9090 → 9091): `fight_cmd`, `chat_msg`, `viewer_tick`, `raid`, `shoutout`, `follow`, `cheer`, `first_chatter`, etc.
- API processes, persists, and broadcasts to all browser clients via `broadcastAll()`
- Admin panels send commands via WS: `{ event: 'gw_cmd', cmd: '...' }` or `{ event: 'sf_cmd', cmd: '...' }`
- Spacefight: Admin activates game → `sf_game_active` in Redis → `fight_cmd` only forwarded when active
- Giveaway: Admin opens/closes → watchtime engine tracks coins → draw winner
- First chatter: `cc_first_chatter_enabled` Redis key (default off) — toggled via giveaway admin panel (`cc_first_chatter_toggle` cmd)

## WS Client Identification
Every browser WS client sends `{ event: 'cc_identify', role: '<name>' }` on open. The API stores metadata per client (role, IP, connectedAt, msgCount) and broadcasts `ws_clients` on any change. All client messages also trigger a `ws_traffic` broadcast. Admin panels (giveaway, spacefight) render live client lists and traffic logs.

Known roles: `giveaway-admin`, `spacefight-admin`, `giveaway-test`, `spacefight-overlay`, `shoutout-overlay`, `raid-overlay`

## Conventions
- German UI text throughout (Twitch streamer is German-speaking)
- All admin pages include `chaos-crew-shared.js` as first script in `<body>` (before other content)
- CSS files: `chaos-crew-admin.css` (admin pages), `chaos-crew-overlay.css` (OBS overlays)
- WebSocket events use `{ event: 'name', ... }` format
- Admin commands: `{ event: 'gw_cmd|sf_cmd', cmd: '...' }`
- New WS events/cmds must be added to `ALLOWED_EVENTS`/`ALLOWED_CMDS` in `chaos-crew-shared.js`
- `CC.validate` namespace for all input sanitization (XSS, prototype pollution, WS payload validation)
- Debug console at bottom of admin pages auto-intercepts all WS send/recv, fetch requests, button clicks, and user actions
- `api/server.js` uses `log(tag, ...args)` / `logErr(tag, ...args)` helpers — all output goes through these, never raw `console.log`

## Alert Overlays (`web/alerts/`)
All three overlays connect to the **API WS on 9091**, not Streamerbot directly.

| File | Purpose |
|---|---|
| `alerts.html` | Bottom-bar alert (follow, sub, resub, bits, raid, subgift, subbomb, hypetrain, redeem, shoutout, outraid) |
| `raid-info.html` | Right-panel raid info with AI summary (Claude API, Firefly theme) |
| `shoutout-info.html` | Right-panel shoutout info with AI summary + chat reply via `/api/chat/send` |

### alerts.html WS message formats
Three formats accepted (checked in order):
1. **Format A** — `{ alertType: 'follow', user, ... }` — used by CC_Follow/CC_Cheer/CC_RaidBroadcaster via API
2. **Format B** — `{ event: { source: 'General', type: 'Custom' }, data: { alertType, ... } }` — Streamerbot native broadcast
3. **Format C** — native Streamerbot subscription events (Follow, Sub, Cheer, etc.) — only works when connected directly to Streamerbot on 9090

Claude API key is stored server-side in `.env` as `ANTHROPIC_KEY` — **never pass it as a URL param**. The `POST /api/claude/summary` endpoint handles all AI calls; overlays POST `{ type, user, game, bio }` and receive `{ summary }`.

New alert types routed through API must:
- Send `{ event: 'X', alertType: 'X', ... }` from C# (both fields needed)
- Add `case 'X':` to the `broadcastAll` switch in `server.js`

### Sound files
`web/alerts/` requires these files (not committed — add manually):
`sound_follow.mp3`, `sound_sub.mp3`, `sound_bits.mp3`, `sound_bomb.mp3`, `sound_raid.mp3`, `sound_redeem.mp3`, `sound_hype.mp3`, `sound_outraid.mp3`

OBS browser source: enable **"Control audio via OBS"** in source properties for audio to appear in the OBS mixer.

## Streamerbot C# Actions (`streamerbot/`)
All broadcasters send to `cc_api_session` (set by `CC_ApiRegister.cs` on connect) via `CPH.WebsocketCustomServerBroadcast`.

- `CC_ApiRegister.cs` — Registers API session on WS connect
- `CC_AlertRegister.cs` — Registers overlay sessions (alert, raid, shoutout)
- `CC_RaidBroadcaster.cs` — Forwards `raid` events to API → alerts.html + raid-info.html
- `CC_Follow.cs` — Forwards `follow` events to API → alerts.html
- `CC_Cheer.cs` — Forwards `cheer` (bits) events to API → alerts.html
- `CC_Shoutout.cs` — Forwards shoutout events to API → shoutout-info.html
- `CC_ChatReply.cs` — Sends chat messages from API back to Twitch
- `CC_ClipCreated.cs` — Sends clip title + URL as chat message on Clip Created
- `CC_AdBreakStart.cs` — Sends ad break start notice as chat message
- `CC_AdBreakEnd.cs` — Sends ad break end notice as chat message
- `CC_FirstChatter.cs` — Sends `{ event: 'first_chatter', user }` to API; API checks Redis toggle and sends welcome chat if enabled
- `GW_A_ViewerTick.cs` / `GW_B_ChatMessage.cs` — Watchtime events
- `GW_TimeInfo.cs` — !time command handler

## Data Storage
- **Redis (ephemeral state)**: giveaway open/closed, current keyword, banned users, watchsec/msgs per user, spacefight live/active flags, first chatter toggle, current session ID
- **PostgreSQL (persistent)**: `sessions`, `users` (giveaway winners, ticket counts), `spacefight_stats` (wins/losses), `spacefight_results` (fight history)

## REST API Endpoints
| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Healthcheck (Redis + PG status) |
| GET | `/api/participants` | All giveaway participants |
| GET | `/api/user/:username` | Single user giveaway data |
| GET | `/api/sessions` | All giveaway sessions |
| GET | `/api/leaderboard` | Giveaway winner leaderboard |
| GET | `/api/spacefight/leaderboard` | Spacefight win/loss stats |
| GET | `/api/spacefight/history` | Recent fight results |
| GET | `/api/spacefight/player/:username` | Single player stats |
| POST | `/api/spacefight` | Record fight result |
| POST | `/api/chat/send` | Send Twitch chat message (via Streamerbot) |
| GET | `/api/twitch/user/:login` | Twitch user profile (cached) |
| POST | `/api/claude/summary` | AI summary for shoutout/raid overlays |
| GET | `/api/ws/clients` | Connected WS client list |
| POST | `/api/backup/trigger` | Trigger manual backup |

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

## Development

### Commands (run from `api/`)
```bash
npm start              # production start
npm run dev            # start with --watch (auto-restart on change)
npm test               # run Node.js tests (tests/*.test.js) once
npm run test:watch     # run tests in watch mode
```

Browser tests: open `web/tests/test-runner.html` in a browser (no server needed).

### Docker
```bash
docker-compose up -d           # start all services
docker-compose up -d --build   # rebuild after Dockerfile/dependency changes
docker-compose logs -f api     # tail API logs
```

### Redis
- DB 0 = production, DB 1 = tests — never use DB 0 in test code
- Redis Commander UI at port 8081

### Ports
| Service | Port | Purpose |
|---|---|---|
| REST API | 3000 | HTTP endpoints |
| Browser WS | 9091 | Admin panels + OBS overlays |
| Streamerbot WS | 9090 | Inbound events from Streamerbot |
| Redis UI | 8081 | Redis Commander |

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
