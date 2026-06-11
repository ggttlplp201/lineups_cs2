'use strict';
// Loads (and on first run, creates) config.json at the project root.
// The auth token here must match the token written into the GSI cfg —
// install-config.js reads it from the same file, so they stay in sync.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

const DEFAULTS = {
  port: 47474,
  token: null, // generated on first run
  hotkeys: {
    toggle: 'Alt+X', // show/hide the overlay
    next: 'Alt+]',   // next lineup
    prev: 'Alt+[',   // previous lineup
    pin: 'Alt+P',    // pin the detail card (hides the list, keeps the card)
    mouse: 'Alt+M'   // toggle click-through vs interactive mode
  },
  overlay: {
    edge: 'right',   // 'left' | 'right'
    width: 380,
    marginTop: 80,
    marginSide: 16,
    autoShow: true   // show only while a grenade is equipped (pin/mouse mode exempt)
  }
};

function loadConfig() {
  let cfg = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (err) {
      console.error(`config.json is unreadable (${err.message}) — recreating with defaults.`);
    }
  }
  const merged = {
    ...DEFAULTS,
    ...cfg,
    hotkeys: { ...DEFAULTS.hotkeys, ...(cfg.hotkeys || {}) },
    overlay: { ...DEFAULTS.overlay, ...(cfg.overlay || {}) }
  };
  if (!merged.token) {
    merged.token = crypto.randomBytes(16).toString('hex');
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2));
  return merged;
}

module.exports = { loadConfig, CONFIG_PATH };
