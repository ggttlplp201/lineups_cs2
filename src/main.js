'use strict';
// Main process. The overlay is a transparent, frameless, always-on-top,
// click-through window — it only draws on top of the screen and never
// touches the CS2 process (spec §2, §8).
//
// IMPORTANT FOR USERS: an external window can only render over CS2 when the
// game runs in FULLSCREEN WINDOWED / borderless mode. Exclusive fullscreen
// occludes it. This is surfaced in the README and the in-app status line.

const { app, BrowserWindow, globalShortcut, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const { loadConfig } = require('./config');
const { GsiServer } = require('./gsi/server');
const { ContextEngine } = require('./gsi/context');
const { installGsiConfig } = require('./gsi/install-config');
const { visibilityAction } = require('./visibility');

const PROJECT_ROOT = path.join(__dirname, '..');
const LINEUPS_DIR = path.join(PROJECT_ROOT, 'lineups');

let win = null;
let mouseInteractive = false;
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
  // Click-through by default so the overlay never eats game input.
  win.setIgnoreMouseEvents(true, { forward: true });
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
  engine.on('context', (ctx) => {
    send('context', ctx);
    if (!win || win.isDestroyed()) return;
    const action = visibilityAction(ctx, {
      visible: win.isVisible(),
      pinned,
      mouseMode: mouseInteractive,
      autoShow: config.overlay.autoShow
    });
    if (action === 'show') win.showInactive(); // never steal game focus
    else if (action === 'hide') win.hide();
    if (action) console.log(`Auto-${action} (equipped: ${ctx.equippedGrenade || 'none'})`);
  });

  ipcMain.on('pin-state', (_event, value) => { pinned = !!value; });

  ipcMain.on('renderer-ready', () => {
    send('init', {
      lineups: loadLineups(),
      hotkeys: config.hotkeys,
      gsiInstall: { ok: install.ok, message: install.message }
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
