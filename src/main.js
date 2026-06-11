'use strict';
// Main process. The overlay is a transparent, frameless, always-on-top,
// click-through window — it only draws on top of the screen and never
// touches the CS2 process (spec §2, §8).
//
// IMPORTANT FOR USERS: an external window can only render over CS2 when the
// game runs in FULLSCREEN WINDOWED / borderless mode. Exclusive fullscreen
// occludes it. This is surfaced in the README and the in-app status line.

const { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const { loadConfig, CONFIG_PATH } = require('./config');
const { GsiServer } = require('./gsi/server');
const { ContextEngine } = require('./gsi/context');
const { installGsiConfig } = require('./gsi/install-config');
const { visibilityAction } = require('./visibility');
const { ProximityEngine } = require('./proximity');
const { ConsoleLogWatcher } = require('./position/condebug');
const { fitTransform, applyTransform } = require('./vision/radar');

const PROJECT_ROOT = path.join(__dirname, '..');
const LINEUPS_DIR = path.join(PROJECT_ROOT, 'lineups');

let win = null;
let mouseInteractive = true; // overlay starts clickable/scrollable; Alt+M toggles click-through
let pinned = false; // mirrored from the renderer so auto-hide never yanks a pinned card

function send(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

// Load every lineups/*.json and rewrite image/clip paths to absolute
// file:// URLs so the renderer can display them regardless of cwd.
function loadLineups() {
  const maps = {};
  if (!fs.existsSync(LINEUPS_DIR)) return maps;
  for (const file of fs.readdirSync(LINEUPS_DIR)) {
    if (!file.endsWith('.json')) continue;
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(LINEUPS_DIR, file), 'utf8'));
      if (!doc.map || !Array.isArray(doc.lineups)) continue;
      for (const lu of doc.lineups) {
        for (const key of ['stand', 'aim']) {
          if (lu[key] && lu[key].image) lu[key].image = toFileUrl(lu[key].image);
        }
        if (lu.clip) lu.clip = toFileUrl(lu.clip);
      }
      maps[doc.map] = doc.lineups;
    } catch (err) {
      console.error(`Skipping ${file}: ${err.message}`);
    }
  }
  return maps;
}

function toFileUrl(relative) {
  const abs = path.join(PROJECT_ROOT, relative);
  return fs.existsSync(abs) ? pathToFileURL(abs).href : null; // null → renderer shows a "capture pending" placeholder
}

// V2: every lineup with a recorded `spot` becomes a proximity target.
function collectSpots(maps) {
  const spots = [];
  for (const [map, lineups] of Object.entries(maps)) {
    for (const lu of lineups) {
      if (lu.spot && typeof lu.spot.x === 'number' && typeof lu.spot.y === 'number') {
        spots.push({ id: lu.id, map, x: lu.spot.x, y: lu.spot.y, z: lu.spot.z });
      }
    }
  }
  return spots;
}

// V2 data capture: write the current position into a lineup's `spot` field
// in whichever lineups/*.json holds it. Pretty-printed so diffs stay clean.
function saveSpot(lineupId, pos) {
  if (!fs.existsSync(LINEUPS_DIR)) return { ok: false, message: 'lineups/ not found' };
  for (const file of fs.readdirSync(LINEUPS_DIR)) {
    if (!file.endsWith('.json')) continue;
    const full = path.join(LINEUPS_DIR, file);
    try {
      const doc = JSON.parse(fs.readFileSync(full, 'utf8'));
      const lu = (doc.lineups || []).find((l) => l.id === lineupId);
      if (!lu) continue;
      const round = (n) => (n == null ? null : Math.round(n * 100) / 100);
      lu.spot = { x: round(pos.x), y: round(pos.y), z: round(pos.z) };
      fs.writeFileSync(full, JSON.stringify(doc, null, 2) + '\n');
      return { ok: true, message: `${lineupId} → ${file}` };
    } catch (err) {
      return { ok: false, message: `Could not update ${file}: ${err.message}` };
    }
  }
  return { ok: false, message: `Lineup ${lineupId} not found in any lineups/*.json` };
}

function createWindow(config) {
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  const o = config.overlay;
  const x = o.edge === 'left' ? o.marginSide : screenW - o.width - o.marginSide;
  // Use the screen height we're given; the detail card scrolls internally
  // for whatever doesn't fit.
  const height = Math.min(960, screenH - o.marginTop - o.marginSide);

  win = new BrowserWindow({
    width: o.width,
    height,
    x,
    y: o.marginTop,
    transparent: true,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // 'screen-saver' keeps us above borderless-fullscreen games.
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Clickable/scrollable by default (user preference); Alt+M switches to
  // click-through when the overlay should never eat game input.
  win.setIgnoreMouseEvents(!mouseInteractive, { forward: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('closed', () => { win = null; });
}

function registerHotkeys(hotkeys) {
  const bind = (accelerator, fn, label) => {
    if (!accelerator) return;
    const ok = globalShortcut.register(accelerator, fn);
    if (!ok) console.error(`Could not register hotkey ${accelerator} (${label}) — already in use?`);
  };

  bind(hotkeys.toggle, () => {
    if (!win) return;
    // showInactive: never steal focus from the game (spec §5.6).
    win.isVisible() ? win.hide() : win.showInactive();
  }, 'toggle');

  bind(hotkeys.next, () => send('command', 'next'), 'next');
  bind(hotkeys.prev, () => send('command', 'prev'), 'prev');
  bind(hotkeys.pin, () => send('command', 'pin'), 'pin');

  bind(hotkeys.mouse, () => {
    if (!win) return;
    mouseInteractive = !mouseInteractive;
    win.setIgnoreMouseEvents(!mouseInteractive, { forward: true });
    send('mouse-mode', mouseInteractive);
    if (mouseInteractive) win.showInactive();
  }, 'mouse');
}

app.whenReady().then(() => {
  const config = loadConfig();

  createWindow(config);
  registerHotkeys(config.hotkeys);

  // Best-effort GSI cfg install on every launch (idempotent). The status
  // line tells the user whether data is actually flowing.
  const install = installGsiConfig({ port: config.port, token: config.token });
  console.log(install.message);

  const engine = new ContextEngine();
  const gsi = new GsiServer({ port: config.port, token: config.token }).start();

  gsi.on('payload', (payload) => engine.update(payload));
  gsi.on('status', (status) => send('gsi-status', status));
  gsi.on('error', (err) => {
    console.error(`GSI listener error: ${err.message}`);
    send('gsi-status', { connected: false, error: err.code === 'EADDRINUSE' ? `Port ${config.port} is in use` : err.message });
  });
  // --- V2 proximity: position fixes → auto-select the spot's lineup ---
  // Sources: the dev simulator today (npm run simulate-position), screen-
  // OCR of cl_showpos later. cl_showpos is cheat-protected in CS2, so the
  // whole layer is a practice-server feature; it changes nothing in
  // matchmaking, where V1 manual selection remains the only mode.
  const prox = new ProximityEngine(config.v2);
  let allSpots = collectSpots(loadLineups());
  let lastPosition = null;
  let autoSpot = null;
  let suppressedSpot = null;   // manual pick wins while still on this spot
  let rendererSelection = null;

  const syncSpots = () => {
    const map = engine.context.map;
    prox.setSpots(map ? allSpots.filter((s) => s.map === map) : allSpots);
  };
  syncSpots();

  function applyVisibility() {
    if (!win || win.isDestroyed()) return;
    const ctx = engine.context;
    const action = visibilityAction(ctx, {
      visible: win.isVisible(),
      pinned,
      autoShow: config.overlay.autoShow,
      onSpot: !!autoSpot
    });
    if (action === 'show') win.showInactive(); // never steal game focus
    else if (action === 'hide') win.hide();
    if (action) console.log(`Auto-${action} (equipped: ${ctx.equippedGrenade || 'none'}, onSpot: ${autoSpot || 'no'})`);
  }

  engine.on('context', (ctx) => {
    send('context', ctx);
    syncSpots();
    applyVisibility();
  });

  function handlePosition(pos, source = 'getpos') {
    if (source === 'getpos') maybeCalibrateVision(pos);
    lastPosition = pos;
    const id = prox.update(pos);
    // Always confirm the fix in the UI — without feedback the user can't
    // tell whether the position pipeline is alive or why nothing matched.
    send('position-fix', { pos, spot: id, spotsOnMap: prox.spots.length, source });
    if (id === autoSpot) return;
    autoSpot = id;
    if (suppressedSpot && suppressedSpot !== id) suppressedSpot = null; // moved on → override expires
    if (id && id !== suppressedSpot) send('auto-select', id);
    applyVisibility();
  }

  // --- radar vision (experimental, opt-in): arrow pixel → world position ---
  // Calibration is learned, not configured: every exact getpos fix that
  // lands while the radar arrow was just seen becomes a (pixel, world)
  // pair; with enough spread we solve world = a*pixel + b per axis and
  // persist it per map. After that, vision alone feeds the same proximity
  // pipeline — including in matches, where getpos is unavailable.
  const visionPairs = {};   // map → [{px, py, x, y}]
  const calibration = config.vision.calibration || {};
  let lastArrow = null;     // { px, py, size, at }

  function maybeCalibrateVision(pos) {
    const map = engine.context.map;
    if (!config.vision.enabled || !map || !lastArrow) return;
    if (Date.now() - lastArrow.at > 1500) return; // arrow too stale to pair
    const pairs = (visionPairs[map] = visionPairs[map] || []);
    pairs.push({ px: lastArrow.px, py: lastArrow.py, x: pos.x, y: pos.y });
    const t = fitTransform(pairs);
    if (!t) return;
    calibration[map] = t;
    persistCalibration();
    console.log(`Radar vision calibrated for ${map} (${pairs.length} getpos/arrow pairs)`);
  }

  function persistCalibration() {
    try {
      const onDisk = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      onDisk.vision = { ...(onDisk.vision || {}), calibration };
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(onDisk, null, 2));
    } catch (err) {
      console.error(`Could not persist radar calibration: ${err.message}`);
    }
  }

  ipcMain.handle('vision-source', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    return sources.length ? sources[0].id : null;
  });

  ipcMain.on('arrow-pixel', (_event, arrow) => {
    lastArrow = { px: arrow.px, py: arrow.py, size: arrow.size, at: Date.now() };
    const map = engine.context.map;
    const t = map && calibration[map];
    if (t) handlePosition(applyTransform(t, arrow), 'vision');
  });

  // Position sources, all feeding the same proximity pipeline:
  // 1) dev simulator over HTTP (npm run simulate-position)
  gsi.on('position', handlePosition);

  // 2) CS2's console.log when launched with -condebug: a `getpos` bind
  //    prints exact coordinates that we tail out of the log. Practice-server
  //    feature (getpos is sv_cheats-protected in matches).
  const consoleLogPath =
    config.consoleLog ||
    (install.path ? path.join(path.dirname(install.path), '..', 'console.log') : null);
  if (consoleLogPath) {
    const condebug = new ConsoleLogWatcher({ logPath: consoleLogPath });
    condebug.on('position', handlePosition);
    condebug.start();
    console.log(`Watching for getpos fixes in ${consoleLogPath} (requires -condebug launch option)`);
    app.on('will-quit', () => condebug.stop());
  } else {
    console.log('console.log path unknown — set "consoleLog" in config.json to enable getpos tailing.');
  }

  ipcMain.on('pin-state', (_event, value) => { pinned = !!value; });
  ipcMain.on('selection-changed', (_event, id) => { rendererSelection = id; });
  ipcMain.on('manual-select', () => { suppressedSpot = autoSpot; });

  // V2 data capture (Alt+S): records where you're standing into the
  // selected lineup — builds the proximity DB during the verification pass.
  if (config.hotkeys.capture) {
    const ok = globalShortcut.register(config.hotkeys.capture, () => {
      if (!rendererSelection || !lastPosition) {
        console.error('Spot capture needs a selected lineup and a position fix (cl_showpos OCR or simulator).');
        return;
      }
      const res = saveSpot(rendererSelection, lastPosition);
      if (res.ok) {
        allSpots = collectSpots(loadLineups());
        syncSpots();
        send('spot-captured', { id: rendererSelection, spot: lastPosition });
        console.log(`Spot saved: ${res.message}`);
      } else {
        console.error(`Spot capture failed: ${res.message}`);
      }
    });
    if (!ok) console.error(`Could not register hotkey ${config.hotkeys.capture} (capture) — already in use?`);
  }

  ipcMain.on('renderer-ready', () => {
    send('init', {
      lineups: loadLineups(),
      hotkeys: config.hotkeys,
      gsiInstall: { ok: install.ok, message: install.message, path: install.path },
      vision: config.vision
    });
    send('context', engine.context);
    send('gsi-status', { connected: gsi.connected });
    send('mouse-mode', mouseInteractive);
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    gsi.stop();
  });
});

app.on('window-all-closed', () => app.quit());
