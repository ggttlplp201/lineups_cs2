'use strict';
/* Renderer. All game state arrives over the preload bridge; this file only
   filters, sorts, and draws. No network, no Node APIs. */

const state = {
  maps: {},          // { de_mirage: [Lineup, ...] }
  hotkeys: {},
  ctx: { map: null, side: null, phase: null, equippedGrenade: null, heldGrenades: [] },
  connected: false,
  gsiError: null,    // last listener error (e.g. port in use), if any
  gsiInstall: null,  // { ok, message, path } result of the GSI cfg install attempt
  showAll: false,    // true = ignore grenade/side filter, browse everything for the map
  selectedId: null,
  pinned: false,
  visible: []        // current list order (post filter/sort)
};

const $ = (id) => document.getElementById(id);

/* ---------- inline icons (kept tiny; stroke inherits currentColor) ---------- */
const ICONS = {
  smoke: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="14" r="4.5"/><circle cx="15" cy="11" r="3.5"/><circle cx="14" cy="16.5" r="2.5"/></svg>',
  flashbang: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M13 3 6 13h5l-1 8 8-11h-5l1-7z"/></svg>',
  molotov: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 21c-3.5 0-6-2.4-6-5.5C6 11 12 3.5 12 3.5S18 11 18 15.5c0 3.1-2.5 5.5-6 5.5z"/></svg>',
  incendiary: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 21c-3.5 0-6-2.4-6-5.5C6 11 12 3.5 12 3.5S18 11 18 15.5c0 3.1-2.5 5.5-6 5.5z"/></svg>',
  hegrenade: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="13" r="6"/><path d="M10 7V5h4"/></svg>',
  decoy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="13" r="6" stroke-dasharray="3 3"/></svg>',
  mouseLeft: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="7" y="3" width="10" height="18" rx="5"/><path d="M12 3v7M7 10h5" /><path d="M7 8a5 5 0 0 1 5-5v7H7V8z" fill="currentColor" stroke="none"/></svg>',
  mouseRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="7" y="3" width="10" height="18" rx="5"/><path d="M12 3v7M12 10h5"/><path d="M17 8a5 5 0 0 0-5-5v7h5V8z" fill="currentColor" stroke="none"/></svg>',
  mouseBoth: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="7" y="3" width="10" height="18" rx="5"/><path d="M12 3v7"/><path d="M7 8a5 5 0 0 1 10 0v2H7V8z" fill="currentColor" stroke="none"/></svg>',
  jump: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 19V6M7 11l5-5 5 5"/></svg>',
  crouch: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 5v13M7 13l5 5 5-5"/></svg>',
  walk: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M13 5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM10 21l2-6 3 3v3M9 12l2-4 3 1 2 3"/></svg>',
  strafeLeft: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>',
  strafeRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'
};

const GRENADE_LABEL = {
  smoke: 'Smoke', flashbang: 'Flash', molotov: 'Molotov',
  incendiary: 'Incendiary', hegrenade: 'HE', decoy: 'Decoy'
};

/* ---------- filtering & sorting ---------- */
function lineupsForContext() {
  // No map yet → let the user browse the first bundled map so the overlay
  // is useful (and testable) outside a match.
  const mapName = state.ctx.map && state.maps[state.ctx.map]
    ? state.ctx.map
    : Object.keys(state.maps)[0] || null;
  if (!mapName) return { mapName: null, list: [] };

  const all = state.maps[mapName];
  const { equippedGrenade, side } = state.ctx;

  const matches = (lu) => {
    if (state.showAll) return true;
    const sideOk = !side || lu.side === 'both' || lu.side === side;
    const nadeOk = !equippedGrenade || lu.grenade === equippedGrenade;
    return sideOk && nadeOk;
  };

  // Context matches float to the top; non-matches stay browsable but dimmed.
  const sorted = [...all].sort((a, b) => Number(matches(b)) - Number(matches(a)));
  return { mapName, list: sorted, matches };
}

/* ---------- rendering ---------- */
function render() {
  renderHeader();
  const { mapName, list, matches } = lineupsForContext();
  state.visible = list;
  renderList(mapName, list, matches);
  renderDetail();
  document.body.classList.toggle('pinned', state.pinned);
  window.overlay.setPin(state.pinned); // keep main's auto-hide logic in sync
}

function renderHeader() {
  $('status-dot').classList.toggle('on', state.connected);
  $('status-text').textContent = state.connected
    ? 'Receiving game data ✓'
    : 'Not connected — start CS2 (fullscreen windowed)';

  // While no data flows, say exactly what the GSI installer did — the #1
  // failure mode is the cfg not being where CS2 reads it, the #2 is CS2
  // having been running when the cfg was first written.
  const hint = $('gsi-hint');
  if (state.connected || !state.gsiInstall) {
    hint.hidden = true;
  } else if (state.gsiError) {
    hint.hidden = false;
    hint.textContent = `Listener problem: ${state.gsiError}`;
  } else if (state.gsiInstall.ok === false) {
    hint.hidden = false;
    hint.textContent =
      'GSI config NOT installed — CS2 cfg folder not found. Run: npm run install-gsi -- "<your...>\\csgo\\cfg" then restart CS2.';
  } else {
    hint.hidden = false;
    hint.textContent =
      `GSI config written to: ${state.gsiInstall.path || '(unknown path)'} — ` +
      'restart CS2 fully (it only reads this at startup). If that path is not the Steam library CS2 actually runs from, ' +
      'run: npm run install-gsi -- "<correct>\\csgo\\cfg"';
  }

  const { map, side, equippedGrenade } = state.ctx;
  document.body.dataset.side = side || 'none';
  const bits = [];
  if (map) bits.push(`<b>${esc(map)}</b>`);
  if (side) bits.push(esc(side));
  if (equippedGrenade) bits.push(`<span class="grenade">${esc(GRENADE_LABEL[equippedGrenade] || equippedGrenade)} out</span>`);
  $('context-strip').innerHTML = bits.length
    ? bits.join('<span class="sep">·</span>')
    : 'No map detected — browsing offline';
}

function renderList(mapName, list, matches) {
  const ul = $('lineup-list');
  ul.replaceChildren();
  $('list-title').textContent = mapName ? `Lineups — ${prettyMap(mapName)}` : 'Lineups';
  $('filter-toggle').classList.toggle('active', state.showAll);

  const emptyEl = $('list-empty');
  if (!list.length) {
    emptyEl.hidden = false;
    emptyEl.textContent = mapName
      ? 'No lineups in the library for this context yet.'
      : 'No lineup files found. Add lineups/<map>.json to get started.';
    return;
  }
  emptyEl.hidden = true;

  if (!state.selectedId || !list.some((l) => l.id === state.selectedId)) {
    state.selectedId = list[0].id;
  }

  for (const lu of list) {
    const li = document.createElement('li');
    li.classList.toggle('selected', lu.id === state.selectedId);
    if (matches && !matches(lu)) li.classList.add('dimmed');
    li.innerHTML = `
      <span class="nade">${ICONS[lu.grenade] || ICONS.smoke}</span>
      <span class="meta">
        <span class="name">${esc(lu.name)}</span>
        <span class="sub">${esc(lu.target || '')}</span>
      </span>
      <span class="pips" title="difficulty">${difficultyPips(lu.difficulty)}</span>`;
    li.addEventListener('click', () => { state.selectedId = lu.id; state.pinned = false; render(); });
    ul.appendChild(li);
  }
  const sel = ul.querySelector('li.selected');
  if (sel) sel.scrollIntoView({ block: 'nearest' }); // hotkey browsing keeps the row visible
}

function difficultyPips(diff) {
  const n = { easy: 1, medium: 2, hard: 3 }[diff] || 1;
  return [1, 2, 3].map((i) => `<span class="pip${i <= n ? ' full' : ''}"></span>`).join('');
}

function renderDetail() {
  const panel = $('detail-panel');
  const lu = state.visible.find((l) => l.id === state.selectedId);
  if (!lu) { panel.hidden = true; return; }
  panel.hidden = false;
  if (renderDetail._lastId !== lu.id) { panel.scrollTop = 0; renderDetail._lastId = lu.id; }

  $('detail-name').textContent = lu.name;
  $('detail-target').textContent = lu.target || '';
  $('detail-difficulty').textContent = lu.difficulty || 'easy';
  $('detail-unverified').hidden = lu.verified !== false;
  $('detail-pin').hidden = !state.pinned;

  renderShot('stand-shot', lu.stand);
  $('stand-text').textContent = (lu.stand && lu.stand.text) || '';
  renderShot('aim-shot', lu.aim);
  $('aim-text').textContent = (lu.aim && lu.aim.text) || '';

  renderThrowLine(lu);
}

function renderShot(id, part) {
  const el = $(id);
  el.replaceChildren();
  el.classList.remove('pending');
  if (part && part.image) {
    const img = document.createElement('img');
    img.src = part.image;
    img.alt = '';
    img.addEventListener('error', () => pending(el));
    el.appendChild(img);
  } else {
    pending(el);
  }
  function pending(node) {
    node.replaceChildren();
    node.classList.add('pending');
    node.textContent = 'Screenshot pending — capture in a practice server';
  }
}

/* The throw line: every movement/release element as one left-to-right strip.
   Strafe gets the loudest treatment (spec §6 rule). */
function renderThrowLine(lu) {
  const line = $('throw-line');
  line.replaceChildren();
  const mv = lu.movement || {};
  const chips = [];

  if (mv.walk) chips.push(chip(ICONS.walk, 'Walk', ''));
  if (mv.strafe === 'left') chips.push(chip(ICONS.strafeLeft, 'Strafe left', 'strafe'));
  if (mv.strafe === 'right') chips.push(chip(ICONS.strafeRight, 'Strafe right', 'strafe'));
  if (mv.jump && lu.throw !== 'jumpthrow') chips.push(chip(ICONS.jump, 'Jump', 'primary'));
  if (mv.crouch) chips.push(chip(ICONS.crouch, 'Crouch', 'primary'));

  const release = {
    left: [ICONS.mouseLeft, 'Left click'],
    right: [ICONS.mouseRight, 'Right click'],
    both: [ICONS.mouseBoth, 'Left + Right'],
    jumpthrow: [ICONS.jump, 'Jumpthrow']
  }[lu.throw] || [ICONS.mouseLeft, 'Left click'];
  chips.push(chip(release[0], release[1], 'primary'));

  for (const c of chips) line.appendChild(c);

  function chip(icon, label, cls) {
    const div = document.createElement('div');
    div.className = `throw-chip${cls ? ' ' + cls : ''}`;
    div.innerHTML = `${icon}<span>${esc(label)}</span>`;
    return div;
  }
}

/* ---------- commands from global hotkeys ---------- */
function move(delta) {
  if (!state.visible.length) return;
  const i = state.visible.findIndex((l) => l.id === state.selectedId);
  const next = (i + delta + state.visible.length) % state.visible.length;
  state.selectedId = state.visible[next].id;
  state.pinned = false;
  render();
}

/* ---------- helpers ---------- */
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function prettyMap(name) {
  return name.replace(/^de_/, '').replace(/^\w/, (c) => c.toUpperCase());
}

/* ---------- wiring ---------- */
window.overlay.onInit(({ lineups, hotkeys, gsiInstall }) => {
  state.maps = lineups;
  state.hotkeys = hotkeys;
  state.gsiInstall = gsiInstall || null;
  $('keys').innerHTML = [
    [hotkeys.toggle, 'show / hide'],
    [`${hotkeys.prev} · ${hotkeys.next}`, 'browse'],
    [hotkeys.pin, 'pin card'],
    [hotkeys.mouse, 'mouse mode']
  ].map(([key, label]) =>
    `<span class="key-row"><kbd>${esc(key)}</kbd><span>${esc(label)}</span></span>`
  ).join('');
  render();
});

window.overlay.onContext((ctx) => { state.ctx = ctx; render(); });
window.overlay.onGsiStatus((s) => {
  state.connected = !!s.connected;
  state.gsiError = s.error || null;
  renderHeader();
});
window.overlay.onMouseMode((interactive) => { $('mouse-hint').hidden = !interactive; });
window.overlay.onCommand((cmd) => {
  if (cmd === 'next') move(1);
  else if (cmd === 'prev') move(-1);
  else if (cmd === 'pin') { state.pinned = !state.pinned; render(); }
});

$('filter-toggle').addEventListener('click', () => { state.showAll = !state.showAll; render(); });

window.overlay.ready();
