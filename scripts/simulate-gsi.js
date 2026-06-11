'use strict';
// Dev tool: pretends to be CS2 posting GSI payloads, so you can develop the
// overlay on a machine without the game (e.g. macOS — CS2 has no Mac build).
//
//   1) npm start          (launches the overlay + listener)
//   2) npm run simulate   (in a second terminal)
//
// Cycles through: menu → warmup on Mirage → live as T with rifle →
// smoke equipped → dead/spectating teammate → back to menu.

const http = require('http');
const path = require('path');
const fs = require('fs');

const config = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8')
);

const ME = '76561198000000001';
const TEAMMATE = '76561198000000002';

const base = (player) => ({
  provider: { name: 'Counter-Strike: Global Offensive', appid: 730, steamid: ME },
  auth: { token: config.token },
  ...(player ? { player } : {})
});

const weapons = (activeName) => ({
  weapon_0: { name: 'weapon_knife', type: 'Knife', state: activeName === 'weapon_knife' ? 'active' : 'holstered' },
  weapon_1: { name: 'weapon_ak47', type: 'Rifle', state: activeName === 'weapon_ak47' ? 'active' : 'holstered' },
  weapon_2: { name: 'weapon_smokegrenade', type: 'Grenade', state: activeName === 'weapon_smokegrenade' ? 'active' : 'holstered', ammo_reserve: 1 },
  weapon_3: { name: 'weapon_flashbang', type: 'Grenade', state: activeName === 'weapon_flashbang' ? 'active' : 'holstered', ammo_reserve: 2 }
});

const STAGES = [
  ['Main menu', base(null)],
  ['Warmup on Mirage', {
    ...base({ steamid: ME, team: 'T', weapons: weapons('weapon_knife') }),
    map: { name: 'de_mirage', phase: 'warmup' }
  }],
  ['Live, rifle out', {
    ...base({ steamid: ME, team: 'T', weapons: weapons('weapon_ak47') }),
    map: { name: 'de_mirage', phase: 'live' },
    round: { phase: 'live' }
  }],
  ['Live, SMOKE equipped → smoke lineups float up', {
    ...base({ steamid: ME, team: 'T', weapons: weapons('weapon_smokegrenade') }),
    map: { name: 'de_mirage', phase: 'live' },
    round: { phase: 'live' }
  }],
  ['Dead, spectating teammate → context freezes, no stale grenade', {
    ...base({ steamid: TEAMMATE, team: 'T', weapons: weapons('weapon_flashbang') }),
    map: { name: 'de_mirage', phase: 'live' },
    round: { phase: 'live' }
  }],
  ['Freezetime next round', {
    ...base({ steamid: ME, team: 'T', weapons: weapons('weapon_knife') }),
    map: { name: 'de_mirage', phase: 'live' },
    round: { phase: 'freezetime' }
  }]
];

let i = 0;
function post([label, payload]) {
  const body = JSON.stringify(payload);
  const req = http.request(
    { host: '127.0.0.1', port: config.port, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
    (res) => console.log(`→ ${label}  (HTTP ${res.statusCode})`)
  );
  req.on('error', (err) => console.error(`Listener not reachable on :${config.port} — is the overlay running? (${err.message})`));
  req.end(body);
}

console.log(`Simulating CS2 GSI against 127.0.0.1:${config.port} — Ctrl+C to stop.`);
post(STAGES[0]);
setInterval(() => { i = (i + 1) % STAGES.length; post(STAGES[i]); }, 5000);
