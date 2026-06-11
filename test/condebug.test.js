'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { ConsoleLogWatcher, parsePositions } = require('../src/position/condebug');

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await delay(20);
  }
}

test('parsePositions extracts setpos and setpos_exact lines', () => {
  const text = [
    'random console noise',
    'setpos -1080.504883 240.213409 -160.031250;setang 1.23 -45.67 0.00',
    'setpos_exact 100 -200.5 64;setang 0 0 0',
    'setposition is not a real command 1 2 3'
  ].join('\n');
  assert.deepStrictEqual(parsePositions(text), [
    { x: -1080.504883, y: 240.213409, z: -160.03125 },
    { x: 100, y: -200.5, z: 64 }
  ]);
});

test('parsePositions ignores garbage', () => {
  assert.deepStrictEqual(parsePositions('setpos one two three\nsetpos 1 2'), []);
});

test('watcher emits appended fixes and never replays history', async () => {
  const file = path.join(os.tmpdir(), `condebug-test-${process.pid}-${Math.random().toString(36).slice(2)}.log`);
  fs.writeFileSync(file, 'setpos 1 2 3;setang 0 0 0\n'); // history — must NOT be emitted
  const w = new ConsoleLogWatcher({ logPath: file, intervalMs: 20 });
  const got = [];
  w.on('position', (p) => got.push(p));
  w.start();
  try {
    await delay(80); // watcher takes its initial EOF offset
    fs.appendFileSync(file, 'noise\nsetpos -100.5 200.25 -64.0;setang 0 0 0\n');
    await waitFor(() => got.length >= 1);
    assert.deepStrictEqual(got, [{ x: -100.5, y: 200.25, z: -64 }]);
  } finally {
    w.stop();
    fs.unlinkSync(file);
  }
});

test('watcher survives truncation (conclearlog / new session)', async () => {
  const file = path.join(os.tmpdir(), `condebug-trunc-${process.pid}-${Math.random().toString(36).slice(2)}.log`);
  fs.writeFileSync(file, 'old session line\n'.repeat(10));
  const w = new ConsoleLogWatcher({ logPath: file, intervalMs: 20 });
  const got = [];
  w.on('position', (p) => got.push(p));
  w.start();
  try {
    await delay(80);
    fs.writeFileSync(file, ''); // truncated: new session
    await delay(80);
    fs.appendFileSync(file, 'setpos 7 8 9;setang 0 0 0\n');
    await waitFor(() => got.length >= 1);
    assert.deepStrictEqual(got, [{ x: 7, y: 8, z: 9 }]);
  } finally {
    w.stop();
    fs.unlinkSync(file);
  }
});
