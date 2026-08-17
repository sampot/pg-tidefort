import { describe, it, expect } from "vitest";
import {
  makeInput,
  applyStick,
  releaseStick,
  setKey,
  zeroInput,
  latchTap,
  tickLatch,
  DEAD_ZONE,
} from "../src/input.js";

describe("virtual stick", () => {
  it("normalises the drag vector into the unit circle", () => {
    const input = makeInput();
    applyStick(input, 60, 0, 40);
    expect(input.moveX).toBe(1);
    expect(input.moveY).toBe(0);
    applyStick(input, 20, 20, 40);
    expect(Math.hypot(input.moveX, input.moveY)).toBeLessThanOrEqual(1);
    expect(input.moveX).toBeCloseTo(0.5, 5);
    expect(input.moveY).toBeCloseTo(0.5, 5);
  });

  it("keeps tiny drags below the dead zone", () => {
    const input = makeInput();
    applyStick(input, 2, 1, 40);
    expect(Math.hypot(input.moveX, input.moveY)).toBeLessThan(DEAD_ZONE);
  });

  it("zeroes movement when the finger lifts", () => {
    const input = makeInput();
    applyStick(input, 40, 40, 40);
    releaseStick(input);
    expect(input.moveX).toBe(0);
    expect(input.moveY).toBe(0);
  });
});

describe("keyboard", () => {
  it("maps opposite keys without sticking", () => {
    const input = makeInput();
    setKey(input, "ArrowRight", true);
    expect(input.moveX).toBe(1);
    setKey(input, "ArrowLeft", true);
    expect(input.moveX).toBe(-1);
    setKey(input, "ArrowLeft", false);
    expect(input.moveX).toBe(1);
    setKey(input, "ArrowRight", false);
    expect(input.moveX).toBe(0);
  });

  it("treats wasd like the arrows and raises action requests", () => {
    const input = makeInput();
    setKey(input, "w", true);
    expect(input.moveY).toBe(-1);
    setKey(input, "s", true);
    expect(input.moveY).toBe(1);
    setKey(input, " ", true);
    expect(input.dash).toBe(true);
    setKey(input, "Shift", true);
    expect(input.surge).toBe(true);
  });

  it("reports unhandled keys so the page can keep its own shortcuts", () => {
    const input = makeInput();
    expect(setKey(input, "Tab", true)).toBe(false);
    expect(setKey(input, "ArrowUp", true)).toBe(true);
  });
});

describe("tap latch", () => {
  it("keeps a tapped direction alive for one step", () => {
    const input = makeInput();
    setKey(input, "ArrowRight", true);
    latchTap(input, 0.18);
    setKey(input, "ArrowRight", false);
    expect(input.moveX).toBe(0);
    tickLatch(input, 1 / 60);
    expect(input.moveX).toBe(1);
    tickLatch(input, 0.2);
    expect(input.moveX).toBe(0);
  });

  it("gives way as soon as a real control is held", () => {
    const input = makeInput();
    setKey(input, "ArrowUp", true);
    latchTap(input, 0.18);
    tickLatch(input, 1 / 60);
    expect(input.latch.t).toBe(0);
    expect(input.moveY).toBe(-1); // still held, so the key wins
  });

  it("never latches a neutral stick", () => {
    const input = makeInput();
    latchTap(input, 0.18);
    expect(input.latch.t).toBe(0);
  });
});

describe("suspend", () => {
  it("clears every held control when the page hides", () => {
    const input = makeInput();
    setKey(input, "ArrowRight", true);
    setKey(input, " ", true);
    applyStick(input, 40, 10, 40);
    zeroInput(input);
    expect(input).toMatchObject({ moveX: 0, moveY: 0, dash: false, surge: false });
    expect(input.keys.size).toBe(0);
    expect(input.stick.active).toBe(false);
  });
});
