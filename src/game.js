import { parseMap } from "./map.js";
import {
  DIRS,
  terrainAt,
  ownerAt,
  setTerrain,
  setOwner,
  tideReachable,
  resolveSeal,
  clearTrail,
  harvestShrine,
  nearestHeld,
  countHeld,
  heldFraction,
  erodeEdges,
  randomInt,
  random,
} from "./rules.js";
import {
  WATER,
  DEEP,
  BRITTLE,
  CORE,
  HELD,
  TRAIL,
  OPEN,
  isFloor,
  keeperCanEnter,
} from "./tiles.js";
import { makeInput, DEAD_ZONE } from "./input.js";

export const TARGET_SEAL = 0.72;
export const TIDE_MAX = 100;
export const START_LIVES = 4;

const KEEPER_SPEED = 5.8;
const DEEP_SPEED = 0.62;
const DASH_SPEED = 2.7;
const DASH_TIME = 0.34;
const DASH_COOLDOWN = 1.4;
const INVULN_TIME = 2.4;

const TIDE_BASE_RATE = 0.34;
const TIDE_RAMP = 0.003;
const SEAL_RELIEF = 0.4;
const CROSS_PENALTY = 4;
const CUT_PENALTY = 3;
const BREACH_PENALTY = 5;

const ERODE_INTERVAL = 4.5;
const ERODE_FROM_TIDE = 45;
const SPAWN_INTERVAL = 5.5;
const ENEMY_CAP = 6;

const SURGE_FREEZE = 3.6;
const SURGE_RELIEF = 6;
const SURGE_SEAL_TILES = 16;
const MAX_SURGE = 3;

const ENEMY_KINDS = {
  wraith: { speed: 2.7, label: "潮怨" },
  eel: { speed: 3.7, label: "潮鰻" },
  swirl: { speed: 2.9, label: "渦靈" },
};

export function createGame({ seed = 1, rows } = {}) {
  const map = parseMap(rows);
  const state = {
    seed,
    rngSeed: (Math.imul(seed || 1, 2654435761) >>> 0) || 1,
    map,
    width: map.width,
    height: map.height,
    terrain: Uint8Array.from(map.terrain),
    owner: new Uint8Array(map.width * map.height),
    claimable: map.claimable,
    keeper: {
      x: map.start.x,
      y: map.start.y,
      dir: null,
      prog: 0,
      facing: { x: 0, y: 1 },
      dashT: 0,
      dashCd: 0,
      invuln: 0,
    },
    trail: [],
    abilities: { dash: false, swim: false, surge: false },
    surgeCharges: 0,
    freeze: 0,
    lives: START_LIVES,
    tide: 0,
    elapsed: 0,
    erodeT: 0,
    spawnT: 0,
    enemies: [],
    nextEnemyId: 0,
    held: 0,
    purged: 0,
    seals: 0,
    coreLit: false,
    coreSealed: false,
    outcome: "playing",
    loss: null,
    msg: "沿著水面拉出潮線，繞回領地就能封存",
    events: [],
  };

  // The home patch is permanent: the tide may chew back anything else, so a run
  // always keeps somewhere to close a trail against.
  state.anchor = new Set();
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = map.start.x + dx;
      const y = map.start.y + dy;
      if (!isFloor(terrainAt(state, x, y))) continue;
      setOwner(state, x, y, HELD);
      state.anchor.add(y * map.width + x);
    }
  }
  state.held = countHeld(state);
  spawnEnemy(state);
  return state;
}

export function getOutcome(state) {
  return state.outcome;
}

export function step(state, dt, input) {
  const control = input || makeInput();
  if (state.outcome !== "playing") {
    control.dash = false;
    control.surge = false;
    return state;
  }
  let remaining = Math.min(Math.max(dt, 0), 0.5);
  while (remaining > 0) {
    const slice = Math.min(remaining, 1 / 60);
    advance(state, slice, control);
    remaining -= slice;
    if (state.outcome !== "playing") break;
  }
  control.dash = false;
  control.surge = false;
  return state;
}

function advance(state, dt, input) {
  state.elapsed += dt;

  if (input.dash) {
    input.dash = false;
    tryDash(state);
  }
  if (input.surge) {
    input.surge = false;
    trySurge(state);
  }

  const keeper = state.keeper;
  keeper.dashT = Math.max(0, keeper.dashT - dt);
  keeper.dashCd = Math.max(0, keeper.dashCd - dt);
  keeper.invuln = Math.max(0, keeper.invuln - dt);
  state.freeze = Math.max(0, state.freeze - dt);

  state.tide += (TIDE_BASE_RATE + state.elapsed * TIDE_RAMP) * dt;
  if (state.tide >= TIDE_MAX) {
    state.tide = TIDE_MAX;
    lose(state, "flood");
    return;
  }

  state.erodeT += dt;
  if (state.erodeT >= ERODE_INTERVAL) {
    state.erodeT = 0;
    if (state.tide >= ERODE_FROM_TIDE) erodeEdges(state, 1 + Math.floor(state.tide / 60));
  }

  state.spawnT += dt;
  if (state.spawnT >= SPAWN_INTERVAL) {
    state.spawnT = 0;
    if (state.enemies.length < spawnTarget(state)) spawnEnemy(state);
  }

  moveKeeper(state, dt, input);
  if (state.outcome !== "playing") return;
  if (state.freeze <= 0) moveEnemies(state, dt);
  if (state.outcome !== "playing") return;
  checkContact(state);
  if (state.outcome !== "playing") return;
  checkVictory(state);
}

/* ------------------------------------------------------------------ keeper */

function dashing(state) {
  return state.keeper.dashT > 0;
}

function canKeeperStep(state, x, y) {
  return keeperCanEnter(terrainAt(state, x, y), state.abilities, dashing(state));
}

export function pickDirection(state, input) {
  const mx = input.moveX || 0;
  const my = input.moveY || 0;
  const ax = Math.abs(mx);
  const ay = Math.abs(my);
  if (ax < DEAD_ZONE && ay < DEAD_ZONE) return null;
  const horizontal = ax >= DEAD_ZONE ? { x: Math.sign(mx), y: 0 } : null;
  const vertical = ay >= DEAD_ZONE ? { x: 0, y: Math.sign(my) } : null;
  const order = ax >= ay ? [horizontal, vertical] : [vertical, horizontal];
  const keeper = state.keeper;
  for (const dir of order) {
    if (!dir) continue;
    if (canKeeperStep(state, keeper.x + dir.x, keeper.y + dir.y)) return dir;
  }
  return null;
}

function keeperSpeed(state) {
  const deep = terrainAt(state, state.keeper.x, state.keeper.y) === DEEP;
  return KEEPER_SPEED * (dashing(state) ? DASH_SPEED : 1) * (deep ? DEEP_SPEED : 1);
}

function moveKeeper(state, dt, input) {
  const keeper = state.keeper;
  let remaining = dt;
  let guard = 0;
  while (remaining > 0 && guard++ < 64) {
    if (!keeper.dir) {
      const dir = pickDirection(state, input);
      if (!dir) {
        keeper.prog = 0;
        return;
      }
      keeper.dir = dir;
      keeper.facing = dir;
    }
    const speed = keeperSpeed(state);
    const need = (1 - keeper.prog) / speed;
    if (need > remaining) {
      keeper.prog += speed * remaining;
      return;
    }
    remaining -= need;
    keeper.prog = 0;
    keeper.x += keeper.dir.x;
    keeper.y += keeper.dir.y;
    onKeeperEnter(state, keeper.x, keeper.y);
    if (state.outcome !== "playing") return;
    const next = pickDirection(state, input);
    keeper.dir = next;
    if (next) keeper.facing = next;
    else return;
  }
}

function onKeeperEnter(state, x, y) {
  const terrain = terrainAt(state, x, y);
  if (terrain === BRITTLE) {
    setTerrain(state, x, y, WATER);
    state.events.push({ type: "smash", x, y });
    state.msg = "潮躍撞開脆化艙壁";
  }
  harvestShrine(state, x, y);
  if (terrain === CORE && !state.coreLit) {
    state.coreLit = true;
    state.events.push({ type: "core" });
    state.msg = "核心點亮！封存要塞 72% 就能重啟";
  }

  const owner = ownerAt(state, x, y);
  if (owner === HELD) {
    if (state.trail.length) closeTrail(state);
    return;
  }
  if (owner === TRAIL) {
    const back = state.trail[state.trail.length - 2];
    if (back && back.x === x && back.y === y) {
      const head = state.trail.pop();
      setOwner(state, head.x, head.y, OPEN);
      return;
    }
    breakTrail(state);
    return;
  }
  setOwner(state, x, y, TRAIL);
  state.trail.push({ x, y });
}

function closeTrail(state) {
  const result = resolveSeal(state);
  if (!result.sealed) return;
  state.seals += 1;
  state.tide = Math.max(0, state.tide - result.sealed * SEAL_RELIEF);
  if (state.abilities.surge && result.sealed >= SURGE_SEAL_TILES) {
    state.surgeCharges = Math.min(MAX_SURGE, state.surgeCharges + 1);
  }
  state.events.push({ type: "seal", sealed: result.sealed, purged: result.purged });
  state.msg = `封存 ${result.sealed} 格${result.purged ? ` · 淨化 ${result.purged} 隻` : ""}`;
  checkVictory(state);
}

function breakTrail(state) {
  clearTrail(state);
  state.tide = Math.min(TIDE_MAX, state.tide + CROSS_PENALTY);
  state.events.push({ type: "deny", reason: "cross" });
  state.msg = "潮線自我交叉，重新拉線";
}

function cutTrail(state) {
  if (!state.trail.length) return;
  clearTrail(state);
  state.tide = Math.min(TIDE_MAX, state.tide + CUT_PENALTY);
  state.events.push({ type: "cut" });
  state.msg = "潮線被沖斷了，退回領地再拉";
}

function tryDash(state) {
  const keeper = state.keeper;
  if (!state.abilities.dash) {
    state.events.push({ type: "deny", reason: "no-dash" });
    state.msg = "還沒取得潮躍";
    return false;
  }
  if (keeper.dashCd > 0) return false;
  keeper.dashT = DASH_TIME;
  keeper.dashCd = DASH_COOLDOWN;
  state.events.push({ type: "dash" });
  return true;
}

function trySurge(state) {
  if (!state.abilities.surge || state.surgeCharges <= 0) {
    state.events.push({ type: "deny", reason: "no-surge" });
    state.msg = state.abilities.surge ? "潮閘能量不足（封存 16 格以上可充能）" : "還沒取得潮閘";
    return false;
  }
  state.surgeCharges -= 1;
  state.freeze = SURGE_FREEZE;
  state.tide = Math.max(0, state.tide - SURGE_RELIEF);
  state.events.push({ type: "surge" });
  state.msg = "潮閘落下，潮水凝結";
  return true;
}

/* ----------------------------------------------------------------- enemies */

function enemyCanEnter(state, x, y) {
  return isFloor(terrainAt(state, x, y)) && ownerAt(state, x, y) !== HELD;
}

function spawnTarget(state) {
  return Math.min(ENEMY_CAP, 1 + Math.floor(state.tide / 25));
}

function pickEnemyKind(state) {
  const roll = random(state);
  if (state.tide >= 45 && roll < 0.4) return "swirl";
  if (roll < 0.55) return "wraith";
  return "eel";
}

function spawnEnemy(state) {
  const vents = state.map.vents;
  if (!vents.length) return null;
  for (let attempt = 0; attempt < 16; attempt++) {
    const vent = vents[randomInt(state, vents.length)];
    const dir = DIRS[randomInt(state, DIRS.length)];
    const x = vent.x + dir.x;
    const y = vent.y + dir.y;
    if (!enemyCanEnter(state, x, y)) continue;
    if (Math.abs(x - state.keeper.x) + Math.abs(y - state.keeper.y) < 4) continue;
    const kind = pickEnemyKind(state);
    const enemy = {
      id: ++state.nextEnemyId,
      type: kind,
      x,
      y,
      dir: null,
      prog: 0,
      speed: ENEMY_KINDS[kind].speed,
    };
    state.enemies.push(enemy);
    return enemy;
  }
  return null;
}

function chooseEnemyDir(state, enemy) {
  const open = DIRS.filter((d) => enemyCanEnter(state, enemy.x + d.x, enemy.y + d.y));
  if (!open.length) return null;
  const reverse = enemy.dir ? { x: -enemy.dir.x, y: -enemy.dir.y } : null;
  const ahead = reverse ? open.filter((d) => d.x !== reverse.x || d.y !== reverse.y) : open;
  const pool = ahead.length ? ahead : open;

  if (enemy.type === "swirl" && random(state) < 0.65) {
    let best = pool[0];
    let bestDist = Infinity;
    for (const d of pool) {
      const dist =
        Math.abs(enemy.x + d.x - state.keeper.x) + Math.abs(enemy.y + d.y - state.keeper.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = d;
      }
    }
    return best;
  }

  const straight = enemy.dir && pool.some((d) => d.x === enemy.dir.x && d.y === enemy.dir.y);
  if (straight && random(state) < (enemy.type === "eel" ? 0.92 : 0.7)) return enemy.dir;
  return pool[randomInt(state, pool.length)];
}

function moveEnemies(state, dt) {
  for (const enemy of state.enemies) {
    moveEnemy(state, enemy, dt);
    if (state.outcome !== "playing") return;
  }
}

function moveEnemy(state, enemy, dt) {
  let remaining = dt;
  let guard = 0;
  while (remaining > 0 && guard++ < 64) {
    if (!enemy.dir) {
      const dir = chooseEnemyDir(state, enemy);
      if (!dir) {
        enemy.prog = 0;
        return;
      }
      enemy.dir = dir;
    }
    const need = (1 - enemy.prog) / enemy.speed;
    if (need > remaining) {
      enemy.prog += enemy.speed * remaining;
      return;
    }
    remaining -= need;
    enemy.prog = 0;
    enemy.x += enemy.dir.x;
    enemy.y += enemy.dir.y;
    if (ownerAt(state, enemy.x, enemy.y) === TRAIL) cutTrail(state);
    enemy.dir = chooseEnemyDir(state, enemy);
    if (!enemy.dir) return;
  }
}

/* -------------------------------------------------------------- collisions */

export function entityPos(entity) {
  const dir = entity.dir;
  return {
    x: entity.x + (dir ? dir.x * entity.prog : 0),
    y: entity.y + (dir ? dir.y * entity.prog : 0),
  };
}

function checkContact(state) {
  const keeper = entityPos(state.keeper);
  for (let i = state.enemies.length - 1; i >= 0; i--) {
    const pos = entityPos(state.enemies[i]);
    const dx = pos.x - keeper.x;
    const dy = pos.y - keeper.y;
    if (dx * dx + dy * dy > 0.55) continue;
    if (dashing(state)) {
      state.enemies.splice(i, 1);
      state.purged += 1;
      state.events.push({ type: "purge" });
      state.msg = "潮躍撞散一隻潮怨";
      continue;
    }
    damage(state, "contact");
    if (state.outcome !== "playing") return;
  }
}

function damage(state, reason) {
  const keeper = state.keeper;
  if (keeper.invuln > 0) return;
  clearTrail(state);
  state.lives -= 1;
  state.tide = Math.min(TIDE_MAX, state.tide + BREACH_PENALTY);
  const spot = nearestHeld(state, keeper.x, keeper.y);
  keeper.x = spot.x;
  keeper.y = spot.y;
  keeper.dir = null;
  keeper.prog = 0;
  keeper.dashT = 0;
  keeper.invuln = INVULN_TIME;
  state.events.push({ type: "breach", reason });
  state.msg = "被潮怨撞上，退回領地";
  if (state.lives <= 0) lose(state, "breach");
}

/* ---------------------------------------------------------------- outcomes */

function lose(state, reason) {
  state.outcome = "lost";
  state.loss = reason;
  state.msg = reason === "flood" ? "潮位滿溢，要塞沉沒" : "守塔者力竭，要塞失守";
  state.events.push({ type: "lost", reason });
}

function checkVictory(state) {
  if (state.outcome !== "playing") return;
  if (!state.coreLit) return;
  if (heldFraction(state) < TARGET_SEAL) return;
  state.outcome = "won";
  state.msg = "核心封存、潮水退去——要塞重新啟動！";
  state.events.push({ type: "won" });
}

export function computeScore(state) {
  const abilities = Object.values(state.abilities).filter(Boolean).length;
  return Math.round(
    state.held * 10 +
      state.purged * 70 +
      abilities * 150 +
      Math.max(0, state.lives) * 100 +
      (state.coreLit ? 300 : 0) +
      (state.coreSealed ? 500 : 0) +
      Math.max(0, TIDE_MAX - state.tide) * 2,
  );
}

export function summarize(state) {
  return {
    sealed: heldFraction(state),
    target: TARGET_SEAL,
    held: state.held,
    claimable: state.claimable,
    tide: state.tide / TIDE_MAX,
    lives: state.lives,
    abilities: { ...state.abilities },
    surge: state.surgeCharges,
    frozen: state.freeze > 0,
    dashReady: state.abilities.dash && state.keeper.dashCd <= 0,
    coreLit: state.coreLit,
    coreSealed: state.coreSealed,
    trail: state.trail.length,
    purged: state.purged,
    score: computeScore(state),
    outcome: state.outcome,
    loss: state.loss,
    msg: state.msg,
  };
}

export { tideReachable, heldFraction };
export const ENEMY_LABELS = Object.fromEntries(
  Object.entries(ENEMY_KINDS).map(([key, value]) => [key, value.label]),
);
