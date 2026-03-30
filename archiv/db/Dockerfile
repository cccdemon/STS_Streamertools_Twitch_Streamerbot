FROM postgres:16-alpine

# Entferne das Socket-Verzeichnis und ersetze es durch eine regulaere Datei
# Damit kann PostgreSQL keinen Unix Socket anlegen – Permission denied wird
# durch "ist eine Datei, kein Verzeichnis" ersetzt, was PostgreSQL toleriert
# wenn unix_socket_directories auf ein nicht-existentes Verzeichnis zeigt.
#
# Sauberste Loesung: Socket-Verzeichnis durch eine nicht-beschreibbare Datei
# ersetzen, sodass mkdir/socket() darin fehlschlaegt, aber listen_addresses=*
# sorgt dafuer dass TCP trotzdem funktioniert.

RUN rm -rf /var/run/postgresql && \
    touch /var/run/postgresql && \
    chmod 000 /var/run/postgresql

# PostgreSQL startet mit:
# - TCP auf 0.0.0.0:5432 (listen_addresses=*)
# - unix_socket_directories zeigt auf /var/run/postgresql
#   -> schlaegt lautlos fehl weil es eine Datei ist, kein Verzeichnis
# - Kein Socket wird erstellt
CMD ["postgres", "-c", "listen_addresses=*"]
