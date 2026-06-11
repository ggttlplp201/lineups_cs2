'use strict';
// Dev tool: feeds fake position fixes to the overlay's /position endpoint,
// exactly as the future cl_showpos OCR layer will. Two modes:
//
//   node scripts/simulate-position.js <x> <y> [z]   — post one fix and exit
//   node scripts/simulate-position.js               — walk a path: approach,
//     stand on, jitter around, and leave every spot found in lineups/*.json
//
// If no lineup has a `spot` yet, capture some first (select a lineup, stand
// there, Alt+S) or pass coordinates explicitly.

const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));

function post(pos, label) {
  const body = JSON.stringify({ auth: { token: config.token }, position: pos });
  const req = http.request(
    {
      host: '127.0.0.1',
      port: config.port,
      path: '/position',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    },
    (res) => console.log(`→ ${label}  (${pos.x} ${pos.y} ${pos.z ?? ''})  HTTP ${res.statusCode}`)
  );
  req.on('error', (err) =>
    console.error(`Listener not reachable on :${config.port} — is the overlay running? (${err.message})`)
  );
  req.end(body);
}

function collectSpots() {
  const dir = path.join(ROOT, 'lineups');
  const spots = [];
  if (!fs.existsSync(dir)) return spots;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      for (const lu of doc.lineups || []) {
        if (lu.spot && typeof lu.spot.x === 'number') spots.push({ id: lu.id, ...lu.spot });
      }
    } catch { /* skip unreadable file */ }
  }
  return spots;
}

const [x, y, z] = process.argv.slice(2).map(Number);
if (Number.isFinite(x) && Number.isFinite(y)) {
  post({ x, y, z: Number.isFinite(z) ? z : 0 }, 'one-shot fix');
  return;
}

const spots = collectSpots();
if (!spots.length) {
  console.error(
    'No lineup has a `spot` recorded yet. Either capture one (select a lineup,\n' +
    'stand on the position, press Alt+S) or post a fix directly:\n' +
    '  node scripts/simulate-position.js -1080 240 -160'
  );
  process.exitCode = 1;
  return;
}

console.log(`Walking ${spots.length} spot(s) — Ctrl+C to stop.`);
const steps = [];
for (const s of spots) {
  steps.push([`far from ${s.id}`, { x: s.x + 800, y: s.y + 800, z: s.z ?? 0 }]);
  steps.push([`approaching ${s.id}`, { x: s.x + 200, y: s.y, z: s.z ?? 0 }]);
  steps.push([`ON ${s.id}`, { x: s.x + 10, y: s.y - 5, z: (s.z ?? 0) + 8 }]);
  steps.push([`jitter on ${s.id}`, { x: s.x - 12, y: s.y + 14, z: (s.z ?? 0) - 6 }]);
  steps.push([`leaving ${s.id}`, { x: s.x + 400, y: s.y - 300, z: s.z ?? 0 }]);
}

let i = 0;
post(steps[0][1], steps[0][0]);
setInterval(() => {
  i = (i + 1) % steps.length;
  post(steps[i][1], steps[i][0]);
}, 2000);
