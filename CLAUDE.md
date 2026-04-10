# Chaos Crew - Streamer Tools

## Project Overview
Twitch streamer toolset: Giveaway system, Spacefight chat game, HUD chat overlay, and Streamerbot C# actions.
Dockerized stack: Node.js API + Redis + PostgreSQL + Caddy reverse proxy.

## Architecture
- **API Server** (`api/server.js`): Express REST + WebSocket (port 9091 browser WS, connects to Streamerbot on 9090)
- **Watchtime Engine** (`api/watchtime.js`): Coin/ticket calculation from viewer ticks + chat messages
- **Web Admin Pages** (`web/`): Admin panels, stats, test console - all use `chaos-crew-shared.js` for validation + nav + debug console
- **OBS Overlays** (`web/giveaway/giveaway-overlay.html`, `giveaway-join.html`, `web/chat.html`, `web/games/spacefight.html`): Lightweight, no shared JS (OBS browser sources)

## Key Files
- `web/chaos-crew-shared.js` — Shared module loaded by all admin pages: input validation (`CC.validate`), nav bar, debug console (bottom bar with WS/HTTP/action logging)
- `api/server.js` — Main API: REST endpoints + WS server + Streamerbot client
- `api/watchtime.js` — Watchtime/coin engine with Redis keys
- `web/giveaway/giveaway-admin.js` — Giveaway admin panel logic
- `web/giveaway/giveaway-test.js` — Test console for simulating events
- `web/games/spacefight.js` — Spacefight game overlay + engine

## Conventions
- German UI text throughout (Twitch streamer is German-speaking)
- All admin pages include `chaos-crew-shared.js` as first script in `<body>` (before other content)
- CSS files: `chaos-crew-admin.css` (admin pages), `chaos-crew-overlay.css` (OBS overlays)
- WebSocket events use `{ event: 'name', ... }` format
- Admin commands: `{ event: 'gw_cmd', cmd: 'gw_open|gw_close|gw_reset|...' }`
- `CC.validate` namespace for all input sanitization (XSS, prototype pollution, WS payload validation)
- Debug console at bottom of admin pages auto-intercepts all WS send/recv, fetch requests, button clicks, and user actions

## Development
- Docker: `docker-compose.yml` in project root
- No build step for frontend (plain JS, no bundler)
- Tests: `web/tests/test-runner.html` (browser), `tests/` (Node.js)
