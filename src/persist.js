export const BEST_KEY = "tidefort:best";
export const RUNS_KEY = "tidefort:runs";

function toNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Progress lives in PG.kv. When the platform is missing or refuses a write the
 * run keeps its score in memory and the page says so — never a blocking dialog.
 */
export function createStore(pg) {
  const kv = pg && pg.kv ? pg.kv : null;
  let progress = { best: 0, runs: 0, online: !!kv };

  return {
    get current() {
      return { ...progress };
    },

    async load() {
      if (!kv) {
        progress = { best: 0, runs: 0, online: false };
        return { ...progress };
      }
      try {
        const [best, runs] = await Promise.all([kv.get(BEST_KEY), kv.get(RUNS_KEY)]);
        progress = { best: toNumber(best), runs: toNumber(runs), online: true };
      } catch (error) {
        progress = { best: 0, runs: 0, online: false, error: error?.code || "kv_error" };
      }
      return { ...progress };
    },

    async record(score) {
      progress.runs += 1;
      if (score > progress.best) progress.best = score;
      if (!kv) {
        progress.online = false;
        return { ...progress };
      }
      try {
        await kv.put(BEST_KEY, String(progress.best));
        await kv.put(RUNS_KEY, String(progress.runs));
        progress.online = true;
        delete progress.error;
      } catch (error) {
        progress.online = false;
        progress.error = error?.code || "kv_error";
      }
      return { ...progress };
    },
  };
}
