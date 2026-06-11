'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveContext, ContextEngine, EMPTY_CONTEXT } = require('../src/gsi/context');
const { buildCfg } = require('../src/gsi/install-config');

const ME = '76561198000000001';
const OTHER = '76561198000000002';

const playing = (active, team = 'T') => ({
  provider: { steamid: ME },
  map: { name: 'de_mirage', phase: 'live' },
  round: { phase: 'live' },
  player: {
    steamid: ME,
    team,
    weapons: {
      weapon_0: { name: 'weapon_knife', type: 'Knife', state: active === 'weapon_knife' ? 'active' : 'holstered' },
      weapon_1: { name: 'weapon_smokegrenade', type: 'Grenade', state: active === 'weapon_smokegrenade' ? 'active' : 'holstered' },
      weapon_2: { name: 'weapon_molotov', type: 'Grenade', state: active === 'weapon_molotov' ? 'active' : 'holstered' }
    }
  }
});

test('smoke equipped → equippedGrenade=smoke, side, map, phase all derived', () => {
  const ctx = deriveContext(playing('weapon_smokegrenade'), EMPTY_CONTEXT);
  assert.equal(ctx.map, 'de_mirage');
  assert.equal(ctx.side, 'T');
  assert.equal(ctx.phase, 'live');
  assert.equal(ctx.equippedGrenade, 'smoke');
  assert.deepEqual([...ctx.heldGrenades].sort(), ['molotov', 'smoke']);
  assert.equal(ctx.isLocalPlayer, true);
});

test('knife out → no grenade equipped but heldGrenades still listed', () => {
  const ctx = deriveContext(playing('weapon_knife'), EMPTY_CONTEXT);
  assert.equal(ctx.equippedGrenade, null);
  assert.deepEqual([...ctx.heldGrenades].sort(), ['molotov', 'smoke']);
});

test('molotov maps to molotov, incendiary to incendiary', () => {
  assert.equal(deriveContext(playing('weapon_molotov'), EMPTY_CONTEXT).equippedGrenade, 'molotov');
  const p = playing('weapon_incgrenade');
  p.player.weapons.weapon_2 = { name: 'weapon_incgrenade', type: 'Grenade', state: 'active' };
  assert.equal(deriveContext(p, EMPTY_CONTEXT).equippedGrenade, 'incendiary');
});

test('dead + spectating teammate: side sticks, grenade never goes stale-wrong', () => {
  const engine = new ContextEngine();
  engine.update(playing('weapon_smokegrenade', 'CT'));
  const observed = playing('weapon_molotov', 'T');
  observed.player.steamid = OTHER; // observed player, not us
  const ctx = engine.update(observed);
  assert.equal(ctx.isLocalPlayer, false);
  assert.equal(ctx.side, 'CT', 'keeps last-known own side');
  assert.equal(ctx.equippedGrenade, null, 'never claims observed grenade is ours');
});

test('main menu (no map) → empty context', () => {
  const engine = new ContextEngine();
  engine.update(playing('weapon_smokegrenade'));
  const ctx = engine.update({ provider: { steamid: ME } });
  assert.equal(ctx.map, null);
  assert.equal(ctx.side, null);
  assert.equal(ctx.equippedGrenade, null);
});

test('warmup phase falls back to map.phase', () => {
  const p = playing('weapon_knife');
  delete p.round;
  p.map.phase = 'warmup';
  assert.equal(deriveContext(p, EMPTY_CONTEXT).phase, 'warmup');
});

test('context engine only emits on change', () => {
  const engine = new ContextEngine();
  let emits = 0;
  engine.on('context', () => emits++);
  engine.update(playing('weapon_smokegrenade'));
  engine.update(playing('weapon_smokegrenade'));
  engine.update(playing('weapon_knife'));
  assert.equal(emits, 2);
});

test('malformed payloads never throw', () => {
  const engine = new ContextEngine();
  for (const junk of [null, {}, { player: {} }, { player: { weapons: 'nope' } }, { map: {} }]) {
    assert.doesNotThrow(() => engine.update(junk));
  }
});

test('GSI cfg subscribes only to live-play components, with throttle/buffer/heartbeat', () => {
  const cfg = buildCfg({ port: 47474, token: 'abc123' });
  for (const key of ['provider', 'map', 'round', 'player_id', 'player_state', 'player_weapons', 'throttle', 'buffer', 'heartbeat']) {
    assert.match(cfg, new RegExp(`"${key}"`), `missing ${key}`);
  }
  assert.doesNotMatch(cfg, /player_position|allplayers/, 'must not subscribe to spectator-only components');
  assert.match(cfg, /127\.0\.0\.1:47474/);
  assert.match(cfg, /"token" "abc123"/);
});
