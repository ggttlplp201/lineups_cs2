'use strict';
const test = require('node:test');
const assert = require('node:assert');

const { findArrow, fitTransform, applyTransform } = require('../src/vision/radar');

// Build an ImageData-shaped object: dark background, optional white rects.
function image(width, height, rects = []) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 30; data[i + 1] = 32; data[i + 2] = 36; data[i + 3] = 255;
  }
  for (const r of rects) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const i = (y * width + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = r.value ?? 255;
      }
    }
  }
  return { width, height, data };
}

test('findArrow locates a single white blob at its centroid', () => {
  const img = image(100, 100, [{ x: 40, y: 60, w: 4, h: 4 }]);
  const hit = findArrow(img);
  assert.ok(hit);
  assert.ok(Math.abs(hit.px - 41.5) < 0.01 && Math.abs(hit.py - 61.5) < 0.01);
});

test('findArrow ignores blobs that are too small or too large', () => {
  const img = image(100, 100, [
    { x: 10, y: 10, w: 1, h: 2 },   // 2px — noise
    { x: 30, y: 30, w: 30, h: 30 }  // 900px — a wall / site label, not the arrow
  ]);
  assert.strictEqual(findArrow(img), null);
});

test('findArrow ignores gray map lines (below white threshold)', () => {
  const img = image(100, 100, [
    { x: 20, y: 20, w: 4, h: 4, value: 180 }, // map wall gray
    { x: 70, y: 70, w: 3, h: 3 }              // the arrow
  ]);
  const hit = findArrow(img);
  assert.ok(hit && hit.px > 60 && hit.py > 60);
});

test('continuity bias: prefers the blob near the last known position', () => {
  const img = image(200, 200, [
    { x: 20, y: 20, w: 5, h: 5 },   // smoke blob (same brightness, even bigger)
    { x: 150, y: 150, w: 3, h: 3 }  // the arrow, where we last saw it
  ]);
  const hit = findArrow(img, { near: { px: 152, py: 152 } });
  assert.ok(hit && hit.px > 140 && hit.py > 140);
});

test('fitTransform recovers a known radar→world mapping', () => {
  // Mirage-like: world_x = 20.4*px - 3230, world_y = -20.4*py + 1713
  const t0 = { ax: 20.4, bx: -3230, ay: -20.4, by: 1713 };
  const pairs = [
    { px: 30, py: 40 }, { px: 180, py: 60 }, { px: 90, py: 200 }
  ].map((p) => ({ ...p, ...{ x: t0.ax * p.px + t0.bx, y: t0.ay * p.py + t0.by } }));
  const t = fitTransform(pairs);
  assert.ok(t);
  const world = applyTransform(t, { px: 120, py: 100 });
  assert.ok(Math.abs(world.x - (t0.ax * 120 + t0.bx)) < 1);
  assert.ok(Math.abs(world.y - (t0.ay * 100 + t0.by)) < 1);
  assert.strictEqual(world.z, null);
});

test('fitTransform refuses degenerate samples', () => {
  assert.strictEqual(fitTransform([{ px: 10, py: 10, x: 0, y: 0 }]), null); // one pair
  assert.strictEqual(
    fitTransform([
      { px: 10, py: 10, x: 0, y: 0 },
      { px: 10.5, py: 200, x: 5, y: -4000 } // no x-axis spread
    ]),
    null
  );
});
