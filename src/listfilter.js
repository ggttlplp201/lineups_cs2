(function (global) {
  'use strict';
  // V2 list proximity filter. Once lineups carry spot coordinates and a
  // recent position fix exists, lineups whose spot is beyond listRadius
  // drop out of the side list — the list becomes "what can I throw from
  // here". Two deliberate exceptions:
  //   - lineups WITHOUT a spot always stay (not captured yet → can't judge)
  //   - the All toggle bypasses this filter entirely (handled by the caller)
  // Shared by the renderer (script tag) and node:test (require).

  function filterByProximity(lineups, fix, { listRadius = 500 } = {}) {
    if (!fix || !Number.isFinite(fix.x) || !Number.isFinite(fix.y)) {
      return lineups.slice();
    }
    return lineups.filter(
      (lu) =>
        !lu.spot ||
        typeof lu.spot.x !== 'number' ||
        Math.hypot(fix.x - lu.spot.x, fix.y - lu.spot.y) <= listRadius
    );
  }

  const api = { filterByProximity };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.ListFilter = api;
})(typeof window !== 'undefined' ? window : globalThis);
