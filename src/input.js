export const DEAD_ZONE = 0.16;

const KEY_AXES = {
  ArrowLeft: ["x", -1],
  ArrowRight: ["x", 1],
  ArrowUp: ["y", -1],
  ArrowDown: ["y", 1],
  a: ["x", -1],
  d: ["x", 1],
  w: ["y", -1],
  s: ["y", 1],
};

const KEY_ACTIONS = {
  " ": "dash",
  Enter: "dash",
  j: "dash",
  Shift: "surge",
  k: "surge",
};

function normalizeKey(key) {
  if (typeof key !== "string") return "";
  return key.length === 1 ? key.toLowerCase() : key;
}

export function makeInput() {
  return {
    moveX: 0,
    moveY: 0,
    dash: false,
    surge: false,
    keys: new Set(),
    keyOrder: [],
    latch: { x: 0, y: 0, t: 0 },
    stick: { active: false, pointerId: null, cx: 0, cy: 0, dx: 0, dy: 0, radius: 44 },
  };
}

/**
 * A quick key tap would otherwise start and end between two frames and move
 * nothing, so a tap keeps its direction alive just long enough for one step.
 */
export function latchTap(input, seconds = 0.18) {
  if (!input.moveX && !input.moveY) return input;
  input.latch = { x: input.moveX, y: input.moveY, t: seconds };
  return input;
}

export function tickLatch(input, dt) {
  const latch = input.latch;
  if (!latch || latch.t <= 0) return input;
  if (input.stick.active || input.keyOrder.length) {
    latch.t = 0;
    return input;
  }
  latch.t -= dt;
  if (latch.t > 0) {
    input.moveX = latch.x;
    input.moveY = latch.y;
  } else {
    input.moveX = 0;
    input.moveY = 0;
  }
  return input;
}

function syncAxes(input) {
  if (input.stick.active) {
    input.moveX = input.stick.dx;
    input.moveY = input.stick.dy;
    return input;
  }
  let x = 0;
  let y = 0;
  for (const key of input.keyOrder) {
    const axis = KEY_AXES[key];
    if (!axis) continue;
    if (axis[0] === "x") x = axis[1];
    else y = axis[1];
  }
  input.moveX = x;
  input.moveY = y;
  return input;
}

/** Drag vector (CSS px) from the stick origin, clamped into the unit circle. */
export function applyStick(input, dx, dy, radius = 44) {
  const r = Math.max(8, radius);
  let nx = dx / r;
  let ny = dy / r;
  const mag = Math.hypot(nx, ny);
  if (mag > 1) {
    nx /= mag;
    ny /= mag;
  }
  input.stick.active = true;
  input.stick.dx = nx;
  input.stick.dy = ny;
  input.stick.radius = r;
  return syncAxes(input);
}

export function releaseStick(input) {
  input.stick.active = false;
  input.stick.pointerId = null;
  input.stick.dx = 0;
  input.stick.dy = 0;
  return syncAxes(input);
}

/** Returns true when the key belongs to the game, so the page can preventDefault. */
export function setKey(input, rawKey, down) {
  const key = normalizeKey(rawKey);
  if (KEY_AXES[key]) {
    input.keyOrder = input.keyOrder.filter((k) => k !== key);
    if (down) {
      input.keys.add(key);
      input.keyOrder.push(key);
    } else {
      input.keys.delete(key);
    }
    syncAxes(input);
    return true;
  }
  const action = KEY_ACTIONS[key];
  if (action) {
    if (down) {
      if (!input.keys.has(key)) input[action] = true;
      input.keys.add(key);
    } else {
      input.keys.delete(key);
    }
    return true;
  }
  return false;
}

/** Hard reset — used on pointercancel, blur and visibilitychange (no sticky keys). */
export function zeroInput(input) {
  input.moveX = 0;
  input.moveY = 0;
  input.dash = false;
  input.surge = false;
  input.keys.clear();
  input.keyOrder = [];
  input.latch = { x: 0, y: 0, t: 0 };
  input.stick.active = false;
  input.stick.pointerId = null;
  input.stick.dx = 0;
  input.stick.dy = 0;
  return input;
}
