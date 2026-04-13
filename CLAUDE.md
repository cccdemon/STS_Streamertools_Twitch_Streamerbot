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
- Streamerbot sends raw events to API (9090 → 9091): `fight_cmd`, `chat_msg`, `viewer_tick`, `raid`, `shoutout`, etc.
- API processes, persists, and broadcasts to all browser clients via `broadcastAll()`
- Admin panels send commands via WS: `{ event: 'gw_cmd', cmd: '...' }` or `{ event: 'sf_cmd', cmd: '...' }`
- Spacefight: Admin activates game → `sf_game_active` in Redis → `fight_cmd` only forwarded when active
- Giveaway: Admin opens/closes → watchtime engine tracks coins → draw winner

## Conventions
- German UI text throughout (Twitch streamer is German-speaking)
- All admin pages include `chaos-crew-shared.js` as first script in `<body>` (before other content)
- CSS files: `chaos-crew-admin.css` (admin pages), `chaos-crew-overlay.css` (OBS overlays)
- WebSocket events use `{ event: 'name', ... }` format
- Admin commands: `{ event: 'gw_cmd|sf_cmd', cmd: '...' }`
- New WS events/cmds must be added to `ALLOWED_EVENTS`/`ALLOWED_CMDS` in `chaos-crew-shared.js`
- `CC.validate` namespace for all input sanitization (XSS, prototype pollution, WS payload validation)
- Debug console at bottom of admin pages auto-intercepts all WS send/recv, fetch requests, button clicks, and user actions

## Streamerbot C# Actions (`streamerbot/`)
- `CC_ApiRegister.cs` — Registers API session on WS connect
- `CC_AlertRegister.cs` — Registers overlay sessions (alert, raid, shoutout)
- `CC_RaidBroadcaster.cs` — Forwards raid events to API
- `CC_Shoutout.cs` — Forwards shoutout events to API
- `CC_ChatReply.cs` — Sends chat messages from API back to Twitch
- `GW_A_ViewerTick.cs` / `GW_B_ChatMessage.cs` — Watchtime events
- `GW_TimeInfo.cs` — !time command handler

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
