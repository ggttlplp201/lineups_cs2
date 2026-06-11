# CS2 Lineup Overlay (V1)

A VAC-safe desktop overlay that surfaces grenade lineups for the map you're
playing. It listens to Valve's official **Game State Integration** (GSI) to
know the map, your side, and which grenade you have out — then you pick a
lineup with a hotkey and it shows where to stand, where to aim, and exactly
how to release the throw.

**Safety model (non-negotiable):** the app is an external process that only
runs an HTTP listener and draws a window. No memory reading, no injection,
no game-file modification, no input automation — ever. GSI is an official
Valve feature and carries no anti-cheat risk. See `SPEC §2/§8`.

## Requirements

- **Windows** (or Linux) — the machine that actually runs CS2. There is no
  macOS build of CS2; on a Mac you can develop the overlay using the
  simulator (below) but not run it against the game.
- **CS2 must run in Fullscreen Windowed (borderless) mode.** An external
  window cannot draw over exclusive fullscreen. `Settings → Video → Display
  Mode → Fullscreen Windowed`. This is the #1 "overlay is invisible" cause.
- Node.js 18+.

## Setup

```bash
npm install
npm start
```

First launch generates `config.json` (port, auth token, hotkeys) and
attempts to write the GSI config into your CS2 folder automatically. If your
Steam library is somewhere unusual:

```bash
npm run install-gsi -- "D:\SteamLibrary\steamapps\common\Counter-Strike Global Offensive\game\csgo\cfg"
```

Then (re)start CS2. The overlay header should read **Receiving game data ✓**
within seconds of the game launching.

## Hotkeys (rebind in `config.json`)

| Key | Action |
| --- | --- |
| `Alt+X` | Show / hide the overlay |
| `Alt+[` / `Alt+]` | Previous / next lineup |
| `Alt+P` | Pin the detail card (hides the list, keeps the card up while you line up) |
| `Alt+M` | Toggle mouse mode (overlay is click-through by default so it never eats game input) |

Equipping a smoke on Mirage floats the matching smoke lineups for your side
to the top automatically; the **All** button browses everything for the map.

**Auto-show:** by default the overlay only appears while you have a grenade
equipped, and hides itself when you switch back to a gun (`overlay.autoShow`
in `config.json`; set it to `false` for an always-manual overlay). A pinned
card and mouse mode are never auto-hidden, and `Alt+X` still toggles
manually at any time.

## Developing without CS2 (e.g. on the Mac)

```bash
npm start            # terminal 1 — overlay + GSI listener
npm run simulate     # terminal 2 — fakes CS2 posting game state
```

The simulator cycles menu → warmup → live → smoke equipped → dead/spectating,
which exercises every context transition the UI handles.

Run the logic tests with `npm test` (no Electron needed).

## Lineup data

`lineups/de_mirage.json` ships with 8 classic T-side Mirage smokes. The
facts (stand, aim, throw type, difficulty) are paraphrased from the
references in `SPEC §6.1`; **no images or text were copied from those
sites.** Every entry is `"verified": false` — and shows an UNVERIFIED badge —
until you re-test it in the current build and shoot your own screenshots.
The capture pipeline (which also collects V2's `spot` coordinates in the
same pass) is documented in `img/mirage/README.md`.

Adding a map = dropping in `lineups/de_<map>.json` + images. No code changes.

## Project layout

```
src/main.js               Electron main: window, hotkeys, wiring
src/preload.js            IPC bridge (contextIsolation on)
src/config.js             config.json loader (port/token/hotkeys)
src/gsi/server.js         GSI HTTP listener + heartbeat watchdog
src/gsi/context.js        payload → GameContext (map/side/phase/grenade)
src/gsi/install-config.js Steam discovery + cfg writer
src/renderer/             overlay UI (vanilla, no build step)
lineups/                  static lineup DB (one JSON per map)
scripts/simulate-gsi.js   fake-CS2 dev tool
test/                     node:test unit tests
```

## V2 (proximity auto-trigger) — not built yet

V2 adds opt-in screen-OCR of the `cl_showpos` readout to auto-surface the
nearest lineup. Before starting it: confirm `cl_showpos` works in your
target game modes, and read `SPEC §7` — debounce OCR jitter, match on X/Y
with generous Z tolerance, restrict Tesseract to a digit whitelist, and
upscale the captured region 3–4× (the readout font is tiny). The `spot`
field in the data model is already reserved for it. Manual selection must
always override the auto-pick. Screen-reading only — same safety model.
