# Team Giveaway (JustCallMeDeimos)

Multi-Channel-Community-Giveaway + Viewtime-Punktesystem für Twitch. Fork
ausschließlich für das Giveaway — alle anderen Streamer-Tools wurden entfernt.

## Was es tut
- Misst **Viewtime pro Zuschauer** über mehrere teilnehmende Kanäle (die nicht
  gleichzeitig streamen). 2h Viewtime = 1 Los.
- Sinnvolle Chatnachrichten (>3 Wörter) geben etwas Viewtime dazu (selber Pott).
- Teilnahme: ≥2 der teilnehmenden Kanäle folgen + Viewtime + Chat. Ab 1 Los per
  Keyword im Chat teilnehmen.
- Ziehung: Zufall, gewichtet nach Loszahl. Voll nachvollziehbar (Draw-Audit).

## Stack
Dockerisierte Microservices: **bridge** (Streamerbot-Ingest → Redis) ·
**giveaway** (Watchtime-Engine, Ziehung, WS/REST) · **admin** (Login + Admin-UI) ·
**Caddy** (Reverse Proxy) · **Redis** · **PostgreSQL**.

## Entwicklung
```bash
docker compose up -d --build        # lokal (HTTP, Caddyfile)
cd services/<name> && npm test      # node --test, Redis DB 1
```

## Deploy (prod)
`team.raumdock.org` auf LXC 103. Details + Konventionen: siehe [CLAUDE.md](CLAUDE.md).
Setup des Streamerbot: [streamerbot/SETUP.md](streamerbot/SETUP.md).
