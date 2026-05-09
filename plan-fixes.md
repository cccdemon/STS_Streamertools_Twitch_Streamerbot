# Bug Fix Plan

Review date: 2026-04-29

## Verification Done

- Ran `node --check` against every `*.js` file in the repo. No JavaScript syntax errors were reported.
- Reviewed the Node services, Caddy routing, Docker Compose, PostgreSQL schema, and the main admin/overlay clients.

## P0 - Public Admin Controls Are Unauthenticated

### 1. Giveaway WebSocket accepts admin commands from any client

Files:
- `services/giveaway/server.js`
- `services/giveaway/public/giveaway-admin.js`
- `services/admin/public/giveaway-test.js`

Problem:
Any browser that can reach `/giveaway/ws` can send `gw_cmd` messages. Those messages can open/close/reset giveaways, draw winners, change keywords, add/subtract tickets, ban/unban users, and toggle first-chatter.

Fix:
- Add an `ADMIN_TOKEN` environment variable to `docker-compose.yml` and `.env.example`.
- Require a valid token on all `gw_cmd` messages before executing `handleAdminCmd`.
- Prefer a first message such as `{ event: "cc_auth", token }` or require `token` on each command.
- Send an explicit `{ event: "gw_ack", type: "unauthorized" }` response and ignore the command on failure.
- Update admin clients to send the token.

Acceptance:
- Unauthenticated `gw_cmd` messages cannot mutate Redis or PostgreSQL.
- Admin UI still works after providing the token.

### 2. Spacefight WebSocket accepts destructive admin commands from any client

Files:
- `services/spacefight/server.js`
- `services/spacefight/public/spacefight-admin.js`

Problem:
Any reachable client can send `sf_cmd`, including `sf_reset`, `sf_delete_player`, and `sf_edit_player`.

Fix:
- Use the same `ADMIN_TOKEN` auth path as Giveaway.
- Require auth before `handleSfCmd`.
- Return a clear unauthorized ack.

Acceptance:
- Unauthenticated `sf_cmd` messages cannot start/stop the game or edit/delete/reset stats.

### 3. Alerts exposes chat-send and AI-summary endpoints without auth

Files:
- `services/alerts/server.js`
- `services/alerts/public/shoutout-info.html`
- `services/alerts/public/raid-info.html`

Problem:
`POST /alerts/api/chat/send` can publish arbitrary messages into `ch:chat_reply`, and `POST /alerts/api/claude/summary` can spend API tokens. Both are public through Caddy.

Fix:
- Add middleware requiring `x-admin-token === process.env.ADMIN_TOKEN` for `/api/chat/send` and `/api/claude/summary`.
- Keep `/api/twitch/user/:login` public if desired.
- Update the two admin/info pages to include the token header.

Acceptance:
- Missing/invalid token returns `401`.
- Valid token preserves current shoutout/raid workflow.

## P1 - Reverse Proxy and Client Path Bugs

### 4. HTTPS Caddyfile points to a nonexistent `api` service

File:
- `caddy/Caddyfile.ssl`

Problem:
The SSL config proxies `/api/*` and `/health` to `api:3000`, but `docker-compose.yml` defines no `api` service. The non-SSL `Caddyfile` has the correct service-specific routes.

Fix:
- Bring `Caddyfile.ssl` to parity with `caddy/Caddyfile`: `/giveaway/*`, `/spacefight/*`, `/alerts/*`, `/stats/*`, `/admin/*`, `/bridge/*`, `/health`, and `/redis-ui/*`.

Acceptance:
- HTTPS deployment can reach all current services.
- `/health` returns the admin aggregate health response.

### 5. Spacefight public pages call root `/api/...` instead of `/spacefight/api/...`

Files:
- `services/spacefight/public/spacefight.js`
- `services/spacefight/public/spacefight-admin.js`

Problem:
When served through Caddy under `/spacefight/*`, the JS uses root-relative fetches like `/api/spacefight/leaderboard`. The active non-SSL Caddy config has no root `/api` route, so those calls will 404 in the deployed path.

Fix:
- Change public client fetches to `/spacefight/api/spacefight/...`, or derive a base path from `location.pathname`.
- Keep direct-service local development working by falling back to `/api/...` when not mounted under `/spacefight`.

Acceptance:
- Spacefight admin and overlay load leaderboard/history/player data both via Caddy and direct service URL.

## P1 - Data Integrity Bugs

### 6. Spacefight results can be saved twice

File:
- `services/spacefight/server.js`

Problem:
`spacefight_result` is accepted from both the service WebSocket and Redis Pub/Sub. A result can be persisted twice if it travels through both paths or is replayed. There is no deduplication key in PostgreSQL or Redis.

Fix:
- Introduce a stable battle/result id from the source event, or derive one from winner, loser, ships, and timestamp.
- Add a `result_id` column with a unique constraint, or keep a short Redis `SET NX EX` dedup key before saving.
- Only publish chat replies after the dedup gate succeeds.

Acceptance:
- Replaying the same result does not create duplicate rows or duplicate win/loss increments.

### 7. Session close can double-count lifetime watchtime

Files:
- `services/giveaway/watchtime.js`
- `services/giveaway/server.js`

Problem:
`closeGiveaway()` snapshots participants and increments lifetime user totals every time it runs. `gw_close`, `gw_reset`, reconnect/retry, or repeated admin clicks can call close for the same session more than once, adding the same session totals repeatedly.

Fix:
- Make session close idempotent.
- Skip lifetime increments when the session already has `closed_at`.
- Or recompute lifetime totals from `session_participants` / `watchtime_events` instead of incrementing blindly.

Acceptance:
- Running close twice leaves `users.total_watch_sec` and `users.total_msgs` unchanged on the second run.

### 8. Winner draw does not ensure the winner exists in `users`

File:
- `services/giveaway/server.js`

Problem:
Manual ticket additions can create Redis-only participants. `gw_draw_winner` runs `UPDATE users SET times_won = times_won + 1 WHERE username=$1`, which silently does nothing if that user was never inserted into PostgreSQL.

Fix:
- Upsert the winner into `users` before incrementing `times_won`.
- Use the best available display name from participant data.

Acceptance:
- Manually added winners appear in winner history and have `times_won` incremented.

## P2 - Security / Deployment Hardening

### 9. Redis UI is publicly bound

File:
- `docker-compose.yml`

Problem:
`redis-ui` publishes `8081:8081` on all interfaces. The docs/future notes already say this should be bound to localhost only.

Fix:
- Change to `127.0.0.1:8081:8081`.
- Keep Caddy `/redis-ui/*` protected or remove the public route if not needed.

Acceptance:
- Redis UI is not reachable directly from the public network.

### 10. CORS is open on mutation-capable services

Files:
- `services/giveaway/server.js`
- `services/spacefight/server.js`
- `services/alerts/server.js`
- `services/admin/server.js`

Problem:
All services return `Access-Control-Allow-Origin: *`. Once auth exists, this still increases accidental exposure and makes token handling easier to misuse.

Fix:
- Restrict CORS to the configured domain/admin origin.
- Include `Access-Control-Allow-Headers: Content-Type, x-admin-token`.
- Handle `OPTIONS` preflight explicitly where token-protected POSTs are used.

Acceptance:
- Admin pages work from the configured domain.
- Cross-origin mutation attempts from unrelated origins are rejected by the browser and by server auth.

## P2 - Reliability / Cleanup

### 11. Text files show mojibake in many comments and strings

Files:
- Many `.js`, `.sql`, `.md`, and `.json` files

Problem:
Several files display mojibake such as `â€“`, `Ã¼`, and `ðŸ`. Some of this appears in user-facing chat messages, not only comments.

Fix:
- Normalize affected files to UTF-8.
- Replace corrupted user-facing strings first, especially chat replies and UI labels.
- Add an editorconfig or README note requiring UTF-8.

Acceptance:
- German umlauts and symbols render correctly in chat, overlays, docs, and logs.

### 12. `.env.example` is missing newer runtime configuration

File:
- `.env.example`

Problem:
The compose file consumes `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, and `ANTHROPIC_KEY`, but `.env.example` does not document them. The planned `ADMIN_TOKEN` also needs to be added.

Fix:
- Add the missing keys with comments.
- Avoid real secrets in examples.

Acceptance:
- A fresh setup has a complete checklist of required and optional environment variables.

## Suggested Fix Order

1. Add `ADMIN_TOKEN` and enforce it on Giveaway, Spacefight, and Alerts mutations.
2. Fix `Caddyfile.ssl` and the Spacefight `/api` client paths.
3. Add Spacefight result deduplication.
4. Make Giveaway session close idempotent.
5. Harden Redis UI binding and CORS.
6. Clean up mojibake/user-facing strings and refresh `.env.example`.
