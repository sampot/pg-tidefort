import { createGame, step, summarize, TARGET_SEAL } from "./src/game.js";
import { createRenderer } from "./src/render.js";
import { createAudio } from "./src/audio.js";
import { createStore } from "./src/persist.js";
import {
  makeInput,
  applyStick,
  releaseStick,
  setKey,
  zeroInput,
  latchTap,
  tickLatch,
} from "./src/input.js";

const PG = typeof window !== "undefined" ? window.PG : undefined;
if (PG && PG.ready) {
  try {
    await PG.ready;
  } catch {
    /* the run still works without platform storage */
  }
}

const $ = (id) => document.getElementById(id);
const el = {
  stage: $("stage"),
  touch: $("touch"),
  stick: $("stick"),
  knob: $("stick").firstElementChild,
  pad: $("pad"),
  gauges: $("gauges"),
  sealPct: $("seal-pct"),
  sealBar: $("seal-bar"),
  sealMark: $("seal-mark"),
  tidePct: $("tide-pct"),
  tideBar: $("tide-bar"),
  lives: $("lives"),
  score: $("score"),
  abilities: $("abilities"),
  ticker: $("ticker"),
  best: $("best"),
  runs: $("runs"),
  offline: $("offline"),
  dashState: $("dash-state"),
  surgeState: $("surge-state"),
  btnDash: $("btn-dash"),
  btnSurge: $("btn-surge"),
  btnStart: $("btn-start"),
  btnAgain: $("btn-again"),
  btnPause: $("btn-pause"),
  btnResume: $("btn-resume"),
  btnQuit: $("btn-quit"),
  btnHelp: $("btn-help"),
  btnHelpClose: $("btn-help-close"),
  btnSound: $("btn-sound"),
  panels: {
    menu: $("panel-menu"),
    pause: $("panel-pause"),
    over: $("panel-over"),
    help: $("panel-help"),
  },
  overTitle: $("over-title"),
  overDetail: $("over-detail"),
  overScore: $("over-score"),
  overSealed: $("over-sealed"),
  overBest: $("over-best"),
  overNote: $("over-note"),
};

const SFX_FOR = {
  seal: "seal",
  ability: "ability",
  core: "ability",
  dash: "dash",
  surge: "surge",
  smash: "smash",
  purge: "purge",
  breach: "breach",
  cut: "deny",
  deny: "deny",
  won: "win",
  lost: "lose",
};

const renderer = createRenderer(el.stage);
const audio = createAudio();
const store = createStore(PG);
const input = makeInput();

let progress = await store.load();
let state = createGame({ seed: Math.floor(Math.random() * 100000) });
let mode = "menu";
let raf = 0;
let last = 0;
let helpReturn = "menu";

/* ------------------------------------------------------------------ screens */

/** `null` means "no panel": the board is live, so the pad and pause show up. */
function showPanel(name) {
  for (const [key, node] of Object.entries(el.panels)) node.hidden = key !== name;
  const live = name === null;
  el.btnPause.hidden = !live;
  el.pad.hidden = !live;
  el.gauges.hidden = name === "menu";
}

function paintProgress() {
  el.best.textContent = String(progress.best || 0);
  el.runs.textContent = String(progress.runs || 0);
  el.offline.hidden = progress.online !== false;
}

function startRun() {
  void audio.unlock();
  audio.music(true);
  state = createGame({ seed: Math.floor(Math.random() * 100000) });
  input.stick.active = false;
  zeroInput(input);
  mode = "playing";
  showPanel(null);
  el.ticker.textContent = state.msg;
  loop(performance.now());
}

function pauseRun(reason) {
  if (mode !== "playing") return;
  mode = "paused";
  zeroInput(input);
  hideStick();
  cancelAnimationFrame(raf);
  raf = 0;
  last = 0;
  void audio.suspend();
  showPanel("pause");
  if (reason) el.ticker.textContent = reason;
}

function resumeRun() {
  if (mode !== "paused") return;
  zeroInput(input);
  mode = "playing";
  showPanel(null);
  void audio.resume();
  loop(performance.now());
}

async function finishRun() {
  mode = "over";
  cancelAnimationFrame(raf);
  raf = 0;
  last = 0;
  const view = summarize(state);
  audio.music(false);
  const won = view.outcome === "won";
  el.overTitle.textContent = won ? "要塞重新啟動！" : "要塞失守";
  el.overDetail.textContent = won
    ? `封存 ${Math.round(view.sealed * 100)}%、核心點亮，潮水退回外海。`
    : view.loss === "flood"
      ? "潮位滿溢，海水漫過所有廊道。"
      : "守塔者力竭，潮怨衝破了最後一道潮線。";
  el.overScore.textContent = String(view.score);
  el.overSealed.textContent = `${Math.round(view.sealed * 100)}%`;
  showPanel("over");

  progress = await store.record(view.score);
  paintProgress();
  el.overBest.textContent = String(progress.best);
  el.overNote.textContent =
    progress.online === false
      ? `分數未同步到平台（${progress.error || "無儲存"}），本局成績仍然有效。`
      : "";
}

/* --------------------------------------------------------------------- hud */

let hudCache = "";

function paintHud() {
  const view = summarize(state);
  const sealPct = Math.round(view.sealed * 100);
  el.sealBar.style.width = `${Math.min(100, view.sealed * 100)}%`;
  el.tideBar.style.width = `${Math.min(100, view.tide * 100)}%`;
  el.sealMark.style.left = `${TARGET_SEAL * 100}%`;

  const key = [
    sealPct,
    Math.round(view.tide * 100),
    view.lives,
    view.score,
    view.surge,
    view.dashReady,
    view.abilities.dash,
    view.abilities.swim,
    view.abilities.surge,
    view.coreLit,
    view.msg,
  ].join("|");
  if (key === hudCache) return;
  hudCache = key;

  el.sealPct.textContent = `${sealPct}%`;
  el.tidePct.textContent = `${Math.round(view.tide * 100)}%`;
  el.lives.textContent = "♥".repeat(Math.max(0, view.lives)) || "—";
  el.score.textContent = `${view.score} 分`;
  el.ticker.textContent = view.msg;

  for (const item of el.abilities.children) {
    const name = item.dataset.ability;
    const on = name === "core" ? view.coreLit : view.abilities[name];
    item.classList.toggle("on", !!on);
  }

  el.btnDash.disabled = !view.abilities.dash;
  el.btnDash.classList.toggle("ready", view.dashReady);
  el.dashState.textContent = view.abilities.dash ? (view.dashReady ? "可用" : "充能") : "鎖";
  el.btnSurge.disabled = !view.abilities.surge || view.surge <= 0;
  el.btnSurge.classList.toggle("ready", view.abilities.surge && view.surge > 0);
  el.surgeState.textContent = view.abilities.surge ? `×${view.surge}` : "鎖";
}

function drainEvents() {
  const events = state.events.splice(0, state.events.length);
  for (const event of events) {
    renderer.fx(event, state);
    const sfx = SFX_FOR[event.type];
    if (sfx) audio.play(sfx);
    if (event.type === "won" || event.type === "lost") void finishRun();
  }
}

/* -------------------------------------------------------------------- loop */

function loop(now) {
  if (mode !== "playing") return;
  raf = requestAnimationFrame(loop);
  const time = now / 1000;
  const dt = last ? Math.min(0.05, time - last) : 0;
  last = time;
  tickLatch(input, dt);
  step(state, dt, input);
  drainEvents();
  renderer.draw(state, time, dt);
  paintHud();
}

/* ------------------------------------------------------------------ inputs */

function hideStick() {
  el.stick.hidden = true;
  el.knob.style.setProperty("--kx", "0px");
  el.knob.style.setProperty("--ky", "0px");
}

const STICK_RADIUS = 44;
let stickOrigin = null;

el.touch.addEventListener("pointerdown", (event) => {
  if (mode !== "playing") return;
  event.preventDefault();
  el.touch.setPointerCapture(event.pointerId);
  const box = el.touch.getBoundingClientRect();
  stickOrigin = { id: event.pointerId, x: event.clientX, y: event.clientY };
  el.stick.style.left = `${event.clientX - box.left}px`;
  el.stick.style.top = `${event.clientY - box.top}px`;
  el.stick.hidden = false;
  applyStick(input, 0, 0, STICK_RADIUS);
});

el.touch.addEventListener("pointermove", (event) => {
  if (!stickOrigin || event.pointerId !== stickOrigin.id) return;
  const dx = event.clientX - stickOrigin.x;
  const dy = event.clientY - stickOrigin.y;
  applyStick(input, dx, dy, STICK_RADIUS);
  el.knob.style.setProperty("--kx", `${input.moveX * 22}px`);
  el.knob.style.setProperty("--ky", `${input.moveY * 22}px`);
});

function endStick(event) {
  if (!stickOrigin || (event && event.pointerId !== stickOrigin.id)) return;
  stickOrigin = null;
  releaseStick(input);
  hideStick();
}

el.touch.addEventListener("pointerup", endStick);
el.touch.addEventListener("pointercancel", endStick);
el.touch.addEventListener("lostpointercapture", endStick);

function request(action) {
  if (mode !== "playing") return;
  input[action] = true;
}

for (const [node, action] of [
  [el.btnDash, "dash"],
  [el.btnSurge, "surge"],
]) {
  node.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    request(action);
  });
  node.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      request(action);
    }
  });
}

window.addEventListener("keydown", (event) => {
  if (event.repeat && (event.key === " " || event.key === "Shift")) return;
  if (event.key === "Escape" || event.key === "p" || event.key === "P") {
    if (mode === "playing") pauseRun();
    else if (mode === "paused") resumeRun();
    return;
  }
  if (mode !== "playing") return;
  if (setKey(input, event.key, true)) {
    event.preventDefault();
    latchTap(input);
  }
});

window.addEventListener("keyup", (event) => {
  setKey(input, event.key, false);
});

/* -------------------------------------------------------------- life cycle */

function suspendAll() {
  zeroInput(input);
  hideStick();
  stickOrigin = null;
  if (mode === "playing") pauseRun("分頁離開，操作已歸零");
  else void audio.suspend();
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") suspendAll();
});
window.addEventListener("pagehide", suspendAll);
window.addEventListener("blur", () => {
  zeroInput(input);
  hideStick();
  stickOrigin = null;
});

/* ------------------------------------------------------------------ buttons */

el.btnStart.addEventListener("click", startRun);
el.btnAgain.addEventListener("click", startRun);
el.btnPause.addEventListener("click", () => pauseRun());
el.btnResume.addEventListener("click", resumeRun);
el.btnQuit.addEventListener("click", () => {
  mode = "menu";
  audio.music(false);
  showPanel("menu");
});
el.btnHelp.addEventListener("click", () => {
  helpReturn = mode;
  if (mode === "playing") pauseRun();
  showPanel("help");
});
el.btnHelpClose.addEventListener("click", () => {
  if (helpReturn === "playing" || helpReturn === "paused") showPanel("pause");
  else if (helpReturn === "over") showPanel("over");
  else showPanel("menu");
});
el.btnSound.addEventListener("click", () => {
  const on = audio.setEnabled(!audio.enabled);
  el.btnSound.setAttribute("aria-pressed", String(on));
  el.btnSound.textContent = on ? "♪ 音效" : "♩ 靜音";
});

/* --------------------------------------------------------------- first paint */

paintProgress();
showPanel("menu");
el.sealMark.style.left = `${TARGET_SEAL * 100}%`;
renderer.draw(state, 0, 0);
paintHud();
el.ticker.textContent = "封存 72% 並點亮核心，就能讓要塞重新啟動。";
