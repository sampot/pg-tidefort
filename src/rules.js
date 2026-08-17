import {
  ROCK,
  WATER,
  BRITTLE,
  OPEN,
  HELD,
  TRAIL,
  SHRINE_ABILITY,
  isFloor,
  isShrine,
  keeperCanEnter,
} from "./tiles.js";

export const DIRS = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

export function inBounds(state, x, y) {
  return x >= 0 && y >= 0 && x < state.width && y < state.height;
}

export function terrainAt(state, x, y) {
  if (!inBounds(state, x, y)) return ROCK;
  return state.terrain[y * state.width + x];
}

export function ownerAt(state, x, y) {
  if (!inBounds(state, x, y)) return OPEN;
  return state.owner[y * state.width + x];
}

export function setTerrain(state, x, y, tile) {
  if (inBounds(state, x, y)) state.terrain[y * state.width + x] = tile;
}

export function setOwner(state, x, y, value) {
  if (inBounds(state, x, y)) state.owner[y * state.width + x] = value;
}

/** Random in [0,1) driven by the state seed so a run replays identically. */
export function random(state) {
  state.rngSeed = (Math.imul(state.rngSeed, 1664525) + 1013904223) >>> 0;
  return state.rngSeed / 4294967296;
}

export function randomInt(state, n) {
  return Math.floor(random(state) * n);
}

/** Floor the tide still owns, flooding out from every vent. */
export function tideReachable(state) {
  const { width, height } = state;
  const reach = new Uint8Array(width * height);
  const queue = [];

  const flood = (x, y) => {
    if (!inBounds(state, x, y)) return;
    const i = y * width + x;
    if (reach[i]) return;
    if (!isFloor(state.terrain[i])) return;
    if (state.owner[i] === HELD) return;
    reach[i] = 1;
    queue.push(i);
  };

  for (const vent of state.map.vents) for (const d of DIRS) flood(vent.x + d.x, vent.y + d.y);

  while (queue.length) {
    const i = queue.pop();
    const x = i % width;
    const y = (i - x) / width;
    for (const d of DIRS) flood(x + d.x, y + d.y);
  }
  return reach;
}

/** Where the keeper could walk given a set of abilities (used to validate the layout). */
export function keeperReach(state, abilities = {}) {
  const { width } = state;
  const seen = new Uint8Array(state.terrain.length);
  const start = state.map.start;
  const queue = [start.y * width + start.x];
  seen[queue[0]] = 1;

  while (queue.length) {
    const i = queue.pop();
    const x = i % width;
    const y = (i - x) / width;
    for (const d of DIRS) {
      const nx = x + d.x;
      const ny = y + d.y;
      if (!inBounds(state, nx, ny)) continue;
      const j = ny * width + nx;
      if (seen[j]) continue;
      if (!keeperCanEnter(state.terrain[j], abilities, !!abilities.dash)) continue;
      seen[j] = 1;
      queue.push(j);
    }
  }
  return seen;
}

export function countHeld(state) {
  let held = 0;
  for (let i = 0; i < state.owner.length; i++) if (state.owner[i] === HELD) held++;
  return held;
}

export function heldFraction(state) {
  return state.claimable ? state.held / state.claimable : 0;
}

export function nearestHeld(state, x, y) {
  const { width } = state;
  const seen = new Uint8Array(state.owner.length);
  const queue = [{ x, y }];
  seen[y * width + x] = 1;
  while (queue.length) {
    const cell = queue.shift();
    if (ownerAt(state, cell.x, cell.y) === HELD && isFloor(terrainAt(state, cell.x, cell.y))) return cell;
    for (const d of DIRS) {
      const nx = cell.x + d.x;
      const ny = cell.y + d.y;
      if (!inBounds(state, nx, ny)) continue;
      const j = ny * width + nx;
      if (seen[j]) continue;
      if (!isFloor(state.terrain[j])) continue;
      seen[j] = 1;
      queue.push({ x: nx, y: ny });
    }
  }
  return { x: state.map.start.x, y: state.map.start.y };
}

/**
 * Harvest a shrine tile: the crystal flows back into the keeper whether it was
 * walked over or simply cut off from the tide.
 */
export function harvestShrine(state, x, y) {
  const terrain = terrainAt(state, x, y);
  if (!isShrine(terrain)) return null;
  const ability = SHRINE_ABILITY[terrain];
  setTerrain(state, x, y, WATER);
  if (!state.abilities[ability]) {
    state.abilities[ability] = true;
    if (ability === "surge") state.surgeCharges = Math.min(3, state.surgeCharges + 1);
    state.events.push({ type: "ability", ability });
  }
  return ability;
}

/**
 * Close the current trail: the trail hardens into held floor and every stretch of
 * floor the tide can no longer reach from a vent is claimed with it.
 */
export function resolveSeal(state) {
  for (const cell of state.trail) setOwner(state, cell.x, cell.y, HELD);
  let sealed = state.trail.length;
  state.trail = [];

  const reach = tideReachable(state);
  for (let i = 0; i < state.owner.length; i++) {
    if (state.owner[i] === HELD) continue;
    const terrain = state.terrain[i];
    if (!isFloor(terrain)) continue;
    if (reach[i]) continue;
    state.owner[i] = HELD;
    sealed++;
    if (isShrine(terrain)) harvestShrine(state, i % state.width, (i - (i % state.width)) / state.width);
  }

  let purged = 0;
  state.enemies = state.enemies.filter((enemy) => {
    if (ownerAt(state, enemy.x, enemy.y) !== HELD) return true;
    purged++;
    return false;
  });
  state.purged += purged;
  state.held = countHeld(state);
  const core = state.map.core;
  state.coreSealed = core ? ownerAt(state, core.x, core.y) === HELD : false;

  return { sealed, purged };
}

/** The tide chews at exposed held edges. The keeper's home patch is never lost. */
export function erodeEdges(state, count = 1) {
  const reach = tideReachable(state);
  const { width } = state;
  const anchor = state.anchor || new Set([state.map.start.y * width + state.map.start.x]);
  const candidates = [];
  for (let i = 0; i < state.owner.length; i++) {
    if (state.owner[i] !== HELD || anchor.has(i)) continue;
    const x = i % width;
    const y = (i - x) / width;
    let exposed = false;
    for (const d of DIRS) {
      const j = (y + d.y) * width + (x + d.x);
      if (!inBounds(state, x + d.x, y + d.y)) continue;
      if (reach[j]) exposed = true;
    }
    if (exposed) candidates.push(i);
  }
  let eroded = 0;
  for (let n = 0; n < count && candidates.length; n++) {
    const pick = candidates.splice(randomInt(state, candidates.length), 1)[0];
    state.owner[pick] = OPEN;
    eroded++;
  }
  if (eroded) {
    state.held = countHeld(state);
    const core = state.map.core;
    state.coreSealed = core ? ownerAt(state, core.x, core.y) === HELD : false;
    state.events.push({ type: "erode", count: eroded });
  }
  return eroded;
}

export function clearTrail(state) {
  for (const cell of state.trail) {
    if (ownerAt(state, cell.x, cell.y) === TRAIL) setOwner(state, cell.x, cell.y, OPEN);
  }
  state.trail = [];
}

export function isBrittle(terrain) {
  return terrain === BRITTLE;
}
