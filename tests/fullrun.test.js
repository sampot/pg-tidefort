import { describe, expect, it } from "vitest";
import { createGame, step, summarize } from "../src/game.js";
import { makeInput, setKey, zeroInput } from "../src/input.js";
import { HELD, isClaimable } from "../src/tiles.js";
import { setOwner, terrainAt } from "../src/rules.js";

const DT = 1 / 60;

function hold(input, key, state, seconds) {
  setKey(input, key, true);
  for (let t = 0; t < seconds; t += DT) {
    step(state, DT, input);
    if (state.outcome !== "playing") break;
  }
  setKey(input, key, false);
  zeroInput(input);
}

describe("a whole run", () => {
  it("claims real ground by drawing a loop out into the water and back", () => {
    const state = createGame({ seed: 3 });
    state.enemies = [];
    const input = makeInput();
    const before = state.held;

    hold(input, "ArrowUp", state, 0.4);
    hold(input, "ArrowLeft", state, 1.6);
    hold(input, "ArrowDown", state, 0.5);
    hold(input, "ArrowRight", state, 1.7);

    expect(state.outcome).toBe("playing");
    expect(state.seals).toBeGreaterThan(0);
    expect(state.held).toBeGreaterThan(before + 8);
    expect(state.trail).toHaveLength(0);
    expect(summarize(state).score).toBeGreaterThan(0);
  });

  it("wins once the seal target is met and the core is lit", () => {
    const state = createGame({ seed: 3 });
    state.enemies = [];
    state.abilities = { dash: true, swim: true, surge: true };

    // Hand the keeper the ground it would otherwise have to claim by hand, then
    // let it swim the last stretch to the core under its own steam.
    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) {
        if (isClaimable(terrainAt(state, x, y))) setOwner(state, x, y, HELD);
      }
    }
    state.held = state.claimable;

    const core = state.map.core;
    state.keeper.x = core.x;
    state.keeper.y = core.y + 1;
    state.keeper.dir = null;
    state.keeper.prog = 0;

    const input = makeInput();
    hold(input, "ArrowUp", state, 1.2);

    expect(state.coreLit).toBe(true);
    expect(state.outcome).toBe("won");
    expect(state.events.some((e) => e.type === "won")).toBe(true);
  });

  it("loses when the tide tops out", () => {
    const state = createGame({ seed: 3 });
    state.enemies = [];
    state.tide = 99.6;
    const input = makeInput();
    for (let t = 0; t < 4; t += DT) {
      step(state, DT, input);
      if (state.outcome !== "playing") break;
    }
    expect(state.outcome).toBe("lost");
    expect(state.loss).toBe("flood");
  });
});
