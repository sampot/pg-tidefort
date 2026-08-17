import { describe, expect, it } from "vitest";
import { createGame, TARGET_SEAL } from "../src/game.js";
import { countHeld, heldFraction, keeperReach, setOwner, terrainAt } from "../src/rules.js";
import { CORE, HELD, isClaimable } from "../src/tiles.js";

const ALL = { dash: true, swim: true, surge: true };

function claimableTiles(state) {
  const tiles = [];
  for (let y = 0; y < state.height; y++) {
    for (let x = 0; x < state.width; x++) {
      if (isClaimable(terrainAt(state, x, y))) tiles.push({ x, y });
    }
  }
  return tiles;
}

describe("the fortress is winnable", () => {
  it("lets a fully equipped keeper reach every claimable tile", () => {
    const state = createGame({ seed: 7 });
    const reach = keeperReach(state, ALL);
    const stranded = claimableTiles(state).filter(({ x, y }) => !reach[y * state.width + x]);
    expect(stranded).toEqual([]);
  });

  it("passes the seal target without needing to claim every last tile", () => {
    const state = createGame({ seed: 7 });
    const tiles = claimableTiles(state);
    const take = Math.floor(tiles.length * 0.85);
    for (let i = 0; i < take; i++) setOwner(state, tiles[i].x, tiles[i].y, HELD);
    state.held = countHeld(state);
    expect(heldFraction(state)).toBeGreaterThan(TARGET_SEAL);
  });

  it("keeps the core behind deep water so swim is required to light it", () => {
    const state = createGame({ seed: 7 });
    const core = state.map.core;
    expect(core).toBeTruthy();
    expect(terrainAt(state, core.x, core.y)).toBe(CORE);
    const index = core.y * state.width + core.x;
    expect(keeperReach(state, { dash: true, surge: true })[index]).toBeFalsy();
    expect(keeperReach(state, ALL)[index]).toBeTruthy();
  });

  it("keeps both gated shrines reachable in the intended order", () => {
    const state = createGame({ seed: 7 });
    const { dash, swim, surge } = state.map.shrines;
    expect([dash, swim, surge].every(Boolean)).toBe(true);
    const at = (reach, spot) => !!reach[spot.y * state.width + spot.x];
    const bare = keeperReach(state, {});
    const dashOnly = keeperReach(state, { dash: true });
    // 潮躍 sits in the open outer ring; 潛泳 and 潮閘 wait behind brittle
    // bulkheads that only a dash can smash.
    expect(at(bare, dash)).toBe(true);
    expect(at(bare, swim)).toBe(false);
    expect(at(dashOnly, swim)).toBe(true);
    expect(at(dashOnly, surge)).toBe(true);
  });
});
