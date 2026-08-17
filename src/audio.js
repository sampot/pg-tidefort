const SFX = {
  seal: { src: "./assets/sfx/seal.ogg", gain: 0.55 },
  deny: { src: "./assets/sfx/deny.ogg", gain: 0.35 },
  ability: { src: "./assets/sfx/ability.ogg", gain: 0.6 },
  dash: { src: "./assets/sfx/dash.ogg", gain: 0.35 },
  surge: { src: "./assets/sfx/surge.ogg", gain: 0.5 },
  smash: { src: "./assets/sfx/smash.ogg", gain: 0.5 },
  purge: { src: "./assets/sfx/purge.ogg", gain: 0.45 },
  breach: { src: "./assets/sfx/breach.ogg", gain: 0.5 },
  win: { src: "./assets/sfx/win.ogg", gain: 0.6 },
  lose: { src: "./assets/sfx/lose.ogg", gain: 0.55 },
};

const MUSIC = { src: "./assets/music/tide-loop.ogg", gain: 0.3 };

/**
 * Web Audio wrapper. Nothing is fetched or decoded before the first gesture, and
 * everything pauses when the page hides (see §3.5 of the house rules).
 */
export function createAudio() {
  let ctx = null;
  let master = null;
  let musicGain = null;
  let musicBuffer = null;
  let musicNode = null;
  let enabled = true;
  let wantsMusic = false;
  const buffers = new Map();

  async function decode(src) {
    const response = await fetch(src);
    const bytes = await response.arrayBuffer();
    return await ctx.decodeAudioData(bytes);
  }

  async function prepare() {
    if (ctx) return true;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return false;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = enabled ? 1 : 0;
    master.connect(ctx.destination);
    musicGain = ctx.createGain();
    musicGain.gain.value = MUSIC.gain;
    musicGain.connect(master);

    await Promise.all(
      Object.entries(SFX).map(async ([name, def]) => {
        try {
          buffers.set(name, await decode(def.src));
        } catch {
          /* a missing clip must never break the run */
        }
      }),
    );
    try {
      musicBuffer = await decode(MUSIC.src);
    } catch {
      musicBuffer = null;
    }
    if (wantsMusic) startMusic();
    return true;
  }

  function startMusic() {
    wantsMusic = true;
    if (!ctx || !musicBuffer || musicNode) return;
    musicNode = ctx.createBufferSource();
    musicNode.buffer = musicBuffer;
    musicNode.loop = true;
    musicNode.connect(musicGain);
    musicNode.start();
  }

  function stopMusic() {
    wantsMusic = false;
    if (!musicNode) return;
    try {
      musicNode.stop();
    } catch {
      /* already stopped */
    }
    musicNode.disconnect();
    musicNode = null;
  }

  return {
    get enabled() {
      return enabled;
    },

    async unlock() {
      const ok = await prepare();
      if (ok && ctx.state === "suspended") await ctx.resume();
      return ok;
    },

    play(name) {
      if (!enabled || !ctx || ctx.state !== "running") return;
      const buffer = buffers.get(name);
      if (!buffer) return;
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      gain.gain.value = SFX[name]?.gain ?? 0.5;
      source.buffer = buffer;
      source.connect(gain);
      gain.connect(master);
      source.start();
    },

    music(on) {
      if (on) startMusic();
      else stopMusic();
    },

    setEnabled(on) {
      enabled = on;
      if (master) master.gain.value = on ? 1 : 0;
      return enabled;
    },

    async suspend() {
      if (ctx && ctx.state === "running") await ctx.suspend();
    },

    async resume() {
      if (ctx && ctx.state === "suspended") await ctx.resume();
    },
  };
}
