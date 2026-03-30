FROM caddy:2-alpine
COPY caddy/Caddyfile /etc/caddy/Caddyfile
COPY web/ /srv/web/
