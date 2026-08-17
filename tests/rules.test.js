import { describe, it, expect } from "vitest";
import { parseMap, FORTRESS_ROWS } from "../src/map.js";
import {
  terrainAt,
  ownerAt,
  setOwner,
  tideReachable,
  keeperReach,
  resolveSeal,
  nearestHeld,
  heldFraction,
  erodeEdges,
  countHeld,
} from "../src/rules.js";
import { createGame, TARGET_SEAL } from "../src/game.js";
import { ROCK, WATER, DEEP, BRITTLE, VENT, CORE, HELD, TRAIL, OPEN } from "../src/tiles.js";

const ALCOVE = [
  "#######",
  "#..#..#",
  "#..#..#",
  "#.@#..#",
  "#..#..#",
  "#..#.V#",
  "#######",
];

const HALL = [
  "#########",
  "#.......#",
  "#.......#",
  "#...@...#",
  "#.......#",
  "#......V#",
  "#########",
];

describe("map parsing", () => {
  it("keeps the fortress map rectangular with a solid rock border", () => {
    const width = FORTRESS_ROWS[0].length;
    for (const row of FORTRESS_ROWS) expect(row.length).toBe(width);
    const map = parseMap(FORTRESS_ROWS);
    for (let x = 0; x < map.width; x++) {
      expect(map.terrain[x]).toBe(ROCK);
      expect(map.terrain[(map.height - 1) * map.width + x]).toBe(ROCK);
    }
    for (let y = 0; y < map.height; y++) {
      expect(map.terrain[y * map.width]).toBe(ROCK);
      expect(map.terrain[y * map.width + map.width - 1]).toBe(ROCK);
    }
  });

  it("locates the start, the vents, the shrines and the core", () => {
    const map = parseMap(FORTRESS_ROWS);
    expect(map.start).toBeTruthy();
    expect(map.vents.length).toBeGreaterThanOrEqual(3);
    expect(map.core).toBeTruthy();
    expect(map.shrines.dash).toBeTruthy();
    expect(map.shrines.swim).toBeTruthy();
    expect(map.shrines.surge).toBeTruthy();
    for (const vent of map.vents) {
      expect(map.terrain[vent.y * map.width + vent.x]).toBe(VENT);
    }
    expect(map.terrain[map.core.y * map.width + map.core.x]).toBe(CORE);
  });

  it("counts brittle bulkheads as claimable but never rock or vents", () => {
    const map = parseMap(["#####", "#@=V#", "#~C.#", "#####"]);
    // claimable = 2 water + deep + core + brittle = 5
    expect(map.claimable).toBe(5);
  });
});

describe("tide flow", () => {
  it("never reaches floor the fortress already holds", () => {
    const state = createGame({ rows: HALL, seed: 7 });
    const reach = tideReachable(state);
    expect(reach[3 * state.width + 6]).toBe(1); // open water near the vent
    expect(reach[state.keeper.y * state.width + state.keeper.x]).toBe(0); // start patch is held
  });

  it("cannot cross a wall of held floor", () => {
    const state = createGame({ rows: HALL, seed: 7 });
    for (let x = 1; x <= 7; x++) setOwner(state, x, 2, HELD);
    const reach = tideReachable(state);
    expect(reach[1 * state.width + 1]).toBe(0); // sealed off above the wall
    expect(reach[5 * state.width + 1]).toBe(1); // vent side still floods
  });
});

describe("sealing", () => {
  it("turns the trail into held floor and claims everything the tide lost", () => {
    const state = createGame({ rows: HALL, seed: 3 });
    for (let x = 1; x <= 7; x++) setOwner(state, x, 2, TRAIL);
    state.trail = Array.from({ length: 7 }, (_, i) => ({ x: i + 1, y: 2 }));
    const result = resolveSeal(state);
    expect(ownerAt(state, 4, 2)).toBe(HELD);
    expect(ownerAt(state, 1, 1)).toBe(HELD); // enclosed strip above the trail
    expect(ownerAt(state, 1, 5)).toBe(OPEN); // vent side stays flooded
    expect(result.sealed).toBeGreaterThan(0);
    expect(state.trail).toHaveLength(0);
  });

  it("purges tide creatures caught inside a freshly sealed pocket", () => {
    const state = createGame({ rows: HALL, seed: 3 });
    state.enemies = [{ id: 1, type: "wraith", x: 1, y: 1, dir: null, prog: 0, speed: 3 }];
    for (let x = 1; x <= 7; x++) setOwner(state, x, 2, TRAIL);
    state.trail = Array.from({ length: 7 }, (_, i) => ({ x: i + 1, y: 2 }));
    const result = resolveSeal(state);
    expect(result.purged).toBe(1);
    expect(state.enemies).toHaveLength(0);
    expect(state.purged).toBe(1);
  });

  it("claims a room the tide can never reach once a trail closes", () => {
    const state = createGame({ rows: ALCOVE, seed: 3 });
    expect(ownerAt(state, 1, 1)).toBe(OPEN);
    resolveSeal(state);
    expect(ownerAt(state, 1, 1)).toBe(HELD);
    expect(ownerAt(state, 4, 1)).toBe(OPEN); // vent room stays open
  });

  it("marks the core sealed only when its chamber is cut off", () => {
    const state = createGame({ seed: 3 });
    expect(state.coreSealed).toBe(false);
    const core = state.map.core;
    setOwner(state, core.x, core.y, HELD);
    resolveSeal(state);
    expect(state.coreSealed).toBe(true);
  });

  it("cannot claim the vault while the deep moat still feeds it", () => {
    const state = createGame({ seed: 3 });
    resolveSeal(state);
    expect(ownerAt(state, state.map.core.x, state.map.core.y)).toBe(OPEN);
  });
});

describe("held helpers", () => {
  it("finds the closest held tile to fall back to", () => {
    const state = createGame({ rows: HALL, seed: 3 });
    const spot = nearestHeld(state, 1, 1);
    expect(ownerAt(state, spot.x, spot.y)).toBe(HELD);
    expect(Math.abs(spot.x - 1) + Math.abs(spot.y - 1)).toBeLessThanOrEqual(4);
  });

  it("reports the held fraction of claimable floor", () => {
    const state = createGame({ seed: 3 });
    const frac = heldFraction(state);
    expect(frac).toBeGreaterThan(0);
    expect(frac).toBeLessThan(0.1);
  });

  it("erodes only held edges the tide can touch and spares the home patch", () => {
    const state = createGame({ rows: HALL, seed: 5 });
    setOwner(state, 1, 1, HELD);
    setOwner(state, 2, 1, HELD);
    state.held = countHeld(state);
    const before = state.held;
    const eroded = erodeEdges(state, 2);
    expect(eroded).toBe(2);
    expect(state.held).toBe(before - 2);
    for (const index of state.anchor) expect(state.owner[index]).toBe(HELD);
  });

  it("cannot erode the home patch away even after many surges", () => {
    const state = createGame({ rows: HALL, seed: 5 });
    for (let i = 0; i < 40; i++) erodeEdges(state, 3);
    expect(state.held).toBe(state.anchor.size);
    expect(ownerAt(state, state.map.start.x, state.map.start.y)).toBe(HELD);
  });
});

describe("fortress design gates progress", () => {
  it("locks the swim shrine and the core behind the brittle bulkheads", () => {
    const state = createGame({ seed: 1 });
    const bare = keeperReach(state, {});
    const swim = state.map.shrines.swim;
    const core = state.map.core;
    expect(bare[swim.y * state.width + swim.x]).toBe(0);
    expect(bare[core.y * state.width + core.x]).toBe(0);
    const dashOnly = keeperReach(state, { dash: true });
    expect(dashOnly[swim.y * state.width + swim.x]).toBe(1);
    expect(dashOnly[core.y * state.width + core.x]).toBe(0);
    const both = keeperReach(state, { dash: true, swim: true });
    expect(both[core.y * state.width + core.x]).toBe(1);
  });

  it("keeps the dash shrine reachable from the very start", () => {
    const state = createGame({ seed: 1 });
    const bare = keeperReach(state, {});
    const dash = state.map.shrines.dash;
    expect(bare[dash.y * state.width + dash.x]).toBe(1);
  });

  it("puts less than the seal target inside the outer ring, so dash is mandatory", () => {
    const state = createGame({ seed: 1 });
    const bare = keeperReach(state, {});
    let reachable = 0;
    for (let i = 0; i < bare.length; i++) if (bare[i]) reachable++;
    expect(reachable / state.claimable).toBeLessThan(TARGET_SEAL);
  });

  it("keeps deep channels and brittle walls in the layout", () => {
    const state = createGame({ seed: 1 });
    let deep = 0;
    let brittle = 0;
    for (let i = 0; i < state.terrain.length; i++) {
      if (state.terrain[i] === DEEP) deep++;
      if (state.terrain[i] === BRITTLE) brittle++;
    }
    expect(deep).toBeGreaterThanOrEqual(2);
    expect(brittle).toBeGreaterThanOrEqual(2);
    expect(terrainAt(state, 0, 0)).toBe(ROCK);
    expect(terrainAt(state, -1, 0)).toBe(ROCK); // out of bounds reads as rock
  });
});

describe("water tiles", () => {
  it("treats plain water as claimable floor", () => {
    const state = createGame({ rows: HALL, seed: 1 });
    expect(terrainAt(state, 1, 1)).toBe(WATER);
  });
});
