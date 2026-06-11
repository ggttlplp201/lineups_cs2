'use strict';
const test = require('node:test');
const assert = require('node:assert');

const { ProximityEngine } = require('../src/proximity');

const SPOTS = [
  { id: 'a', x: 0, y: 0, z: 0 },
  { id: 'b', x: 1000, y: 0, z: 0 }
];

const engine = (overrides = {}) =>
  new ProximityEngine({ spots: SPOTS, radius: 120, zTolerance: 200, exitFactor: 1.4, ...overrides });

test('no spots → never matches', () => {
  const e = engine({ spots: [] });
  assert.strictEqual(e.update({ x: 0, y: 0, z: 0 }), null);
});

test('outside entry radius → null, inside → locked', () => {
  const e = engine();
  assert.strictEqual(e.update({ x: 500, y: 500, z: 0 }), null);
  assert.strictEqual(e.update({ x: 50, y: 50, z: 0 }), 'a');
});

test('right x/y but wrong floor (z beyond tolerance) → no match', () => {
  const e = engine();
  assert.strictEqual(e.update({ x: 0, y: 0, z: 500 }), null);
});

test('hysteresis: stays locked inside exit radius, releases beyond it', () => {
  const e = engine();
  assert.strictEqual(e.update({ x: 100, y: 0, z: 0 }), 'a');   // inside entry (120)
  assert.strictEqual(e.update({ x: 150, y: 0, z: 0 }), 'a');   // outside entry, inside exit (168)
  assert.strictEqual(e.update({ x: 200, y: 0, z: 0 }), null);  // beyond exit → released
});

test('a closer spot within entry radius steals the lock', () => {
  const e = engine({ spots: [{ id: 'a', x: 0, y: 0, z: 0 }, { id: 'b', x: 250, y: 0, z: 0 }] });
  assert.strictEqual(e.update({ x: 60, y: 0, z: 0 }), 'a');
  assert.strictEqual(e.update({ x: 180, y: 0, z: 0 }), 'b'); // 70 from b, within entry; a only in exit range
});

test('garbage positions are ignored, lock survives', () => {
  const e = engine();
  assert.strictEqual(e.update({ x: 10, y: 0, z: 0 }), 'a');
  assert.strictEqual(e.update(null), 'a');
  assert.strictEqual(e.update({ x: NaN, y: 0, z: 0 }), 'a');
});

test('setSpots drops a stale lock', () => {
  const e = engine();
  assert.strictEqual(e.update({ x: 0, y: 0, z: 0 }), 'a');
  e.setSpots([{ id: 'b', x: 1000, y: 0, z: 0 }]);
  assert.strictEqual(e.current, null);
});

test('spots without z match regardless of player z', () => {
  const e = engine({ spots: [{ id: 'flat', x: 0, y: 0 }] });
  assert.strictEqual(e.update({ x: 10, y: 10, z: 9999 }), 'flat');
});
