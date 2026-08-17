import { describe, it, expect } from "vitest";
import {
  createGame,
  step,
  pickDirection,
  getOutcome,
  summarize,
  computeScore,
  TARGET_SEAL,
  TIDE_MAX,
  START_LIVES,
} from "../src/game.js";
import { ownerAt, terrainAt, setOwner, setTerrain } from "../src/rules.js";
import {
  HELD,
  TRAIL,
  OPEN,
  WATER,
  DEEP,
  BRITTLE,
  CORE,
  SHRINE_DASH,
  SHRINE_SWIM,
} from "../src/tiles.js";
import { makeInput } from "../src/input.js";

const HALL = [
  "#########",
  "#.......#",
  "#.......#",
  "#...@...#",
  "#.......#",
  "#......V#",
  "#########",
];

// A straight corridor: start patch on the left, water to the right.
const CORRIDOR = [
  "###########",
  "#.........#",
  "#...@.....#",
  "#........V#",
  "###########",
];

// Movement, trail and ability tests run on an empty fortress: the danger tests
// below place their own creatures so contact is never accidental.
function hall(seed = 1) {
  const state = createGame({ rows: HALL, seed });
  state.enemies = [];
  return state;
}

function corridor(seed = 2) {
  const state = createGame({ rows: CORRIDOR, seed });
  state.enemies = [];
  return state;
}

function run(state, seconds, input, dt = 1 / 60) {
  for (let t = 0; t < seconds; t += dt) step(state, dt, input);
  return state;
}

function push(dir) {
  const input = makeInput();
  if (dir === "right") input.moveX = 1;
  if (dir === "left") input.moveX = -1;
  if (dir === "up") input.moveY = -1;
  if (dir === "down") input.moveY = 1;
  return input;
}

describe("new run", () => {
  it("starts playable with lives, a home patch and no tide damage", () => {
    const state = createGame({ seed: 42 });
    expect(getOutcome(state)).toBe("playing");
    expect(state.lives).toBe(START_LIVES);
    expect(state.tide).toBe(0);
    expect(state.held).toBeGreaterThanOrEqual(4);
    expect(state.abilities).toEqual({ dash: false, swim: false, surge: false });
    expect(ownerAt(state, state.keeper.x, state.keeper.y)).toBe(HELD);
    expect(state.enemies.length).toBeGreaterThan(0);
  });

  it("is deterministic for a given seed", () => {
    const a = createGame({ seed: 99 });
    const b = createGame({ seed: 99 });
    const input = push("right");
    run(a, 3, input);
    run(b, 3, { ...input });
    expect(a.enemies.map((e) => [e.x, e.y, e.type])).toEqual(b.enemies.map((e) => [e.x, e.y, e.type]));
    expect(a.keeper.x).toBe(b.keeper.x);
    expect(a.tide).toBeCloseTo(b.tide, 6);
  });
});

describe("steering", () => {
  it("ignores stick noise inside the dead zone", () => {
    const state = hall();
    const input = makeInput();
    input.moveX = 0.05;
    input.moveY = -0.04;
    expect(pickDirection(state, input)).toBe(null);
    run(state, 0.5, input);
    expect(state.keeper.x).toBe(4);
    expect(state.keeper.y).toBe(3);
  });

  it("follows the dominant axis first", () => {
    const state = hall();
    const input = makeInput();
    input.moveX = 0.9;
    input.moveY = -0.3;
    expect(pickDirection(state, input)).toEqual({ x: 1, y: 0 });
    input.moveX = 0.3;
    input.moveY = -0.9;
    expect(pickDirection(state, input)).toEqual({ x: 0, y: -1 });
  });

  it("falls back to the other axis when rock blocks the dominant one", () => {
    const state = hall();
    state.keeper.x = 1;
    state.keeper.y = 3;
    const input = makeInput();
    input.moveX = -0.9; // into the west wall
    input.moveY = -0.4;
    expect(pickDirection(state, input)).toEqual({ x: 0, y: -1 });
  });

  it("never walks into rock", () => {
    const state = corridor();
    run(state, 6, push("right"));
    expect(terrainAt(state, state.keeper.x, state.keeper.y)).not.toBe(0);
    expect(state.keeper.x).toBeLessThanOrEqual(9);
  });
});

describe("trail and claiming", () => {
  it("lays a trail across open water and closes it back on held floor", () => {
    const state = corridor();
    run(state, 0.45, push("right"));
    expect(state.trail.length).toBeGreaterThan(0);
    expect(ownerAt(state, state.keeper.x, state.keeper.y)).toBe(TRAIL);
    const heldBefore = state.held;
    run(state, 0.6, push("left"));
    expect(state.trail).toHaveLength(0);
    expect(state.held).toBeGreaterThan(heldBefore);
  });

  it("lets the keeper walk back along its own trail without losing it", () => {
    const state = corridor();
    state.keeper.x = 6;
    state.keeper.y = 2;
    setOwner(state, 5, 2, TRAIL);
    setOwner(state, 6, 2, TRAIL);
    state.trail = [
      { x: 5, y: 2 },
      { x: 6, y: 2 },
    ];
    run(state, 0.25, push("left"));
    expect(state.trail).toHaveLength(1);
    expect(ownerAt(state, 6, 2)).toBe(OPEN);
    expect(state.events.some((e) => e.type === "deny")).toBe(false);
  });

  it("drops the trail and pushes the tide up when it crosses itself", () => {
    const state = hall();
    state.keeper.x = 4;
    state.keeper.y = 1;
    setOwner(state, 4, 1, OPEN);
    setOwner(state, 5, 1, TRAIL);
    state.trail = [{ x: 5, y: 1 }];
    const tideBefore = state.tide;
    run(state, 0.2, push("right"));
    expect(state.trail).toHaveLength(0);
    expect(state.tide).toBeGreaterThan(tideBefore);
    expect(state.events.some((e) => e.type === "deny")).toBe(true);
  });

  it("rewards a seal by pushing the tide back", () => {
    const state = hall();
    state.tide = 40;
    for (let x = 1; x <= 7; x++) setOwner(state, x, 2, TRAIL);
    state.trail = Array.from({ length: 7 }, (_, i) => ({ x: i + 1, y: 2 }));
    state.keeper.x = 4;
    state.keeper.y = 2;
    run(state, 0.3, push("down")); // step back onto the held patch at y=3
    expect(state.trail).toHaveLength(0);
    expect(state.tide).toBeLessThan(40);
  });
});

describe("abilities", () => {
  it("grants an ability by walking onto its shrine", () => {
    const state = hall();
    setTerrain(state, 5, 3, SHRINE_DASH);
    setOwner(state, 5, 3, OPEN);
    run(state, 0.4, push("right"));
    expect(state.abilities.dash).toBe(true);
    expect(terrainAt(state, 5, 3)).toBe(WATER);
    expect(state.events.some((e) => e.type === "ability")).toBe(true);
  });

  it("also harvests a shrine that ends up inside a sealed pocket", () => {
    const state = hall(4);
    setTerrain(state, 1, 1, SHRINE_SWIM);
    for (let x = 1; x <= 7; x++) setOwner(state, x, 2, TRAIL);
    state.trail = Array.from({ length: 7 }, (_, i) => ({ x: i + 1, y: 2 }));
    state.keeper.x = 4;
    state.keeper.y = 2;
    run(state, 0.3, push("down"));
    expect(state.abilities.swim).toBe(true);
  });

  it("keeps deep channels impassable until swim is earned", () => {
    const state = hall();
    setTerrain(state, 5, 3, DEEP);
    run(state, 1.2, push("right"));
    expect(state.keeper.x).toBe(4);
    state.abilities.swim = true;
    run(state, 1.2, push("right"));
    expect(state.keeper.x).toBeGreaterThan(4);
  });

  it("only lets a dash smash a brittle bulkhead", () => {
    const state = hall();
    setTerrain(state, 5, 3, BRITTLE);
    run(state, 0.6, push("right"));
    expect(state.keeper.x).toBe(4);
    expect(terrainAt(state, 5, 3)).toBe(BRITTLE);

    state.abilities.dash = true;
    const input = push("right");
    input.dash = true;
    run(state, 0.6, input);
    expect(terrainAt(state, 5, 3)).toBe(WATER);
    expect(state.keeper.x).toBeGreaterThanOrEqual(5);
    expect(state.events.some((e) => e.type === "smash")).toBe(true);
  });

  it("spends a surge charge to freeze the tide creatures", () => {
    const state = hall();
    const input = makeInput();
    input.surge = true;
    step(state, 1 / 60, input);
    expect(state.freeze).toBe(0); // no ability yet
    expect(state.events.some((e) => e.type === "deny")).toBe(true);

    state.abilities.surge = true;
    state.surgeCharges = 1;
    const again = makeInput();
    again.surge = true;
    step(state, 1 / 60, again);
    expect(state.freeze).toBeGreaterThan(0);
    expect(state.surgeCharges).toBe(0);
  });

  it("holds frozen creatures still", () => {
    const state = hall();
    state.enemies = [{ id: 9, type: "wraith", x: 1, y: 1, dir: null, prog: 0, speed: 4 }];
    state.freeze = 2;
    run(state, 1, makeInput());
    expect(state.enemies[0].x).toBe(1);
    expect(state.enemies[0].y).toBe(1);
  });
});

describe("danger", () => {
  it("costs a life and wipes the trail when a creature touches the keeper", () => {
    const state = hall();
    state.enemies = [{ id: 1, type: "wraith", x: 4, y: 3, dir: null, prog: 0, speed: 0 }];
    setOwner(state, 5, 1, TRAIL);
    state.trail = [{ x: 5, y: 1 }];
    step(state, 1 / 60, makeInput());
    expect(state.lives).toBe(START_LIVES - 1);
    expect(state.trail).toHaveLength(0);
    expect(ownerAt(state, 5, 1)).toBe(OPEN);
    expect(ownerAt(state, state.keeper.x, state.keeper.y)).toBe(HELD);
  });

  it("cuts the trail and raises the tide, but spares a life, when a creature runs over the trail", () => {
    const state = hall();
    state.keeper.x = 1;
    state.keeper.y = 5;
    state.keeper.invuln = 0;
    const tideBefore = state.tide;
    setOwner(state, 4, 1, TRAIL);
    state.trail = [{ x: 4, y: 1 }];
    state.enemies = [{ id: 2, type: "eel", x: 3, y: 1, dir: { x: 1, y: 0 }, prog: 0.9, speed: 6 }];
    run(state, 0.2, makeInput());
    expect(state.trail).toHaveLength(0);
    expect(ownerAt(state, 4, 1)).toBe(OPEN);
    expect(state.lives).toBe(START_LIVES);
    expect(state.tide).toBeGreaterThan(tideBefore);
    expect(state.events.some((e) => e.type === "cut")).toBe(true);
  });

  it("ends the run when the last life is gone", () => {
    const state = hall();
    state.lives = 1;
    state.enemies = [{ id: 1, type: "wraith", x: 4, y: 3, dir: null, prog: 0, speed: 0 }];
    step(state, 1 / 60, makeInput());
    expect(state.lives).toBe(0);
    expect(getOutcome(state)).toBe("lost");
    expect(state.events.some((e) => e.type === "lost")).toBe(true);
  });

  it("purges a creature the keeper dashes through", () => {
    const state = hall();
    state.abilities.dash = true;
    state.keeper.dashT = 0.3;
    state.enemies = [{ id: 1, type: "wraith", x: 4, y: 3, dir: null, prog: 0, speed: 0 }];
    step(state, 1 / 60, makeInput());
    expect(state.enemies).toHaveLength(0);
    expect(state.lives).toBe(START_LIVES);
    expect(state.purged).toBe(1);
  });

  it("drowns the fortress when the tide gauge fills", () => {
    const state = hall();
    state.tide = TIDE_MAX - 0.01;
    step(state, 1 / 30, makeInput());
    expect(getOutcome(state)).toBe("lost");
    expect(state.loss).toBe("flood");
  });

  it("ignores input once the run is over", () => {
    const state = hall();
    state.outcome = "lost";
    const before = { ...state.keeper };
    run(state, 1, push("right"));
    expect(state.keeper.x).toBe(before.x);
    expect(state.keeper.y).toBe(before.y);
  });
});

describe("victory", () => {
  it("needs a lit core and the target share of the fortress", () => {
    const state = hall();
    state.coreLit = true;
    state.held = Math.floor(state.claimable * TARGET_SEAL) - 1;
    step(state, 1 / 60, makeInput());
    expect(getOutcome(state)).toBe("playing");
    state.held = Math.ceil(state.claimable * TARGET_SEAL);
    step(state, 1 / 60, makeInput());
    expect(getOutcome(state)).toBe("won");
    expect(state.events.some((e) => e.type === "won")).toBe(true);
  });

  it("will not win on tiles alone while the core is dark", () => {
    const state = hall();
    state.coreLit = false;
    state.held = state.claimable;
    step(state, 1 / 60, makeInput());
    expect(getOutcome(state)).toBe("playing");
  });

  it("lights the core when the keeper reaches it", () => {
    const state = hall();
    setTerrain(state, 5, 3, CORE);
    setOwner(state, 5, 3, OPEN);
    run(state, 0.4, push("right"));
    expect(state.coreLit).toBe(true);
    expect(state.events.some((e) => e.type === "core")).toBe(true);
  });

  it("only reaches the vault once swimming is earned", () => {
    const state = createGame({ seed: 8 });
    const core = state.map.core;
    const moat = [
      { x: core.x, y: core.y - 2 },
      { x: core.x, y: core.y + 2 },
      { x: core.x - 2, y: core.y },
      { x: core.x + 2, y: core.y },
    ];
    for (const cell of moat) expect(terrainAt(state, cell.x, cell.y)).toBe(DEEP);
  });
});

describe("scoring and hud", () => {
  it("scores held floor, purges, abilities and survival", () => {
    const state = hall();
    const base = computeScore(state);
    state.held += 20;
    expect(computeScore(state)).toBeGreaterThan(base);
    const withPurge = computeScore(state);
    state.purged += 3;
    expect(computeScore(state)).toBeGreaterThan(withPurge);
    const withAbility = computeScore(state);
    state.abilities.dash = true;
    expect(computeScore(state)).toBeGreaterThan(withAbility);
  });

  it("summarises the state the hud needs", () => {
    const state = hall();
    const view = summarize(state);
    expect(view).toMatchObject({
      lives: START_LIVES,
      outcome: "playing",
    });
    expect(view.sealed).toBeGreaterThanOrEqual(0);
    expect(view.sealed).toBeLessThanOrEqual(1);
    expect(view.target).toBe(TARGET_SEAL);
    expect(typeof view.score).toBe("number");
    expect(typeof view.msg).toBe("string");
  });
});

describe("tide pressure", () => {
  it("rises over time and spawns more creatures as it climbs", () => {
    const state = createGame({ seed: 11 });
    const before = state.enemies.length;
    run(state, 40, makeInput(), 1 / 30);
    expect(state.tide).toBeGreaterThan(0);
    expect(state.enemies.length).toBeGreaterThanOrEqual(before);
    expect(state.enemies.length).toBeLessThanOrEqual(8);
  });

  it("chews back held edges once the tide is high", () => {
    const state = createGame({ seed: 12 });
    state.lives = 9; // isolate erosion from creature contact
    for (let x = 1; x <= 19; x++) setOwner(state, x, 1, HELD);
    state.held = 0;
    for (let i = 0; i < state.owner.length; i++) if (state.owner[i] === HELD) state.held++;
    state.tide = 60;
    const before = state.held;
    run(state, 9, makeInput(), 1 / 30);
    expect(state.held).toBeLessThan(before);
  });
});
