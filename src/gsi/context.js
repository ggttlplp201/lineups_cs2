'use strict';
// Context engine (spec §5.3).
// Consumes raw GSI payloads, emits a normalized GameContext on change:
//   { map, side, phase, equippedGrenade, heldGrenades, isLocalPlayer }
//
// Notes that matter:
// - GSI payloads vary wildly by context (menu vs playing vs spectating a
//   teammate after death). Every field access is defensive.
// - When the local player dies, CS2 starts sending the *observed* player's
//   data in `player`. We detect that via provider.steamid !== player.steamid
//   and freeze side/grenade context instead of letting it go stale-wrong.
// - Position is intentionally absent: GSI does not send it during live play.

const { EventEmitter } = require('events');

const GRENADE_BY_WEAPON = {
  weapon_smokegrenade: 'smoke',
  weapon_flashbang: 'flashbang',
  weapon_molotov: 'molotov',
  weapon_incgrenade: 'incendiary',
  weapon_hegrenade: 'hegrenade',
  weapon_decoy: 'decoy'
};

const EMPTY_CONTEXT = Object.freeze({
  map: null,
  side: null,
  phase: null,
  equippedGrenade: null,
  heldGrenades: [],
  isLocalPlayer: false
});

function normalizePhase(payload) {
  const round = payload.round && payload.round.phase; // freezetime | live | over
  if (round === 'freezetime' || round === 'live' || round === 'over') return round;
  const map = payload.map && payload.map.phase; // warmup | live | intermission | gameover
  if (map === 'warmup') return 'warmup';
  if (map === 'live') return 'live';
  if (map === 'intermission' || map === 'gameover') return 'over';
  return null;
}

function weaponsOf(payload) {
  const w = payload.player && payload.player.weapons;
  if (!w || typeof w !== 'object') return [];
  return Object.values(w).filter(Boolean);
}

function deriveContext(payload, previous) {
  const prev = previous || EMPTY_CONTEXT;
  if (!payload || typeof payload !== 'object') return prev;

  const map = (payload.map && payload.map.name) || null;
  const phase = normalizePhase(payload);

  const providerSid = payload.provider && payload.provider.steamid;
  const playerSid = payload.player && payload.player.steamid;
  const hasPlayer = !!payload.player;
  // If both steamids are present and differ, we're looking at an observed
  // player (death cam / spectate), not ourselves.
  const isLocalPlayer =
    hasPlayer && (!providerSid || !playerSid || providerSid === playerSid);

  let side = prev.side;
  let equippedGrenade = null;
  let heldGrenades = prev.heldGrenades;

  if (isLocalPlayer) {
    const team = payload.player.team;
    side = team === 'CT' || team === 'T' ? team : null;

    const weapons = weaponsOf(payload);
    heldGrenades = [
      ...new Set(
        weapons
          .filter((w) => w.type === 'Grenade')
          .map((w) => GRENADE_BY_WEAPON[w.name])
          .filter(Boolean)
      )
    ];
    const active = weapons.find((w) => w.state === 'active');
    equippedGrenade =
      active && active.type === 'Grenade'
        ? GRENADE_BY_WEAPON[active.name] || null
        : null;
  }
  // Not local (dead, spectating a teammate): keep last-known side and held
  // grenades for the round, but never claim a grenade is equipped.

  if (!map) {
    // Main menu: nothing is true anymore.
    return { ...EMPTY_CONTEXT };
  }

  return { map, side, phase, equippedGrenade, heldGrenades, isLocalPlayer };
}

class ContextEngine extends EventEmitter {
  constructor() {
    super();
    this.context = { ...EMPTY_CONTEXT };
  }

  update(payload) {
    const next = deriveContext(payload, this.context);
    if (JSON.stringify(next) !== JSON.stringify(this.context)) {
      this.context = next;
      this.emit('context', next);
    }
    return this.context;
  }
}

module.exports = { ContextEngine, deriveContext, GRENADE_BY_WEAPON, EMPTY_CONTEXT };
