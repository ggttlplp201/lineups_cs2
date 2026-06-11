'use strict';
// V2 proximity engine (spec §7, Version 2). Pure logic — no Electron, no
// OCR. It consumes position fixes from any source (dev simulator today,
// screen-OCR of cl_showpos later) and decides which lineup spot the player
// is standing on.
//
// Matching rules:
// - distance is 2D (X/Y). Z gets a separate, generous tolerance — ramps,
//   stairs and OCR noise make exact heights unreliable (spec review note c).
// - hysteresis: entering a spot requires distance <= radius; leaving
//   requires distance > radius * exitFactor. Jitter at the boundary can't
//   flicker the selection on and off.
// - if a different spot is closer and within entry radius, it wins even
//   while another spot is still inside its exit radius (spots can sit
//   close together, e.g. the two trash-can window smokes).

class ProximityEngine {
  constructor({ spots = [], radius = 120, zTolerance = 200, exitFactor = 1.4 } = {}) {
    this.radius = radius;
    this.zTolerance = zTolerance;
    this.exitFactor = exitFactor;
    this.current = null;
    this.setSpots(spots);
  }

  // spots: [{ id, x, y, z }] — z optional
  setSpots(spots) {
    this.spots = (spots || []).filter(
      (s) => s && typeof s.x === 'number' && typeof s.y === 'number'
    );
    if (this.current && !this.spots.some((s) => s.id === this.current)) {
      this.current = null;
    }
  }

  _distance(pos, spot, maxRadius) {
    const d = Math.hypot(pos.x - spot.x, pos.y - spot.y);
    if (d > maxRadius) return Infinity;
    if (typeof spot.z === 'number' && typeof pos.z === 'number' &&
        Math.abs(pos.z - spot.z) > this.zTolerance) return Infinity;
    return d;
  }

  // Feed one position fix; returns the spot id the player is on (or null).
  update(pos) {
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) {
      return this.current;
    }

    let best = null;
    let bestD = Infinity;
    for (const s of this.spots) {
      const d = this._distance(pos, s, this.radius);
      if (d < bestD) { best = s; bestD = d; }
    }

    if (best) {
      this.current = best.id;
      return this.current;
    }

    // Nothing within entry radius — keep the current lock only while still
    // inside its exit radius.
    if (this.current) {
      const locked = this.spots.find((s) => s.id === this.current);
      if (!locked || this._distance(pos, locked, this.radius * this.exitFactor) === Infinity) {
        this.current = null;
      }
    }
    return this.current;
  }
}

module.exports = { ProximityEngine };
