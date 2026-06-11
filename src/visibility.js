'use strict';
// Auto-show/hide policy (pure, Electron-free, unit-tested).
// With overlay.autoShow enabled, the window appears when a grenade is
// equipped and disappears when it isn't — so the overlay never sits over
// the game while you're rifling. One state suspends auto-hide:
//   - pinned: the player is lining up a throw; never yank the card away
// (Mouse mode is the default state now, so it is NOT an exemption — it no
// longer signals deliberate interaction.) The manual toggle hotkey keeps
// working either way; this only reacts to context changes from GSI.

function visibilityAction(ctx, { visible, pinned, autoShow, onSpot = false }) {
  if (!autoShow) return null;
  // V2: standing on a known lineup spot is a show condition just like
  // having a grenade out — walking onto the spot surfaces the card.
  const wanted = !!(ctx && ctx.equippedGrenade) || !!onSpot;
  if (wanted && !visible) return 'show';
  if (!wanted && visible && !pinned) return 'hide';
  return null;
}

module.exports = { visibilityAction };
