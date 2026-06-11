(function (global) {
  'use strict';
  // Radar vision core (V2 in-match position). Pure functions, shared by the
  // renderer (script tag) and node:test (require). No Electron, no DOM.
  //
  // The setup this is built for: north-up, full-map radar
  // (cl_radar_rotate 0, cl_radar_always_centered 0, small cl_radar_scale)
  // so the local player's white arrow moves over a static map background.
  // Screen-capture only — same safety model as everything else (spec §2/§8).

  // Find the local player arrow: the strongest connected blob of near-pure-
  // white pixels within plausible size bounds. `image` is ImageData-shaped:
  // { width, height, data: RGBA bytes }. `near` biases toward the last
  // known arrow position (position continuity beats smoke blobs that pop in).
  function findArrow(image, opts = {}) {
    const { width, height, data } = image;
    const minWhite = opts.minWhite ?? 235;
    const minPx = opts.minPx ?? 6;
    const maxPx = opts.maxPx ?? 400;
    const near = opts.near || null;
    const nearWeight = opts.nearWeight ?? 2;

    const mask = new Uint8Array(width * height);
    for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
      if (data[i] >= minWhite && data[i + 1] >= minWhite && data[i + 2] >= minWhite) {
        mask[p] = 1;
      }
    }

    // Connected components, iterative 4-neighbour flood fill.
    const seen = new Uint8Array(width * height);
    const blobs = [];
    const stack = [];
    for (let p = 0; p < mask.length; p++) {
      if (!mask[p] || seen[p]) continue;
      let count = 0;
      let sx = 0;
      let sy = 0;
      stack.length = 0;
      stack.push(p);
      seen[p] = 1;
      while (stack.length) {
        const q = stack.pop();
        const qx = q % width;
        const qy = (q / width) | 0;
        count++;
        sx += qx;
        sy += qy;
        if (qx > 0 && mask[q - 1] && !seen[q - 1]) { seen[q - 1] = 1; stack.push(q - 1); }
        if (qx < width - 1 && mask[q + 1] && !seen[q + 1]) { seen[q + 1] = 1; stack.push(q + 1); }
        if (qy > 0 && mask[q - width] && !seen[q - width]) { seen[q - width] = 1; stack.push(q - width); }
        if (qy < height - 1 && mask[q + width] && !seen[q + width]) { seen[q + width] = 1; stack.push(q + width); }
      }
      if (count >= minPx && count <= maxPx) {
        blobs.push({ px: sx / count, py: sy / count, size: count });
      }
    }
    if (!blobs.length) return null;

    const score = (b) =>
      b.size - (near ? Math.hypot(b.px - near.px, b.py - near.py) * nearWeight : 0);
    blobs.sort((a, b) => score(b) - score(a));
    return blobs[0];
  }

  // Fit world = a * pixel + b independently per axis from paired samples
  // [{ px, py, x, y }] (least squares). North-up radar = no rotation term.
  // Returns null until the pairs have real spread on both axes.
  function fitTransform(pairs, minSpreadPx = 8) {
    if (!Array.isArray(pairs) || pairs.length < 2) return null;
    const fitAxis = (ps, ws) => {
      const n = ps.length;
      const mp = ps.reduce((s, v) => s + v, 0) / n;
      const mw = ws.reduce((s, v) => s + v, 0) / n;
      let num = 0;
      let den = 0;
      for (let i = 0; i < n; i++) {
        num += (ps[i] - mp) * (ws[i] - mw);
        den += (ps[i] - mp) ** 2;
      }
      if (den < minSpreadPx * minSpreadPx) return null; // not enough spread
      const a = num / den;
      return { a, b: mw - a * mp };
    };
    const fx = fitAxis(pairs.map((p) => p.px), pairs.map((p) => p.x));
    const fy = fitAxis(pairs.map((p) => p.py), pairs.map((p) => p.y));
    if (!fx || !fy) return null;
    return { ax: fx.a, bx: fx.b, ay: fy.a, by: fy.b };
  }

  // Arrow pixel → world coordinates. z is unknown from the radar; the
  // proximity engine skips the z check when a fix has no z.
  function applyTransform(t, { px, py }) {
    return { x: t.ax * px + t.bx, y: t.ay * py + t.by, z: null };
  }

  const api = { findArrow, fitTransform, applyTransform };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.RadarVision = api;
})(typeof window !== 'undefined' ? window : globalThis);
