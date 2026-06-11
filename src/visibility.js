'use strict';
// Auto-show/hide policy (pure, Electron-free, unit-tested).
// With overlay.autoShow enabled, the window appears when a grenade is
// equipped and disappears when it isn't — so the overlay never sits over
// the game while you're rifling. One state suspends auto-hide:
//   - pinned: the player is lining up a throw; never yank the card away
// (Mouse mode is the default state now, so it is NOT an exemption — it no
// longer signals deliberate interaction.) The manual toggle hotkey keeps
// working either way; this only reacts to context changes from GSI.

function visibilityAction(ctx, { visible, pinned, autoShow }) {
  if (!autoShow) return null;
  const equipped = !!(ctx && ctx.equippedGrenade);
  if (equipped && !visible) return 'show';
  if (!equipped && visible && !pinned) return 'hide';
  return null;
}

module.exports = { visibilityAction };
