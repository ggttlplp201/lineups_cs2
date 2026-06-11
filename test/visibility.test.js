'use strict';
const test = require('node:test');
const assert = require('node:assert');

const { visibilityAction } = require('../src/visibility');

const ctx = (equippedGrenade) => ({ equippedGrenade });

test('grenade equipped while hidden → show', () => {
  assert.strictEqual(
    visibilityAction(ctx('smoke'), { visible: false, pinned: false, mouseMode: false, autoShow: true }),
    'show'
  );
});

test('grenade equipped while already visible → no action', () => {
  assert.strictEqual(
    visibilityAction(ctx('smoke'), { visible: true, pinned: false, mouseMode: false, autoShow: true }),
    null
  );
});

test('no grenade while visible → hide', () => {
  assert.strictEqual(
    visibilityAction(ctx(null), { visible: true, pinned: false, mouseMode: false, autoShow: true }),
    'hide'
  );
});

test('no grenade while hidden → no action', () => {
  assert.strictEqual(
    visibilityAction(ctx(null), { visible: false, pinned: false, mouseMode: false, autoShow: true }),
    null
  );
});

test('pinned card is never auto-hidden', () => {
  assert.strictEqual(
    visibilityAction(ctx(null), { visible: true, pinned: true, mouseMode: false, autoShow: true }),
    null
  );
});

test('mouse mode is never auto-hidden', () => {
  assert.strictEqual(
    visibilityAction(ctx(null), { visible: true, pinned: false, mouseMode: true, autoShow: true }),
    null
  );
});

test('autoShow off → never acts', () => {
  assert.strictEqual(
    visibilityAction(ctx('smoke'), { visible: false, pinned: false, mouseMode: false, autoShow: false }),
    null
  );
  assert.strictEqual(
    visibilityAction(ctx(null), { visible: true, pinned: false, mouseMode: false, autoShow: false }),
    null
  );
});

test('switching between grenades stays shown, no flicker', () => {
  // smoke → flash: still a grenade, window already visible → nothing to do
  assert.strictEqual(
    visibilityAction(ctx('flashbang'), { visible: true, pinned: false, mouseMode: false, autoShow: true }),
    null
  );
});
