# Handoff: Chaos Crew — Twitch Stream Overlay (Alerts) Redesign

## Overview
A full-screen (1920×1080), **transparent** browser-source overlay for OBS that reacts to live Twitch events (follows, subs, resubs, bits, sub bombs, raids, hype trains, channel-point redeems, shoutouts). It renders animated alerts plus three persistent/peripheral HUD elements. Visual language: **Sci-Fi bridge console** — deep navy/black, cyan + gold accents, hairline borders, corner-tick registration marks, monospace + display type, scanline texture. No solid backgrounds (must stay transparent for OBS compositing).

## About the Design Files
The files in this bundle are a **design reference built in HTML/Canvas** — a working prototype that shows the intended look, motion, and event behavior. They are **not meant to be shipped as-is**. `Overlay Redesign.dc.html` is authored in a proprietary "Design Component" (`.dc.html`) format that depends on the bundled `support.js` runtime; treat it as a **reference implementation to read**, then **recreate the overlay in the target environment** using its established patterns.

For a stream overlay the realistic target is a small standalone web app (vanilla JS + Canvas, or a light framework like Svelte/Lit/React). The actual rendering logic here is plain imperative JS + the Canvas 2D API and standard DOM — all of it ports directly; only the `.dc.html` wrapper (template + `class Component extends DCLogic`) is framework-specific scaffolding you can drop.

## Fidelity
**High-fidelity.** Final colors, typography, spacing, motion timings, and event logic are all specified and present in the reference. Recreate pixel- and motion-faithfully. All animation/easing values below are the real values used.

---

## Architecture / Event Flow

```
Streamer.bot WebSocket  ──┐
(ws://<host>:9090)        │   handleMessage()  → enqueue(type, data)
                          ├─▶  ┌─ updateLatest()        (feeds the Latest widget store)
Giveaway WebSocket  ──────┘    ├─ route by type:
(/giveaway/ws → gw_join)       │    • BIG center alert  → queue → processQueue → showAlert
                               │    • COMPACT corner     → cQueue → processCompact → showCompact
                               │    • shoutout           → showShoutout (fullscreen takeover)
                               │    • resub ≥12mo / milestone → showResubFs (fullscreen)
                               └─ Canvas rAF loop draws particles + raid fleet continuously
```

- **Transport is swappable.** Today events arrive over a Streamer.bot WebSocket (`ws://192.168.178.39:9090`, override via `?sb=ws://host:port`). The overlay only needs *some* source that calls `enqueue(type, data)`. A direct Twitch EventSub WebSocket integration is a viable alternative (needs OAuth token + subscription management client-side).
- **Two independent alert channels** so a big center alert and a minor corner alert never block each other — each has its own queue.
- **Demo mode**: when neither `?sb=` nor `?live=1` is present, a demo panel + dark preview backdrop appear and a teaser plays. In demo mode **sound is muted by default** (toggle in panel). In OBS, launch with `?live=1` or `?sb=...`.

### Event type → channel/treatment
| Type(s) | Channel | Notes |
|---|---|---|
| `follow` | BIG | cyan, blue particle burst |
| `sub` | BIG | gold, gold border pulse |
| `resub` | BIG (+ fullscreen if ≥12mo or milestone) | gold; milestones [6,12,24,36,48,60] |
| `bits`/`cheer` | BIG | gold, **count-up** stat |
| `subgift`/`subbomb`/`giftbomb` | BIG | gold, **scale-pop** entrance, fireworks |
| `raid` | BIG | red danger; **slam** entrance; **incoming Reaper fleet** (Canvas); count-up RAIDER stat; red screen flash |
| `hypetrain` | BIG | green; screen shake at lvl≥3; fireworks at lvl5 |
| `redeem` (channel points), `alert`, `outraid`, `streamstart` | COMPACT (top-right) | smaller card; some keep a quick screen flash (Red Alert, RIP, Selfie) |
| `shoutout` | Fullscreen cinematic | scan-beam reveal + typewriter |

---

## Screens / Components

### 1. BIG Alert (bottom-center)
- **Position**: `position:absolute; bottom:84px; left:50%; transform:translateX(-50%)`. Width **920px**. z-index 150. Animations are applied to an inner wrapper so the centering transform is never overwritten.
- **Frame**: `background: rgba(0,0,0,0.88)`, `border:1.5px solid rgba(0,212,255,0.45)`, `padding:28px 40px 24px`. Border color/pulse keyframe set by event tier (cyan/gold/red/green).
- **Decorations** (all animate in): 4 corner ticks (gold, `border-width:2.5px`, draw in from 0→26px over 0.2s ease-out, staggered at 90ms); top & bottom **gradient hairlines** (`linear-gradient(90deg,transparent,#f0a500,#00d4ff,#f0a500,transparent)` top / cyan-gold-cyan bottom) that scale-X from 0→1 over 0.3s at 150ms; static scanline overlay (`repeating-linear-gradient(0deg,transparent 3px,rgba(0,212,255,0.010) 1px)`).
- **Layout**: horizontal flex, `gap:28px` → [avatar?] · [text block, flex:1] · [stat badge?].
  - **Avatar** (optional): 96px (124px for raids/bombs), `border:1.5px solid #00d4ff`, drop-shadow cyan, two gold corner ticks. Reveals with a "decrypt" animation (`blur(14px)→0`, `brightness 2.2→1`, `scale .9→1`, 0.85s ease-out) at 280ms.
  - **Label row**: pulsing gold diamond (8px, rotate 45°, `ccDiamond` scale-pulse 1.4s) + label text. `Share Tech Mono`, 12px, `letter-spacing:7px`, `#f0a500`, glow `text-shadow:0 0 10px rgba(240,165,0,0.8)`, uppercase.
  - **Username**: `Bebas Neue` 66px (follow) or `Orbitron 900` 48px (most), color per tier, glow `0 0 15px <accent>, 0 0 40px <accent@0.3>`. **Builds in letter-by-letter** ("flying letters", see Interactions) starting at 300ms.
  - **Message**: `Share Tech Mono` 15px, `letter-spacing:1.5px`, `#cce8f0`, uppercase, `line-height:1.5`. Highlighted spans use `#f0a500` + glow. Rises in (`ccRiseFade`, opacity 0→1 + translateY 8→0, 0.5s ease-out, delayed 0.55s).
  - **Stat badge** (optional): `border:1.5px solid #f0a500`, `padding:11px 20px`. Number `Orbitron 900` 38px gold glow; label `Share Tech Mono` 10px `letter-spacing:4px` `#6aabb8`. Slides in from translateX(22px) at 500ms. Bits/Raid/Outraid numbers **count up** (cubic ease-out, 1100ms, `toLocaleString('de-DE')`).
- **Glow**: soft radial ellipse under the frame, color per tier, fades in at 200ms.
- **Hold then exit**: shows for `duration` (per event, 6.5–10s), then `ccAlertOut` (translateY 0→38px, scale-x→0.93, blur, opacity→0, 0.5s ease-in).

### 2. COMPACT Alert (top-right)
- **Position**: `top:26px; right:26px`, width **440px**, z-index 160. Shares the corner with the Latest widget; compact **always wins** (hides Latest on show).
- **Card**: `background: rgba(0,0,0,0.9)`, `border:1px solid <accent@0.4>`, `border-left:3px solid <accent>`, `padding:15px 18px 16px`, corner tick + scanlines. A **scan sweep** band (`linear-gradient` accent→transparent) wipes top→bottom on reveal (translateY -100%→260%, 0.5s).
- **Layout**: flex `gap:15px` → [avatar 54px?] · [label (10px `letter-spacing:4px`, diamond) / name `Orbitron 900` 24px accent glow / message `Share Tech Mono` 11px].
- **Entrance**: `ccCompactIn` (translateX 60→0, slight scale-x overshoot, blur→0, 0.5s). Name flies in (smaller params); message rises in (0.4s, delay 0.34s). **Exit** `ccCompactOut` (translateX→70px, 0.4s). Default on-screen `duration` ≈ 5200ms.

### 3. LATEST Widget (top-right, periodic)
- **Position**: `top:26px; right:26px`, width **354px**, z-index 159. `background: rgba(4,6,10,0.94)`, `border:1px solid rgba(0,212,255,0.18)`, `border-left:2px solid <accent>`, `padding:13px 16px 14px`, corner tick + scanlines.
- **Content**: [48px avatar OR accent glyph] · [label `Share Tech Mono` 9px `letter-spacing:3px` / name `Rajdhani 700` 23px accent glow / sub-line `Share Tech Mono` 10px dim] ; bottom **progress dots** (one bar per available slot, active = 22px wide + glow, inactive = 9px dim).
- **Behavior**: **Not always visible.** A "session" runs **every 10–15 min** (random) — plus a teaser ~4s after load. Each session fades in, cycles through the available slots (Letzter Follower → Letztes Abo → Letzter Resub → Letzter Gift-Sub), **5s per slot**, each slot re-triggering a `ccLatestIn` rise (0.45s), then hides. Slot data is updated silently on every matching event (does not force-show). Slots:
  - `follower` — label `LETZTER FOLLOWER`, accent `#00d4ff`, glyph `✦`
  - `sub` — `LETZTES ABO`, `#f0a500`, glyph `★`, sub-line = tier
  - `resub` — `LETZTER RESUB`, `#f0a500`, glyph `⟳`, sub-line = "N MONATE"
  - `giftsub` — `LETZTER GIFT-SUB`, `#f0a500`, glyph `◆`, sub-line = "xN SUBS"

### 4. SHOUTOUT (fullscreen cinematic takeover)
- Full-screen, z-index 200. Backdrop fades to `rgba(0,0,0,0.84)`.
- **Scan beam**: 4px vertical cyan bar (`linear-gradient` + `box-shadow:0 0 40px 18px rgba(0,212,255,0.5)`) sweeps right→left across the screen (1.3s, `cubic-bezier(0.4,0,0.2,1)`).
- **Left stage**: huge rotated watermark of the streamer name (`Bebas Neue` 210px, `rgba(0,212,255,0.035)`, `rotate(-10deg)`); centered block: header `// CHAOS CREW // SHOUTOUT` (cyan, 11px `letter-spacing:11px`), giant `SCHAUT VORBEI` (`Bebas Neue` 118px, `rgba(255,255,255,0.9)`), streamer name (`Orbitron 900` 54px gold glow), `TWITCH.TV/NAME` (cyan dim). These fade in staggered after the beam.
- **Right panel** (600px, `border-left:2px solid rgba(240,165,0,0.4)`): gold corner ticks, top/bottom gradient lines, animated left **energy bar** (gradient sliding via `ccEnergy` 3s), scanlines. Content: `// SHOUTOUT //` label; **186px avatar** with two counter-rotating dashed rings (`ccSoRing` 9s & 14s reverse) + cyan corner ticks + gold border + decrypt; **name typed in** char-by-char (70ms/char) with a blinking gold cursor; game line (cyan); divider; message; `twitch.tv/...` url. Panel slides in via `ccSoPanelIn` (translateX 102%→0 with overshoot, 0.7s). Exit `ccSoPanelOut`. Default 12s.

### 5. RESUB Fullscreen (≥12 months or milestone)
- Centered framed card (920px) over `rgba(0,0,0,0.82)`. Gold corners, top/bottom + side gradient bars, scanlines. Label (gold), 204px avatar (cyan border, gold ticks), name `Orbitron 900` 62px cyan glow, badge (e.g. "2 JAHRE AN BORD") `Share Tech Mono` 28px gold, message. Entrance gated by a **blue or gold screen flash** (gold + fireworks for milestones). 11–13s.

### 6. RAID — Incoming Reaper Fleet (Canvas)
- Drawn on a full-screen `<canvas>` (z-index 140, behind the alert box). Triggered by `launchFleet()` during a raid for ~`duration-1200` ms.
- **Warp starfield**: ~120 streaks radiating from a vanishing point (`cx:960, cy:470`), red `#ff4444`, additive glow, recycling outward — conveys FTL approach.
- **Ships**: 6 staggered sprites that emerge from the vanishing point and **grow as they approach** (scale `0.04 → ~0.6–1.3`, `ease=p²` so they accelerate toward camera), drifting to spread positions with a slight sway. Each has a **red radial haze** behind it and a red drop-shadow glow. Global fade-in/out envelope.
- **Sprites**: `assets/reaper_sovereign.png` and `assets/reaper_omen.png` (see Assets). A vector-silhouette fallback (`drawReaper()`) draws if images haven't loaded.
- The "246 → 247 RAIDER" stat counts up in the alert box simultaneously.

### Peripheral
- **Debug overlay** (bottom-right): timestamped event log, `Orbitron` 10px cyan, auto-dims after 15s. Dev aid — keep or strip in production.
- **Giveaway joins** (bottom-left): list of users who entered a giveaway (from `/giveaway/ws` `gw_join`), fades after 60s.
- **Demo panel** (left-center, demo mode only): mute toggle + buttons to fire every event type. Dark preview backdrop only shows in demo mode (transparent in OBS).

---

## Interactions & Behavior

- **Flying letters (text build-up)** — `flyInLetters(el, text, opts)`: wraps each character in an `inline-block` span, each animated with `ccLetterIn` (from `translate(±spread, +18px) rotate(±deg) scale(1.5) blur(3px)` opacity 0 → settled, `cubic-bezier(0.2,1.1,0.3,1)`, ~0.5s, staggered ~30ms/char). Uses **no `forwards`/`both` fill** so letters revert to their natural visible base state after animating (this avoids a fill-mode quirk where finished forwards-animations could read as opacity 0). Big alerts: step 30, spread 36, rot 22. Compact: step 22, spread 20, rot 14.
- **Entrance variants** (`cfg.entrance`): `slam` (raid — drops from above with squash/stretch), `pop` (sub bomb — scales up from 0.3 with rotate), default `ccAlertIn` (rise + settle). After the entrance the wrapper's animation is cleared to `none` and rested on inline `opacity:1` (keeps screen-shake if active).
- **Count-up**: `countUp(el, target, 1100ms)` cubic ease-out, locale-formatted.
- **Typewriter**: `typeIn(el, text, 70ms)` + blinking cursor (`ccBlink` 0.55s step-end).
- **Screen flash**: `flash(color, count, cb, on, off)` toggles a full-screen tint; raids use red 6×(80/100ms); also used by Red Alert/RIP/Selfie redeems.
- **Border pulse** by tier: cyan (`ccBorderCyan` 2.4s), red (`ccBorderRaid` 0.75s), gold (`ccBorderGold` 1.3s), green (`ccBorderGreen` 1.3s).
- **Screen shake** (hype lvl≥3): `ccHypeShake` 0.28s infinite on the alert wrapper.
- **Sound**: one short audio per event (`sounds/*.mp3|ogg`). `this.muted` gates playback; default muted in demo, unmuted live.
- **Queues**: `processQueue`/`processCompact` show one alert at a time per channel; next starts after the previous fully exits.

## State Management
- `queue` / `isShowing` (big channel), `cQueue` / `cShowing` (compact channel).
- `latest` store `{follower, sub, resub, giftsub}` + `latestRunning` + session timers.
- `particles[]` and `ships[]`/`warp[]`/`fleet` for the Canvas rAF loop.
- `muted`, `demoMode`. WebSocket reconnect state (`wsDelay`, timers, exponential backoff to 10s).
- `MILESTONES = [6,12,24,36,48,60]`.

## Design Tokens
From the **Chaos Crew Voice Console** design system. Colors:
- `--cyan #00d4ff` (primary/info/connected) · `--gold #f0a500` (secondary/operator) · `--green #00ff88` (success/live) · `--red #ff4444` (danger/raid)
- Backgrounds: `--bg #04060a` · `--bg2 #080e14` · `--bg3 #0c1520` (overlay frames use `rgba(0,0,0,0.88–0.97)` for OBS)
- Text: `#c8dce8` / `#cce8f0` (never pure white for body)
- Border alphas (cyan): 0.08 / 0.18 / 0.28 / 0.38 / 0.50
Typography:
- `Share Tech Mono` — labels, badges, messages, stat labels (uppercase, `letter-spacing` 1.5–10px)
- `Bebas Neue` — large follow usernames + the SHOUTOUT hero text
- `Orbitron 700/900` — most usernames, stat numbers, hero counters
- `Rajdhani 400/600/700` — Latest widget name, longer body text
Other: **no border-radius** (everything square; only avatars/rings use circles), **no drop shadows** for elevation (use border alpha + glow text-shadows), corner-tick motif on every card, scanline overlay (`rgba(0,212,255,~0.01)`), transitions 0.12s hover / 0.18–0.3s state.
> Full token list + the source CSS live in the Chaos Crew design system (`colors_and_type.css`, `services/*/public/chaos-crew-*.css`). Pull exact `--*` values from there.

## Assets
- `assets/reaper_sovereign.png` (149×444, transparent) and `assets/reaper_omen.png` (169×386, transparent) — **user-supplied** Reaper images (Mass Effect, BioWare/EA) background-removed for the raid fleet. The user provided these for their own channel. If your codebase has licensing constraints, swap them for the included vector-silhouette fallback (`drawReaper()`).
- `sounds/*.mp3|ogg` — per-event audio (follow, sub, bits, bomb, raid, redeem, hype, outraid, rip, selfie, alert).
- Fonts via Google Fonts: Bebas Neue, Share Tech Mono, Orbitron (700/900), Rajdhani (400/600/700).

## Files
- `Overlay Redesign.dc.html` — the reference design (template + logic). Read `class Component extends DCLogic { … }` for all event configs (`buildAlert`, `buildRedeem`), animation sequences (`showAlert`, `showCompact`, `showShoutout`, `showResubFs`), the Canvas loop (`startParticleLoop`, `launchFleet`, `drawFleet`, `drawReaper`), and transport (`connect`, `handleMessage`, `gwConnect`).
- `support.js` — the `.dc.html` runtime (reference only; not needed in the rebuild).
- `assets/`, `sounds/` — production assets to reuse directly.

## Implementation notes
- Keep the root transparent; OBS composites it over the scene.
- Drive everything from one `enqueue(type, data)` entry point so the transport (Streamer.bot today, EventSub later) is pluggable.
- Prefer Canvas for particles/fleet and DOM for the framed cards (as in the reference).
- All copy is **German**, informal "du", operator tone. Exact strings are in the event configs.
