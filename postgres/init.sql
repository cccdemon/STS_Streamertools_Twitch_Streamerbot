-- ════════════════════════════════════════════════════════
-- CHAOS CREW v5 – PostgreSQL Schema
-- Persistente Langzeit-Daten (Sessions, Watchtime, Gewinner)
-- Redis bleibt für Live-State (gw_open, aktive User)
-- ════════════════════════════════════════════════════════

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── User Profile ──────────────────────────────────────────
-- Kumulierte Lifetime-Statistiken pro Viewer
CREATE TABLE IF NOT EXISTS users (
    username        TEXT PRIMARY KEY,          -- twitch login (lowercase)
    display         TEXT NOT NULL,             -- Anzeigename
    total_watch_sec BIGINT  NOT NULL DEFAULT 0,
    total_msgs      BIGINT  NOT NULL DEFAULT 0,
    times_won       INTEGER NOT NULL DEFAULT 0,
    first_seen      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Giveaway Sessions ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
    id              TEXT PRIMARY KEY,          -- z.B. sess_1234567890
    keyword         TEXT NOT NULL DEFAULT '',
    opened_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at       TIMESTAMPTZ,
    winner          TEXT,                      -- FK users.username, nullable
    winner_watch_sec BIGINT,
    winner_coins    NUMERIC(10,4),
    total_participants INTEGER NOT NULL DEFAULT 0,
    total_coins     NUMERIC(10,4) NOT NULL DEFAULT 0
);

-- ── Session Participants Snapshot ─────────────────────────
-- Snapshot beim Schließen der Session gespeichert
CREATE TABLE IF NOT EXISTS session_participants (
    id              BIGSERIAL PRIMARY KEY,
    session_id      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    username        TEXT NOT NULL,
    display         TEXT NOT NULL,
    watch_sec       BIGINT  NOT NULL DEFAULT 0,
    msgs            INTEGER NOT NULL DEFAULT 0,
    coins           NUMERIC(10,4) NOT NULL DEFAULT 0,
    banned          BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (session_id, username)
);

-- ── Watchtime Event Log ───────────────────────────────────
-- Jedes Viewer-Tick- und Chat-Bonus-Event
-- Wichtig: Primäre Quelle der Wahrheit für Watchtime
CREATE TABLE IF NOT EXISTS watchtime_events (
    id          BIGSERIAL PRIMARY KEY,
    username    TEXT NOT NULL,
    event_type  TEXT NOT NULL CHECK (event_type IN ('tick','chat_bonus')),
    delta_sec   INTEGER NOT NULL,
    session_id  TEXT,
    ts          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wt_username ON watchtime_events(username);
CREATE INDEX IF NOT EXISTS idx_wt_session  ON watchtime_events(session_id);
CREATE INDEX IF NOT EXISTS idx_wt_ts       ON watchtime_events(ts);

-- ── Debug Log ─────────────────────────────────────────────
-- Stage-level events from Streamerbot actions / services.
-- Used to diagnose missing/dropped events.
CREATE TABLE IF NOT EXISTS debug_log (
    id          BIGSERIAL PRIMARY KEY,
    source      TEXT        NOT NULL,
    stage       TEXT        NOT NULL,
    username    TEXT,
    info        TEXT,
    ts          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_debug_ts     ON debug_log(ts DESC);
CREATE INDEX IF NOT EXISTS idx_debug_source ON debug_log(source);

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

-- ── Winner History ────────────────────────────────────────
CREATE VIEW winner_history AS
    SELECT s.id AS session_id, s.keyword, s.opened_at, s.closed_at,
           s.winner, s.winner_watch_sec, s.winner_coins,
           s.total_participants, s.total_coins
    FROM sessions s
    WHERE s.winner IS NOT NULL
    ORDER BY s.closed_at DESC;
