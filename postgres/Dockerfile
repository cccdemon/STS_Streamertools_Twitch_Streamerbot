FROM postgres:16-alpine

# ── LXC AppArmor Fix ──────────────────────────────────────
# AppArmor in unprivilegierten LXC-Containern blockiert AF_UNIX Sockets
# wenn PostgreSQL versucht sie in /var/run/postgresql anzulegen.
#
# Fix: unix_socket_directories='/tmp'
#   - /tmp existiert immer, ist beschreibbar
#   - AppArmor erlaubt AF_UNIX in /tmp
#   - Die API verbindet sich per TCP (host=postgres) – der Socket wird nie genutzt
#
# Zweistufig:
#   1. postgresql.conf.sample → gilt für frischen initdb
#   2. lxc-entrypoint.sh → patcht auch bestehende postgresql.conf im Volume

RUN sed -i "s|^#*unix_socket_directories.*|unix_socket_directories = '/tmp'|" \
        /usr/local/share/postgresql/postgresql.conf.sample \
 && grep -q "unix_socket_directories" /usr/local/share/postgresql/postgresql.conf.sample \
    || echo "unix_socket_directories = '/tmp'" >> /usr/local/share/postgresql/postgresql.conf.sample

COPY lxc-entrypoint.sh /lxc-entrypoint.sh
RUN chmod +x /lxc-entrypoint.sh

ENTRYPOINT ["/lxc-entrypoint.sh"]
CMD ["postgres"]
