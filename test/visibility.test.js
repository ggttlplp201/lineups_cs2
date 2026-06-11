'use strict';
const test = require('node:test');
const assert = require('node:assert');

const { visibilityAction } = require('../src/visibility');

const ctx = (equippedGrenade) => ({ equippedGrenade });

test('grenade equipped while hidden → show', () => {
  assert.strictEqual(
    visibilityAction(ctx('smoke'), { visible: false, pinned: false, autoShow: true }),
    'show'
  );
});

test('grenade equipped while already visible → no action', () => {
  assert.strictEqual(
    visibilityAction(ctx('smoke'), { visible: true, pinned: false, autoShow: true }),
    null
  );
});

test('no grenade while visible → hide', () => {
  assert.strictEqual(
    visibilityAction(ctx(null), { visible: true, pinned: false, autoShow: true }),
    'hide'
  );
});

test('no grenade while hidden → no action', () => {
  assert.strictEqual(
    visibilityAction(ctx(null), { visible: false, pinned: false, autoShow: true }),
    null
  );
});

test('pinned card is never auto-hidden', () => {
  assert.strictEqual(
    visibilityAction(ctx(null), { visible: true, pinned: true, autoShow: true }),
    null
  );
});

test('autoShow off → never acts', () => {
  assert.strictEqual(
    visibilityAction(ctx('smoke'), { visible: false, pinned: false, autoShow: false }),
    null
  );
  assert.strictEqual(
    visibilityAction(ctx(null), { visible: true, pinned: false, autoShow: false }),
    null
  );
});

test('standing on a spot shows even without a grenade out', () => {
  assert.strictEqual(
    visibilityAction(ctx(null), { visible: false, pinned: false, autoShow: true, onSpot: true }),
    'show'
  );
});

test('leaving the spot with no grenade hides', () => {
  assert.strictEqual(
    visibilityAction(ctx(null), { visible: true, pinned: false, autoShow: true, onSpot: false }),
    'hide'
  );
});

test('switching between grenades stays shown, no flicker', () => {
  // smoke → flash: still a grenade, window already visible → nothing to do
  assert.strictEqual(
    visibilityAction(ctx('flashbang'), { visible: true, pinned: false, autoShow: true }),
    null
  );
});
