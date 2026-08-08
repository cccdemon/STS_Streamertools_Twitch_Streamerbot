-- ════════════════════════════════════════════════════════
-- CHAOS CREW v5 – PostgreSQL Schema
-- Persistente Langzeit-Daten (Spacefight-Kämpfe und -Statistik)
-- Redis bleibt für Live-State (sf_game_active, sf_live, sf:index)
--
-- Hinweis: Mit dem Giveaway-System entfernt wurden users,
-- sessions, session_participants, watchtime_events,
-- giveaway_draws, debug_log und die View winner_history.
-- debug_log stand hier nur, weil giveaway/server.js und
-- GW_A_ViewerTick.cs hineingeschrieben haben — beide sind weg.
-- Bestehende Installationen behalten alle Tabellen: hier steht
-- bewusst kein DROP, damit Altdaten nicht beim nächsten Start
-- verschwinden.
-- ════════════════════════════════════════════════════════

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Spacefight History ────────────────────────────────────
CREATE TABLE IF NOT EXISTS spacefight_results (
    id          BIGSERIAL PRIMARY KEY,
    winner      TEXT NOT NULL,
    loser       TEXT NOT NULL,
    ship_w      TEXT,
    ship_l      TEXT,
    ts          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sf_winner ON spacefight_results(winner);
CREATE INDEX IF NOT EXISTS idx_sf_loser  ON spacefight_results(loser);

-- ── Spacefight Stats (Materialized View) ─────────────────
-- Wird nach jedem Kampf refreshed (oder per Cron)
CREATE TABLE IF NOT EXISTS spacefight_stats (
    username    TEXT PRIMARY KEY,
    display     TEXT NOT NULL,
    wins        INTEGER NOT NULL DEFAULT 0,
    losses      INTEGER NOT NULL DEFAULT 0,
    last_fight  TIMESTAMPTZ
);
