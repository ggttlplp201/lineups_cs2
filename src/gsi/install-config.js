'use strict';
// GSI config installer (spec §5.1).
// Writes gamestate_integration_lineupoverlay.cfg into the CS2 cfg folder so
// the game starts POSTing state to our listener. Subscribes ONLY to
// components that are valid during live play — never player_position /
// allplayers_position (spectator-only by design).
//
// Run directly:           npm run install-gsi
// Override the cfg dir:   npm run install-gsi -- "D:\\SteamLibrary\\...\\csgo\\cfg"
//                         (or set CS2_CFG_DIR)

const fs = require('fs');
const path = require('path');
const os = require('os');

const CFG_FILENAME = 'gamestate_integration_lineupoverlay.cfg';
const CS2_RELATIVE_CFG = path.join(
  'steamapps', 'common', 'Counter-Strike Global Offensive', 'game', 'csgo', 'cfg'
);

function steamRootCandidates() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    const candidates = [];
    const pf86 = process.env['ProgramFiles(x86)'];
    const pf = process.env['ProgramFiles'];
    if (pf86) candidates.push(path.join(pf86, 'Steam'));
    if (pf) candidates.push(path.join(pf, 'Steam'));
    candidates.push('C:\\Program Files (x86)\\Steam', 'C:\\Steam');
    return candidates;
  }
  if (process.platform === 'linux') {
    return [
      path.join(home, '.steam', 'steam'),
      path.join(home, '.local', 'share', 'Steam')
    ];
  }
  return []; // macOS: CS2 has no macOS build — the overlay must run on the gaming PC.
}

// libraryfolders.vdf lists every Steam library on the machine. A full VDF
// parser is overkill; the "path" lines are all we need.
function steamLibraries(steamRoot) {
  const vdf = path.join(steamRoot, 'steamapps', 'libraryfolders.vdf');
  const libs = new Set([steamRoot]);
  if (fs.existsSync(vdf)) {
    const text = fs.readFileSync(vdf, 'utf8');
    for (const match of text.matchAll(/"path"\s+"((?:\\.|[^"\\])*)"/g)) {
      libs.add(match[1].replace(/\\\\/g, '\\'));
    }
  }
  return [...libs];
}

function findCs2CfgDir() {
  for (const root of steamRootCandidates()) {
    if (!fs.existsSync(root)) continue;
    for (const lib of steamLibraries(root)) {
      const cfgDir = path.join(lib, CS2_RELATIVE_CFG);
      if (fs.existsSync(cfgDir)) return cfgDir;
    }
  }
  return null;
}

function buildCfg({ port, token }) {
  return `"Lineup Overlay v1"
{
    "uri"        "http://127.0.0.1:${port}"
    "timeout"    "5.0"
    "buffer"     "0.1"
    "throttle"   "0.1"
    "heartbeat"  "10.0"
    "auth"
    {
        "token" "${token}"
    }
    "data"
    {
        "provider"        "1"
        "map"             "1"
        "round"           "1"
        "player_id"       "1"
        "player_state"    "1"
        "player_weapons"  "1"
    }
}
`;
}

function installGsiConfig({ port, token, cfgDir = null }) {
  const dir = cfgDir || process.env.CS2_CFG_DIR || findCs2CfgDir();
  if (!dir) {
    return {
      ok: false,
      path: null,
      message:
        'CS2 cfg folder not found. Pass it explicitly:\n' +
        '  npm run install-gsi -- "<...>\\steamapps\\common\\Counter-Strike Global Offensive\\game\\csgo\\cfg"\n' +
        '(CS2 only runs on Windows/Linux — install on the machine that runs the game.)'
    };
  }
  const target = path.join(dir, CFG_FILENAME);
  try {
    fs.writeFileSync(target, buildCfg({ port, token }));
  } catch (err) {
    return { ok: false, path: target, message: `Could not write cfg: ${err.message}` };
  }
  return {
    ok: true,
    path: target,
    message: `GSI config written to ${target}\nRestart CS2 if it was running.`
  };
}

module.exports = { installGsiConfig, findCs2CfgDir, buildCfg, CFG_FILENAME };

if (require.main === module) {
  const { loadConfig } = require('../config');
  const cfg = loadConfig();
  const result = installGsiConfig({
    port: cfg.port,
    token: cfg.token,
    cfgDir: process.argv[2] || null
  });
  console.log(result.message);
  process.exitCode = result.ok ? 0 : 1;
}
