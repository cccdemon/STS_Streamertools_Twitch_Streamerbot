-- ════════════════════════════════════════════════════════
-- CHAOS CREW – Giveaway System v4 – MariaDB Schema
-- ════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS giveaway_sessions (
    id                 INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
    opened_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at          DATETIME     NULL,
    keyword            VARCHAR(255) NULL,
    winner             VARCHAR(255) NULL,
    winner_tickets     INT          NULL,
    total_participants INT          NOT NULL DEFAULT 0,
    total_tickets      INT          NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS participants (
    id         INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
    session_id INT          NOT NULL,
    username   VARCHAR(255) NOT NULL,
    display    VARCHAR(255) NOT NULL,
    watch_sec  INT          NOT NULL DEFAULT 0,
    msgs       INT          NOT NULL DEFAULT 0,
    tickets    INT          NOT NULL DEFAULT 0,
    banned     TINYINT(1)   NOT NULL DEFAULT 0,
    registered TINYINT(1)   NOT NULL DEFAULT 0,
    joined_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_session_user (session_id, username),
    CONSTRAINT fk_participants_session FOREIGN KEY (session_id)
        REFERENCES giveaway_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS winners (
    id         INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
    session_id INT          NULL,
    username   VARCHAR(255) NOT NULL,
    display    VARCHAR(255) NOT NULL,
    tickets    INT          NOT NULL DEFAULT 0,
    watch_sec  INT          NOT NULL DEFAULT 0,
    msgs       INT          NOT NULL DEFAULT 0,
    won_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_winners_session FOREIGN KEY (session_id)
        REFERENCES giveaway_sessions(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_stats (
    username        VARCHAR(255) NOT NULL PRIMARY KEY,
    display         VARCHAR(255) NOT NULL,
    total_watch_sec BIGINT       NOT NULL DEFAULT 0,
    total_msgs      BIGINT       NOT NULL DEFAULT 0,
    total_tickets   INT          NOT NULL DEFAULT 0,
    times_won       INT          NOT NULL DEFAULT 0,
    first_seen      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX IF NOT EXISTS idx_participants_session  ON participants(session_id);
CREATE INDEX IF NOT EXISTS idx_participants_username ON participants(username);
CREATE INDEX IF NOT EXISTS idx_winners_session       ON winners(session_id);
CREATE INDEX IF NOT EXISTS idx_winners_username      ON winners(username);

CREATE OR REPLACE VIEW v_current_session AS
    SELECT * FROM giveaway_sessions
    WHERE closed_at IS NULL
    ORDER BY opened_at DESC
    LIMIT 1;

CREATE OR REPLACE VIEW v_leaderboard AS
    SELECT username, display, total_watch_sec, total_msgs,
           total_tickets, times_won, last_seen
    FROM user_stats
    ORDER BY total_tickets DESC, total_watch_sec DESC;
