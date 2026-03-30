FROM redis:7-alpine

# Install wget and busybox cron
RUN apk add --no-cache wget busybox-suid

# Copy backup script
COPY backup.sh /backup.sh
RUN chmod +x /backup.sh

# Cron schedule: täglich um 03:00 Uhr
# Format: MIN HOUR DOM MON DOW CMD
RUN echo "0 3 * * * /backup.sh >> /backups/backup.log 2>&1" > /etc/crontabs/root

# Create backup directory
RUN mkdir -p /backups

CMD ["crond", "-f", "-l", "2"]
