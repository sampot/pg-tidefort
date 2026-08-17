import { describe, it, expect, vi } from "vitest";
import { createStore, BEST_KEY, RUNS_KEY } from "../src/persist.js";

function fakePg(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    kv: {
      get: vi.fn(async (key) => (data.has(key) ? data.get(key) : null)),
      put: vi.fn(async (key, value) => {
        if (typeof value !== "string") throw new TypeError("kv values must be strings");
        data.set(key, value);
      }),
    },
    data,
  };
}

describe("progress store", () => {
  it("reads the best score and run count from PG.kv", async () => {
    const pg = fakePg({ [BEST_KEY]: "1250", [RUNS_KEY]: "4" });
    const store = createStore(pg);
    const progress = await store.load();
    expect(progress).toEqual({ best: 1250, runs: 4, online: true });
  });

  it("starts from zero when nothing is stored yet", async () => {
    const store = createStore(fakePg());
    expect(await store.load()).toEqual({ best: 0, runs: 0, online: true });
  });

  it("writes strings only, and keeps the higher score", async () => {
    const pg = fakePg({ [BEST_KEY]: "500" });
    const store = createStore(pg);
    await store.load();
    const saved = await store.record(900);
    expect(pg.data.get(BEST_KEY)).toBe("900");
    expect(saved.best).toBe(900);
    const lower = await store.record(100);
    expect(pg.data.get(BEST_KEY)).toBe("900");
    expect(lower.best).toBe(900);
    expect(lower.runs).toBe(2);
  });

  it("degrades to an in-memory best when the platform rejects the write", async () => {
    const pg = fakePg();
    pg.kv.put = vi.fn(async () => {
      const error = new Error("no leader");
      error.code = "functions_no_leader";
      throw error;
    });
    const store = createStore(pg);
    await store.load();
    const saved = await store.record(400);
    expect(saved.best).toBe(400);
    expect(saved.online).toBe(false);
    expect(saved.error).toBe("functions_no_leader");
  });

  it("still plays when no platform is present at all", async () => {
    const store = createStore(undefined);
    const progress = await store.load();
    expect(progress).toEqual({ best: 0, runs: 0, online: false });
    const saved = await store.record(300);
    expect(saved.best).toBe(300);
    expect(saved.online).toBe(false);
  });
});
