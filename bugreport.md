# Bug Report

Scope: source review of `Streamertools Source Code`, focused on functional/runtime bugs. Security issues were intentionally not reviewed.

## 1. Spacefight pages use root `/api/...` URLs behind path-based Caddy routing

- Severity: High
- Files:
  - `services/spacefight/public/spacefight.js:162`
  - `services/spacefight/public/spacefight.js:173`
  - `services/spacefight/public/spacefight.js:180`
  - `services/spacefight/public/spacefight-admin.js:149`
  - `services/spacefight/public/spacefight-admin.js:185`
  - `services/spacefight/public/spacefight-admin.js:222`
  - `caddy/Caddyfile`

The Spacefight overlay/admin are served through `/spacefight/*`, and Caddy strips that prefix before proxying to the Spacefight service. The browser code uses absolute root API paths like `/api/spacefight`, `/api/spacefight/leaderboard`, and `/api/spacefight/player/...`.

That works only when opening the Spacefight service directly on port `3002`. Through the normal Caddy entrypoint, `/api/...` is not routed to the Spacefight service, so leaderboard/history/player loads and result saves fail.

Suggested fix: change these calls to `/spacefight/api/spacefight...` for proxied access, or use relative paths that resolve under the stripped service prefix.

## 2. Spacefight results are saved twice

- Severity: High
- Files:
  - `services/spacefight/public/spacefight.js:155`
  - `services/spacefight/public/spacefight.js:156`
  - `services/spacefight/server.js:132`
  - `services/spacefight/server.js:298`
  - `services/spacefight/server.js:372`

After a fight finishes, the overlay sends the same `spacefight_result` over WebSocket and then calls `saveResult(result)`, which POSTs the result to REST. The server persists results from both paths.

Impact: one fight can produce two rows in `spacefight_results`, double-increment winner/loss stats, and send duplicate chat replies.

Suggested fix: keep exactly one persistence path. Prefer WebSocket for live overlay-originated results, or REST with server-side broadcast, but not both. If both must exist, add an idempotency key such as the result timestamp plus attacker/defender and reject duplicates.

## 3. Giveaway overlay reads `tickets`/`display`, but the server sends `coins`/`username`

- Severity: High
- Files:
  - `services/giveaway/watchtime.js:212`
  - `services/giveaway/server.js:170`
  - `services/giveaway/public/giveaway-overlay.js:106`
  - `services/giveaway/public/giveaway-overlay.js:116`
  - `services/giveaway/public/giveaway-overlay.js:117`

`getAllParticipants()` returns participant objects shaped like `{ username, watchSec, msgs, coins, registered, banned }`. The overlay's `renderFromData()` calculates totals from `p.tickets`, sorts by `p.tickets`, and renders names from `p.display || p.key`.

Impact: the overlay can show `0` tickets and blank top-5 names even when participants have coins.

Suggested fix: update the overlay to use `coins` and `username`, or normalize the server response to include `tickets` and `display` aliases.

## 4. Winner overlay payload uses `coins`, but the overlay expects `tickets`

- Severity: Medium
- Files:
  - `services/giveaway/server.js:263`
  - `services/giveaway/public/giveaway-overlay.js:66`
  - `services/giveaway/public/giveaway-overlay.js:78`

When a winner is drawn, the server broadcasts `{ event: 'gw_overlay', winner, coins }`. The overlay reads `msg.tickets` for the displayed winner amount.

Impact: winner announcement can display `0 Tickets` even when the winner had coins.

Suggested fix: send `tickets: winner.coins`, or make the overlay accept `msg.coins ?? msg.tickets`.

## 5. Closing a giveaway does not clear `gw_session_id`, so the next giveaway can reuse the closed session

- Severity: High
- Files:
  - `services/giveaway/server.js:79`
  - `services/giveaway/server.js:87`
  - `services/giveaway/watchtime.js:245`
  - `services/giveaway/watchtime.js:250`
  - `services/giveaway/watchtime.js:254`
  - `services/giveaway/watchtime.js:317`

`closeGiveaway()` sets `currentSessionId = null`, but `WatchtimeEngine.closeGiveaway()` does not delete the Redis `gw_session_id`. `ensureSession()` then resumes any existing `gw_session_id` from Redis before creating a new session.

Impact: after closing and reopening without a reset, the next giveaway can write participants, totals, and winner data into the previous session row.

Suggested fix: delete `K.gwSessionId()` during normal close after snapshotting, or make `ensureSession()` ignore session ids whose PostgreSQL row has `closed_at IS NOT NULL`.

## 6. Closing an empty giveaway leaves the session open in PostgreSQL

- Severity: Medium
- File: `services/giveaway/watchtime.js:254`

`closeGiveaway(sessionId)` returns early when there are no participants. That happens after `gw_open` is set to false, but before updating `sessions.closed_at`.

Impact: empty sessions remain open forever in historical data. Combined with stale `gw_session_id`, this also makes later session reuse easier to trigger.

Suggested fix: update `sessions.closed_at = NOW()` even if there are zero participants, then clear the Redis session id.

## 7. Spacefight player detail endpoint omits `ratio`, but the UI displays it

- Severity: Medium
- Files:
  - `services/spacefight/server.js:356`
  - `services/spacefight/server.js:359`
  - `services/spacefight/server.js:362`
  - `services/spacefight/public/spacefight-admin.js:236`

The leaderboard endpoint computes a `ratio`, but `/api/spacefight/player/:username` returns `SELECT * FROM spacefight_stats` plus rank only. The admin player search renders `p.ratio`.

Impact: player search shows `0%` winrate for every player, even when the leaderboard shows the correct ratio.

Suggested fix: compute the same `CASE WHEN wins+losses > 0 THEN ... END AS ratio` in the player endpoint.

## 8. Spacefight service rank data is incomplete for players with no wins

- Severity: Medium
- Files:
  - `services/spacefight/server.js:229`
  - `services/spacefight/server.js:360`
  - `services/spacefight/server.js:362`

`SF_INDEX` is only updated for the winner after a fight. Losers are inserted into PostgreSQL, but not into the Redis sorted set unless they later win or are edited.

Impact: `/api/spacefight/player/:username` can return `rank: null` for players who exist in `spacefight_stats` but have only losses.

Suggested fix: update `SF_INDEX` for both winner and loser after saving a result, using each player's current wins.

## 9. Deleting a Spacefight player removes history rows without recomputing remaining stats

- Severity: Medium
- Files:
  - `services/spacefight/server.js:183`
  - `services/spacefight/server.js:184`

`sf_delete_player` deletes the selected player's stats, then deletes every fight row where that player was winner or loser. It does not recalculate the opponent stats affected by those deleted history rows.

Impact: the history table no longer contains those fights, but other players keep wins/losses from fights that no longer exist.

Suggested fix: either keep history and hide/delete only the selected player's stat row, or recompute `spacefight_stats` and `SF_INDEX` from `spacefight_results` after deleting history rows.

## 10. SSL Caddyfile references a non-existent monolithic `api` service

- Severity: High when `CADDY_CONFIG=Caddyfile.ssl`
- File: `caddy/Caddyfile.ssl:15`

The normal `Caddyfile` routes each microservice (`giveaway`, `spacefight`, `alerts`, `stats`, etc.). `Caddyfile.ssl` still serves `/srv/web` and proxies `/api/*` and `/health` to `api:3000`, but there is no `api` service in `docker-compose.yml`.

Impact: switching to the SSL Caddy config breaks the microservice routes and health/API endpoints.

Suggested fix: bring `Caddyfile.ssl` in line with `Caddyfile`, using the same path-based microservice handlers under the domain block.

## 11. Alerts overlay hard-codes LAN IPs instead of using the current host

- Severity: Medium
- File: `services/alerts/public/alerts.html:591`

`alerts.html` uses hardcoded addresses for Streamer.bot and the webserver:

- `ws://192.168.178.39:9090`
- `http://192.168.178.34`

Other overlays use `location.host` and the Caddy paths. This overlay will fail when the host/IP changes, when accessed through a domain, or when OBS is not on that LAN.

Suggested fix: derive service URLs from `location.protocol`/`location.host`, or read them from query parameters/config with sane defaults.
