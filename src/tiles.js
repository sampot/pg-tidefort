// Terrain codes. Terrain is what the fortress is built of; ownership (below) is
// who currently controls the tile, so sealing a room never destroys its contents.
export const ROCK = 0;
export const WATER = 1;
export const DEEP = 2;
export const BRITTLE = 3;
export const VENT = 4;
export const SHRINE_DASH = 5;
export const SHRINE_SWIM = 6;
export const SHRINE_SURGE = 7;
export const CORE = 8;

// Ownership codes.
export const OPEN = 0;
export const HELD = 1;
export const TRAIL = 2;

export const TILE_CHARS = {
  "#": ROCK,
  ".": WATER,
  "~": DEEP,
  "=": BRITTLE,
  V: VENT,
  D: SHRINE_DASH,
  S: SHRINE_SWIM,
  U: SHRINE_SURGE,
  C: CORE,
  "@": WATER,
};

export const SHRINE_ABILITY = {
  [SHRINE_DASH]: "dash",
  [SHRINE_SWIM]: "swim",
  [SHRINE_SURGE]: "surge",
};

export const ABILITY_LABELS = { dash: "潮躍", swim: "潛泳", surge: "潮閘" };

export function isShrine(terrain) {
  return terrain === SHRINE_DASH || terrain === SHRINE_SWIM || terrain === SHRINE_SURGE;
}

/** Floor the tide can flow across and creatures can swim through. */
export function isFloor(terrain) {
  return terrain === WATER || terrain === DEEP || terrain === CORE || isShrine(terrain);
}

/** Tiles that count towards the seal target. Brittle walls count: they become water. */
export function isClaimable(terrain) {
  return isFloor(terrain) || terrain === BRITTLE;
}

export function keeperCanEnter(terrain, abilities = {}, dashing = false) {
  if (terrain === DEEP) return !!abilities.swim;
  if (terrain === BRITTLE) return dashing && !!abilities.dash;
  return isFloor(terrain);
}
