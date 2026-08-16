/** pg-tidefort — 潮汐要塞 (Metroidvania) */

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function mulberry32(a) {
  return function() {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function deep(o) { return JSON.parse(JSON.stringify(o)); }


export function createGame({ seed = 1 } = {}) {
  return { seed, turn: 0, score: 0, level: 1, meter: 0, resources: 10, flags: {}, log: ["潮汐要塞：探索／能力"], outcome: "playing", msg: "潮汐要塞：探索／能力" };
}
export function getLegalActions(s) {
  if (s.outcome !== "playing") return [];
  return ["left","right","jump","ability"];
}
export function applyAction(state, action) {
  const s = deep(state);
  if (s.outcome !== "playing") return s;
  const rnd = mulberry32(s.seed + s.turn * 19);
  s.turn++;
  
  s.flags.abilities = s.flags.abilities ?? [];
  s.flags.room = s.flags.room ?? 0;
  if (action === "ability") {
    if (!(s.flags.abilities.includes("dash")) && s.flags.room >= 2) { s.flags.abilities.push("dash"); s.msg = "習得衝刺"; }
    else if (!(s.flags.abilities.includes("swim")) && s.flags.room >= 4) { s.flags.abilities.push("swim"); s.msg = "習得潛泳"; }
    else s.msg = "此處無能力石";
  } else {
    s.flags.room = clamp(s.flags.room + (action === "left" ? -1 : 1), 0, 6);
    s.meter = s.flags.room * 15 + s.flags.abilities.length * 20;
    s.msg = "房間 "+s.flags.room+" 能力:"+s.flags.abilities.join("/");
    s.score += 5;
  }
  if (s.flags.abilities.length >= 2 && s.flags.room >= 6) { s.level = 5; s.meter = 100; }

  if (s.resources < 0) s.resources = 0;
  if (s.outcome === "playing" && s.level >= 5 && s.meter >= 100) {
    s.outcome = "won";
    s.msg = "目標達成！";
  }
  if (s.outcome === "playing" && (s.resources <= 0 && s.meter < 20 && s.turn > 8)) {
    s.outcome = "lost";
    s.msg = "資源崩盤";
  }
  return s;
}
export function summarize(s) {
  return { turn: s.turn, level: s.level, meter: s.meter, score: s.score, resources: s.resources, msg: s.msg, outcome: s.outcome, flags: s.flags };
}
export function getOutcome(s) { return s.outcome; }

