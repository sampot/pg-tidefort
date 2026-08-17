import {
  ROCK,
  WATER,
  DEEP,
  BRITTLE,
  VENT,
  CORE,
  HELD,
  TRAIL,
  SHRINE_DASH,
  SHRINE_SWIM,
  SHRINE_SURGE,
} from "./tiles.js";
import { entityPos } from "./game.js";

const TILE = 20;

const SPRITE_FILES = {
  keeper: "./assets/sprites/keeper.png",
  wraith: "./assets/sprites/wraith.png",
  eel: "./assets/sprites/eel.png",
  swirl: "./assets/sprites/swirl.png",
  core: "./assets/sprites/core.png",
};

const SHRINE_COLORS = {
  [SHRINE_DASH]: "#ffb703",
  [SHRINE_SWIM]: "#4cc9f0",
  [SHRINE_SURGE]: "#c77dff",
};

const SHRINE_GLYPH = {
  [SHRINE_DASH]: "躍",
  [SHRINE_SWIM]: "泳",
  [SHRINE_SURGE]: "閘",
};

function loadSprites() {
  const sprites = {};
  for (const [key, src] of Object.entries(SPRITE_FILES)) {
    const image = new Image();
    image.src = src;
    sprites[key] = image;
  }
  return sprites;
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext("2d");
  const sprites = loadSprites();
  let ripples = [];
  let sparks = [];
  let flash = 0;
  let flashColor = "#ff5d73";
  let sized = "";

  function fit(state) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const key = `${state.width}x${state.height}@${dpr}`;
    if (sized !== key) {
      canvas.width = Math.round(state.width * TILE * dpr);
      canvas.height = Math.round(state.height * TILE * dpr);
      canvas.style.aspectRatio = `${state.width} / ${state.height}`;
      sized = key;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }

  function sprite(key, cx, cy, size, alpha = 1) {
    const image = sprites[key];
    if (!image || !image.complete || !image.naturalWidth) return false;
    ctx.globalAlpha = alpha;
    ctx.drawImage(image, cx - size / 2, cy - size / 2, size, size);
    ctx.globalAlpha = 1;
    return true;
  }

  function drawTerrain(state, time) {
    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) {
        const i = y * state.width + x;
        const terrain = state.terrain[i];
        const owner = state.owner[i];
        const px = x * TILE;
        const py = y * TILE;

        if (terrain === ROCK) {
          ctx.fillStyle = "#16202f";
          ctx.fillRect(px, py, TILE, TILE);
          ctx.fillStyle = "#212f43";
          ctx.fillRect(px, py, TILE, 3);
          continue;
        }

        if (owner === HELD) {
          ctx.fillStyle = "#10645c";
          ctx.fillRect(px, py, TILE, TILE);
          ctx.fillStyle = "#1b9587";
          ctx.fillRect(px + 1, py + 1, TILE - 2, TILE - 3);
          ctx.fillStyle = "#28c0ac";
          ctx.fillRect(px + 1, py + 1, TILE - 2, 2);
          continue;
        }

        if (terrain === VENT) {
          const pulse = 0.55 + 0.45 * Math.sin(time * 3 + x + y);
          ctx.fillStyle = "#2a0f1b";
          ctx.fillRect(px, py, TILE, TILE);
          const grad = ctx.createRadialGradient(px + TILE / 2, py + TILE / 2, 1, px + TILE / 2, py + TILE / 2, TILE);
          grad.addColorStop(0, `rgba(255,138,76,${0.75 * pulse})`);
          grad.addColorStop(1, "rgba(255,90,60,0)");
          ctx.fillStyle = grad;
          ctx.fillRect(px - TILE / 2, py - TILE / 2, TILE * 2, TILE * 2);
          continue;
        }

        if (terrain === BRITTLE) {
          ctx.fillStyle = "#3d2b4c";
          ctx.fillRect(px, py, TILE, TILE);
          ctx.strokeStyle = state.abilities.dash ? "#ffd166" : "#6a5378";
          ctx.lineWidth = state.abilities.dash ? 2 : 1;
          ctx.beginPath();
          ctx.moveTo(px + 3, py + 2);
          ctx.lineTo(px + TILE - 6, py + TILE / 2);
          ctx.lineTo(px + 5, py + TILE - 2);
          ctx.stroke();
          continue;
        }

        // open water, deep channel, shrine floor and the core chamber
        const wave = Math.sin(time * 1.6 + x * 0.5 + y * 0.35);
        if (terrain === DEEP) {
          ctx.fillStyle = state.abilities.swim ? "#0a2d4b" : "#04162a";
          ctx.fillRect(px, py, TILE, TILE);
          ctx.strokeStyle = `rgba(120,205,255,${0.14 + 0.1 * (wave + 1)})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(px + 2, py + TILE / 2 + wave * 2);
          ctx.lineTo(px + TILE - 2, py + TILE / 2 - wave * 2);
          ctx.stroke();
        } else {
          ctx.fillStyle = "#0b2c42";
          ctx.fillRect(px, py, TILE, TILE);
          ctx.fillStyle = `rgba(86,182,220,${0.07 + 0.05 * (wave + 1)})`;
          ctx.fillRect(px, py + TILE / 2, TILE, TILE / 2);
        }

        if (owner === TRAIL) {
          const glow = 0.6 + 0.4 * Math.sin(time * 9);
          ctx.fillStyle = `rgba(99,244,255,${0.5 + 0.3 * glow})`;
          ctx.fillRect(px + 2, py + 2, TILE - 4, TILE - 4);
          ctx.fillStyle = "rgba(240,255,255,0.9)";
          ctx.fillRect(px + TILE / 2 - 2, py + TILE / 2 - 2, 4, 4);
        }
      }
    }
  }

  function drawFeatures(state, time) {
    const bob = Math.sin(time * 2.2) * 2;
    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) {
        const terrain = state.terrain[y * state.width + x];
        const cx = x * TILE + TILE / 2;
        const cy = y * TILE + TILE / 2;

        if (terrain === CORE) {
          const lit = state.coreLit;
          const halo = ctx.createRadialGradient(cx, cy, 2, cx, cy, TILE * (lit ? 2.4 : 1.6));
          halo.addColorStop(0, lit ? "rgba(140,255,240,0.85)" : "rgba(89,217,255,0.5)");
          halo.addColorStop(1, "rgba(89,217,255,0)");
          ctx.fillStyle = halo;
          ctx.fillRect(cx - TILE * 2.5, cy - TILE * 2.5, TILE * 5, TILE * 5);
          sprite("core", cx, cy + bob * 0.4, TILE * 1.2);
          continue;
        }

        const color = SHRINE_COLORS[terrain];
        if (!color) continue;
        ctx.save();
        ctx.translate(cx, cy + bob * 0.5);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.moveTo(0, -TILE * 0.45);
        ctx.lineTo(TILE * 0.36, 0);
        ctx.lineTo(0, TILE * 0.45);
        ctx.lineTo(-TILE * 0.36, 0);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#0b1a24";
        ctx.font = "bold 10px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(SHRINE_GLYPH[terrain], 0, 1);
        ctx.restore();
      }
    }
  }

  function drawEntities(state, time) {
    for (const enemy of state.enemies) {
      const pos = entityPos(enemy);
      const cx = (pos.x + 0.5) * TILE;
      const cy = (pos.y + 0.5) * TILE + Math.sin(time * 5 + enemy.id) * 1.5;
      if (state.freeze > 0) {
        ctx.fillStyle = "rgba(150,230,255,0.35)";
        ctx.beginPath();
        ctx.arc(cx, cy, TILE * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
      if (!sprite(enemy.type, cx, cy, TILE * 1.05)) {
        ctx.fillStyle = "#ff6b8a";
        ctx.beginPath();
        ctx.arc(cx, cy, TILE * 0.35, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const keeper = state.keeper;
    const pos = entityPos(keeper);
    const cx = (pos.x + 0.5) * TILE;
    const cy = (pos.y + 0.5) * TILE;
    if (keeper.dashT > 0) {
      ctx.fillStyle = "rgba(255,209,102,0.35)";
      ctx.beginPath();
      ctx.arc(cx, cy, TILE * 0.85, 0, Math.PI * 2);
      ctx.fill();
    }
    const blink = keeper.invuln > 0 && Math.floor(time * 12) % 2 === 0;
    if (!sprite("keeper", cx, cy, TILE * 1.15, blink ? 0.35 : 1)) {
      ctx.fillStyle = "#ffd166";
      ctx.fillRect(cx - TILE * 0.3, cy - TILE * 0.4, TILE * 0.6, TILE * 0.8);
    }
  }

  function drawFx(dt) {
    for (const ripple of ripples) {
      ripple.t += dt;
      const life = ripple.t / ripple.life;
      if (life >= 1) continue;
      ctx.strokeStyle = `rgba(${ripple.rgb},${(1 - life) * 0.8})`;
      ctx.lineWidth = 3 * (1 - life) + 1;
      ctx.beginPath();
      ctx.arc(ripple.x, ripple.y, ripple.r + life * ripple.spread, 0, Math.PI * 2);
      ctx.stroke();
    }
    ripples = ripples.filter((r) => r.t < r.life);

    for (const spark of sparks) {
      spark.t += dt;
      const life = spark.t / spark.life;
      if (life >= 1) continue;
      ctx.fillStyle = `rgba(${spark.rgb},${1 - life})`;
      const x = spark.x + spark.vx * spark.t;
      const y = spark.y + spark.vy * spark.t;
      ctx.fillRect(x - 2, y - 2, 4, 4);
    }
    sparks = sparks.filter((s) => s.t < s.life);

    if (flash > 0) {
      flash = Math.max(0, flash - dt * 2.5);
      ctx.fillStyle = flashColor;
      ctx.globalAlpha = flash * 0.35;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
    }
  }

  return {
    tile: TILE,

    /** Turn a rules event into something the player can see. */
    fx(event, state) {
      const pos = entityPos(state.keeper);
      const x = (pos.x + 0.5) * TILE;
      const y = (pos.y + 0.5) * TILE;
      if (event.type === "seal") {
        ripples.push({ x, y, r: TILE, spread: TILE * 9, t: 0, life: 0.9, rgb: "104,255,226" });
      } else if (event.type === "core") {
        ripples.push({ x, y, r: TILE, spread: TILE * 14, t: 0, life: 1.4, rgb: "140,255,255" });
      } else if (event.type === "purge" || event.type === "smash") {
        for (let i = 0; i < 10; i++) {
          const angle = (Math.PI * 2 * i) / 10;
          sparks.push({
            x,
            y,
            vx: Math.cos(angle) * 90,
            vy: Math.sin(angle) * 90,
            t: 0,
            life: 0.45,
            rgb: event.type === "purge" ? "255,214,120" : "200,170,255",
          });
        }
      } else if (event.type === "breach") {
        flash = 1;
        flashColor = "#ff4d6d";
      } else if (event.type === "cut") {
        flash = 0.65;
        flashColor = "#ffa14d";
      } else if (event.type === "erode") {
        flash = 0.5;
        flashColor = "#2f8fd0";
      } else if (event.type === "surge") {
        ripples.push({ x, y, r: TILE, spread: TILE * 16, t: 0, life: 1.1, rgb: "180,230,255" });
      }
    },

    draw(state, time, dt) {
      fit(state);
      ctx.fillStyle = "#04101c";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      drawTerrain(state, time);
      drawFeatures(state, time);
      drawEntities(state, time);
      drawFx(dt);
    },
  };
}
