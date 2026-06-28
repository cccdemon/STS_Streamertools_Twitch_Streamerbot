# Streamerbot ↔ overlay.html — Einbindungs-Anleitung

`overlay.html` ist die **Basis/Quelle der Wahrheit**. Alle C#-Actions senden
genau die Events + Felder, die das Overlay erwartet — direkt an die
WS-Session des Overlays (`cc_alert_session`), **nicht** über die Bridge/Redis.

```
overlay.html (OBS Browser Source)
   │  WS → ws://192.168.178.39:9090   (Streamerbot WebSocket Server)
   │  sendet beim Connect: { "event": "cc_alert_register" }
   ▼
CC_AlertRegister  →  speichert sessionId als GlobalVar cc_alert_session
   ▲
   │  Twitch-Event (Follow/Sub/Cheer/Raid/Redeem/…)
CC_<Event>  →  WebsocketCustomServerBroadcast(payload, cc_alert_session)  →  Overlay
```

---

## 1. Voraussetzung: WebSocket Server aktivieren

Streamerbot → **Settings → WebSocket Server**:
- **Enable** ankreuzen
- Address `0.0.0.0`, Port `9090`
- Läuft auf demselben PC wie OBS → Overlay nutzt `ws://192.168.178.39:9090`
  (andere IP? → Overlay-URL-Param `?sb=ws://<ip>:9090`)

> Derselbe Server wird von der Bridge (Giveaway/Spacefight) mitgenutzt — nicht abschalten.

## 2. Actions importieren

Pro `.cs`-Datei in diesem Ordner:

1. Streamerbot → **Actions** → Rechtsklick → **Add** → Action benennen (siehe Tabelle).
2. In der Action: Rechtsklick → **Add Sub-Action** → **Core → C# → Execute C# Code**.
3. Inhalt der `.cs`-Datei einfügen → **Compile**. Muss grün sein.
4. **Trigger** der Action setzen (Tabelle Spalte „Trigger").

> Du kannst eine Action auch via *Import* (Clipboard) anlegen, aber der C#-Weg
> oben hält den Code 1:1 zu diesen Dateien.

## 3. Action → Trigger → Overlay-Mapping

| Action (Datei) | Streamerbot-Trigger | sendet `alertType` | Felder ans Overlay |
|---|---|---|---|
| **CC_AlertRegister** | Core → WebSocket → Custom Server → **Message** | – (Registrierung) | speichert `cc_alert_session` |
| CC_Follow | Twitch → Follow | `follow` | user, avatar |
| CC_Cheer | Twitch → Cheer | `cheer` | user, amount(bits), avatar |
| **CC_Sub** ⭐ | Twitch → **Subscription**, **Resub**, **Gift Sub**, **Community Gift Sub** (alle 4 auf diese eine Action) | `sub` / `resub` / `subgift` / `subbomb` (auto-erkannt) | user, tier, avatar, (recipient / cumulativeMonths / amount) |
| CC_RaidBroadcaster | Twitch → Raid | `raid` | user, amount(viewer), avatar, game |
| CC_Redeem | Twitch → Channel Point Reward Redemption | `redeem` | user, reward, avatar |
| CC_Shoutout | Core → Command → `!so` (Mod/Broadcaster) | `shoutout` | user, avatar, game |
| CC_HypeTrain | Twitch → Hype Train (Level Up / Update) | `hypetrain` | level (1–5) |
| CC_OutRaid | Twitch → Raid Started (ausgehend) bzw. Command `!raid` | `outraid` | user(Ziel), amount(viewer) |
| CC_StreamStart | Twitch → Stream Online | `streamstart` | – |
| CC_Id | Core → Command → `!id` (Everyone, Cooldown empf.) | `profile_request` (Overlay holt `/alerts/api/profile`) | Steckbrief: Watchtime, Errungenschaften, Status (Followage/Abo/Bits), Status-Satz |

⭐ **CC_Sub** ersetzt die alten vier Actions (CC_Resub/CC_SubGift/CC_SubBomb gelöscht).
Lege **alle vier Sub-Trigger** auf diese eine Action — sie erkennt den Typ aus den Args
(`gifts` → subbomb, `recipient*` → subgift, `cumulativeMonths>1` → resub, sonst sub).

### Steckbrief `!id` (CC_Id)
`CC_Id.cs` macht **kein HTTP** (Streamerbots Inline-C# referenziert `System.Net`
nicht). Es liest die Daten des **aufrufenden** Users — Login/Anzeigename + (sofern
vom Trigger geliefert) `isSubscribed`, `cumulativeMonths`, `userProfileImageUrl`
sowie UserVars `haulPoints`/optional `bitsTotal` — und broadcastet sie als
`profile_request` an `cc_alert_session`. Das **Overlay** (Browser) ruft dann selbst
`/alerts/api/profile` auf und reichert mit Watchtime + Giveaway- + Spacefight-Daten
an. Kein `API_HOST` nötig (Overlay nutzt seine eigene Origin). Followage optional
per Sub-Action in `args["followAgeDays"]`, sonst „—". Cooldown am Command empfohlen.

### Redeem-Rewards
`overlay.html` matcht `reward` (Titel, kleingeschrieben) gegen die `REWARDS`-Map.
Vorhandene Titel u.a.: „erschreck den streamer. alarm!", „mach ein selfie und poste es sofort",
„mach kamera aus!", „paulcontent", „rip", „trink was bitte", „was macht antje", „zieh mütze aus".
Unbekannte Rewards → generische „CHANNEL REWARD"-Karte. Neue Rewards: Map in `overlay.html` erweitern.

## 4. OBS Browser Source

- URL: `http://192.168.178.34/alerts/overlay.html` (**ohne** Query-String!)
- `?demo=1` = Vorschau/stumm (verbindet NICHT live) — nur zum Ansehen.
- Größe 1920×1080, „Control audio via OBS" an (für Sound im Mixer).
- Nach Overlay-Update: Rechtsklick auf die Quelle → **Cache aktualisieren**.

## 5. Testen ohne Twitch

Admin-Panel `http://192.168.178.34/admin/alerts-test.html` feuert jeden Alert
über `/alerts/ws` (Test-Pfad, unabhängig von Streamerbot). Felder wie `recipient`
(subgift) werden durchgereicht.

## 6. Hauling-Chatgame (Frachttransport)

Eigenständiges Punkte-Chatgame. Spieler nehmen Frachtaufträge an (`!haul`),
gewinnen/verlieren `Hauling-Punkte` (Twitch UserVars, persisted). Optionales
OBS-Overlay (`haul.html`) untermalt jeden Lauf grafisch — gleicher Direkt-WS-
Pfad wie die Alerts, eigene Session `cc_haul_session`.

### Commands → Action
| Command | Action (Datei) | Recht | Effekt |
|---|---|---|---|
| `!haul` | **Hauling** | alle | Auftrag würfeln, Punkte ±, Chat-FX + Overlay-Broadcast |
| `!haulsaldo` / `!konto` | **Haulingsaldo** | alle | Kontostand, Rang, Streak, Erfolgsquote, Fortschritt |
| `!haultop` | **Haulingtop** | alle | Top 5 mit Medaillen + Rang-Badges |
| `!haulreset` | **Haulreset** | **Mod/Broadcaster** | Saison-Reset: Punkte/Streak/Statistik → 0 |
| `!hauldelete` | **Hauldelete** | **Broadcaster** | löscht alle Hauling-UserVars komplett |

> ⚠️ `!haulreset` und `!hauldelete` haben **keinen** Code-seitigen Rechte-Check —
> Befehlsrecht im Streamerbot-Command auf Mod bzw. Broadcaster setzen.

### Mechanik
- **Star-Citizen-Theme**: 24 Cargo-Runs (echte SC-Commodities/Orte: Quantanium,
  Laranite, Jumptown, Grim HEX …) in 4 Risiko-Stufen (LEICHT/MITTEL/SCHWER/EXTREM);
  höheres Risiko = höherer Gewinn **und** Verlust, geringere Erfolgschance.
- Fehlschläge sind SC-Hazards (30k, Hull Breach, Quantum-Interdiction, Soft Death …).
- **Streak**: jeder Erfolg in Folge +5 % Belohnung (max +50 %), Fehlschlag setzt zurück.
- **Volltreffer** (8 %): Belohnung ×2. **Jackpot** (2 %): +2000. **Piratenüberfall**
  (12 % bei Fehlschlag): Verlust +50 %.
- **Cooldown** wird im Streamerbot-Command gesteuert (nicht im Code) — Cooldown
  am `!haul`-Command setzen.
- **Ränge** nach Kontostand: Frachtanfänger ⚪ → Lehrling 🟢 → Kurierfahrer 🟡 →
  Frachtprofi 🟠 → Frachtbaron 🔴 → Logistik-Magnat 🟣 → Sternenspediteur 🌟.

### Overlay einbinden (optional)
1. Action **CC_HaulRegister** (Datei `CC_HaulRegister.cs`) anlegen, Trigger
   *Core → WebSocket → Custom Server → Message* (wie CC_AlertRegister). Speichert
   `cc_haul_session`.
2. OBS Browser Source: `http://192.168.178.34/alerts/haul.html` (1920×1080,
   transparent, **kein** Query-String). Vorschau: `?demo=1`. WS-Override: `?sb=ws://<ip>:9090`.
3. Ohne registriertes Overlay läuft das Spiel normal weiter — der Broadcast ist
   dann ein No-op (kein Fehler).

UserVars: `haulPoints` (Punkte), `haulStreak`, `haulRuns`, `haulWins`.

## 7. Bekannte Eigenheiten

- `cc_alert_session` ist **in-memory** (persist=false). Nach Streamerbot-Neustart
  weg, bis das Overlay neu verbindet → re-registriert sich automatisch beim
  WS-Reconnect. Wenn keine Alerts kommen: Overlay in OBS einmal neu laden.
- Nur **eine** Session gilt. Mehrere offene Overlays → nur das zuletzt verbundene
  bekommt Alerts.
- Log-Check in Streamerbot bei Test-Follow:
  - `[CC Follow] → Overlay broadcast` = ok
  - `cc_alert_session nicht gesetzt` = CC_AlertRegister-Trigger fehlt / Overlay nicht verbunden
