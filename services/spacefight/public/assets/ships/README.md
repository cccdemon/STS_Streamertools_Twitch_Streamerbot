# Ship Artwork

The active Spacefight roster uses smooth, high-resolution transparent PNG
cutouts. Each ship faces right and is mirrored automatically for the defender.

## Active high-resolution ships

| Ship class | File |
|---|---|
| `VALKYRIE` | `valkyrie.png` |
| `BASTION` | `bastion.png` |
| `WRAITH` | `wraith.png` |
| `RAPTOR` | `raptor.png` |

Use a transparent background, generous padding and a clean right-facing side
profile. Raster artwork is rendered smoothly; do not use pixel art for active
ships.

## Legacy sprite-sheet support

Drop PNG sprite sheets here to give each Spacefight ship class its own pixel-art look. **No code changes are needed** — the overlay loads each sheet by matching the ship name (lowercased, non-alphanumeric → `-`).

If a sheet is missing or fails to load, a procedural placeholder is generated at runtime so fights always render.

## File naming

| Ship class (in `SHIPS` array)  | File name           |
|--------------------------------|---------------------|
| `PERSEUS`                      | `perseus.png`       |
| `HAMMERHEAD`                   | `hammerhead.png`    |
| `VANGUARD`                     | `vanguard.png`      |
| `CONSTELLATION`                | `constellation.png` |
| `GLADIUS`                      | `gladius.png`       |
| `SABRE`                        | `sabre.png`         |
| `ORIGIN 300I`                  | `origin-300i.png`   |
| `ARROW`                        | `arrow.png`         |
| `HORNET`                       | `hornet.png`        |
| `AURORA`                       | `aurora.png`        |

## Sheet format

- **Frame size**: 32 × 32 px
- **Layout**: horizontal strip, **12 frames** in this exact order
- **Total sheet**: 384 × 32 px
- **Transparent background** (the arena starfield shows through)
- **Pixel art**: keep it crisp — the overlay renders at 2× scale (64 × 64 displayed) with `image-rendering: pixelated`, so sub-pixel detail in the source is wasted.

| Frame | Purpose       | Notes                                                             |
|-------|---------------|-------------------------------------------------------------------|
| 0–3   | Idle          | Cycle ~120 ms/frame. Subtle thruster flicker / engine glow.       |
| 4–6   | Thrust        | Played when the ship surges forward to fire. Bigger flame.        |
| 7     | Hit flash     | Single frame; shown for ~200 ms when struck. Bright/desaturated.  |
| 8–11  | Explosion     | Plays on death. ~80 ms/frame. Last frame holds before cleanup.    |

## Orientation

All ships **face right**. The defender ship is automatically mirrored at render time via `transform: scaleX(-1)` — don't ship a left-facing variant.

## Adding new ship classes

If you add a new entry to the `SHIPS` array in `spacefight.js`, drop a matching PNG here using the naming rule above (or skip the file entirely — the procedural placeholder will give it a unique color hash).
