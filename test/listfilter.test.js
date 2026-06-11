'use strict';
const test = require('node:test');
const assert = require('node:assert');

const { filterByProximity } = require('../src/listfilter');

const LINEUPS = [
  { id: 'near', spot: { x: 100, y: 100, z: 0 } },
  { id: 'far', spot: { x: 5000, y: 5000, z: 0 } },
  { id: 'uncaptured' } // no spot yet — must always stay
];

test('no position fix → everything stays', () => {
  assert.strictEqual(filterByProximity(LINEUPS, null).length, 3);
});

test('far spots drop, near spots and uncaptured stay', () => {
  const out = filterByProximity(LINEUPS, { x: 120, y: 80 }, { listRadius: 500 });
  assert.deepStrictEqual(out.map((l) => l.id), ['near', 'uncaptured']);
});

test('radius boundary is inclusive', () => {
  const out = filterByProximity(
    [{ id: 'edge', spot: { x: 500, y: 0 } }],
    { x: 0, y: 0 },
    { listRadius: 500 }
  );
  assert.strictEqual(out.length, 1);
});

test('garbage fix coordinates → everything stays', () => {
  assert.strictEqual(filterByProximity(LINEUPS, { x: NaN, y: 0 }).length, 3);
});
