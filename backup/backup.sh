#!/bin/sh
# ════════════════════════════════════════════════════════
# CHAOS CREW – Giveaway Backup Script
# Läuft als Cronjob, sichert Redis RDB + AOF + API-Export
# ════════════════════════════════════════════════════════

BACKUP_DIR="/backups"
REDIS_HOST="${REDIS_HOST:-redis}"
REDIS_PORT="${REDIS_PORT:-6379}"
API_HOST="${API_HOST:-api}"
API_PORT="${API_PORT:-3000}"
KEEP_DAYS="${KEEP_DAYS:-30}"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_PATH="${BACKUP_DIR}/${TIMESTAMP}"

mkdir -p "${BACKUP_PATH}"

echo "[$(date)] Starting backup to ${BACKUP_PATH}"

# ── 1. Redis BGSAVE triggern und warten ──────────────────
echo "[$(date)] Triggering Redis BGSAVE..."
redis-cli -h "${REDIS_HOST}" -p "${REDIS_PORT}" BGSAVE

# Warten bis BGSAVE abgeschlossen
for i in $(seq 1 30); do
  STATUS=$(redis-cli -h "${REDIS_HOST}" -p "${REDIS_PORT}" LASTSAVE)
  sleep 2
  NEW_STATUS=$(redis-cli -h "${REDIS_HOST}" -p "${REDIS_PORT}" LASTSAVE)
  if [ "$STATUS" != "$NEW_STATUS" ]; then
    echo "[$(date)] BGSAVE complete"
    break
  fi
done

# ── 2. Redis RDB Dump kopieren ───────────────────────────
echo "[$(date)] Copying RDB dump..."
redis-cli -h "${REDIS_HOST}" -p "${REDIS_PORT}" --rdb "${BACKUP_PATH}/dump.rdb" \
  && echo "[$(date)] RDB backup OK" \
  || echo "[$(date)] WARNING: RDB backup failed"

# ── 3. API-Daten als JSON exportieren ───────────────────
echo "[$(date)] Exporting API data..."

wget -qO "${BACKUP_PATH}/participants.json"  "http://${API_HOST}:${API_PORT}/api/participants" \
  && echo "[$(date)] participants.json OK" \
  || echo "[$(date)] WARNING: participants export failed"

wget -qO "${BACKUP_PATH}/winners.json"       "http://${API_HOST}:${API_PORT}/api/winners?limit=500" \
  && echo "[$(date)] winners.json OK" \
  || echo "[$(date)] WARNING: winners export failed"

wget -qO "${BACKUP_PATH}/leaderboard.json"   "http://${API_HOST}:${API_PORT}/api/leaderboard?limit=500" \
  && echo "[$(date)] leaderboard.json OK" \
  || echo "[$(date)] WARNING: leaderboard export failed"

wget -qO "${BACKUP_PATH}/sessions.json"      "http://${API_HOST}:${API_PORT}/api/sessions?limit=100" \
  && echo "[$(date)] sessions.json OK" \
  || echo "[$(date)] WARNING: sessions export failed"

# ── 4. Alle Keys als JSON dump ───────────────────────────
echo "[$(date)] Dumping all Redis keys..."
redis-cli -h "${REDIS_HOST}" -p "${REDIS_PORT}" --no-auth-warning \
  KEYS "gw_*" | while read key; do
  val=$(redis-cli -h "${REDIS_HOST}" -p "${REDIS_PORT}" GET "$key" 2>/dev/null)
  echo "{\"key\":\"$key\",\"value\":$val}"
done > "${BACKUP_PATH}/redis_keys.jsonl" \
  && echo "[$(date)] redis_keys.jsonl OK" \
  || echo "[$(date)] WARNING: Redis keys dump failed"

# ── 5. Komprimieren ──────────────────────────────────────
echo "[$(date)] Compressing..."
tar -czf "${BACKUP_DIR}/backup_${TIMESTAMP}.tar.gz" -C "${BACKUP_DIR}" "${TIMESTAMP}" \
  && rm -rf "${BACKUP_PATH}" \
  && echo "[$(date)] Compressed: backup_${TIMESTAMP}.tar.gz" \
  || echo "[$(date)] WARNING: Compression failed"

# ── 6. Alte Backups aufräumen ────────────────────────────
echo "[$(date)] Cleaning up backups older than ${KEEP_DAYS} days..."
find "${BACKUP_DIR}" -name "backup_*.tar.gz" -mtime "+${KEEP_DAYS}" -delete
REMAINING=$(find "${BACKUP_DIR}" -name "backup_*.tar.gz" | wc -l)
echo "[$(date)] Backup complete. ${REMAINING} backup(s) retained."
