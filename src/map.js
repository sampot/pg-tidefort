import { TILE_CHARS, ROCK, VENT, CORE, SHRINE_ABILITY, isClaimable, isShrine } from "./tiles.js";

/**
 * 潮汐要塞: three concentric rings.
 *   outer ring  — open water, the keeper starts here (`@`), two tide vents (`V`)
 *                 and the 潮躍 shrine (`D`)
 *   brittle ring— `=` bulkheads, only a dash can smash them open
 *   middle ring — 潛泳 (`S`) and 潮閘 (`U`) shrines, two more vents
 *   deep moat   — a closed ring of `~` channels; only swimming crosses it
 *   inner vault — the tide core (`C`), so lighting it always needs 潛泳
 */
export const FORTRESS_ROWS = [
  "#####################",
  "#...................#",
  "#..V..##..D..##..V..#",
  "#...................#",
  "#...######=######...#",
  "#...#...........#...#",
  "#...#.V...S...#.#...#",
  "#...#...........#...#",
  "#...#...~~~~~...#...#",
  "#...#...~...~...#...#",
  "#...=...~.C.~...=...#",
  "#...#...~...~...#...#",
  "#...#...~~~~~...#...#",
  "#...#...........#...#",
  "#...#.#...U...V.#...#",
  "#...#...........#...#",
  "#...######=######...#",
  "#...................#",
  "#..#..##..@..##..#..#",
  "#...................#",
  "#####################",
];

export function parseMap(rows = FORTRESS_ROWS) {
  const height = rows.length;
  const width = rows[0].length;
  const terrain = new Uint8Array(width * height);
  const vents = [];
  const shrines = {};
  let start = null;
  let core = null;
  let claimable = 0;

  for (let y = 0; y < height; y++) {
    const row = rows[y];
    if (row.length !== width) throw new Error(`map row ${y} is ${row.length} wide, expected ${width}`);
    for (let x = 0; x < width; x++) {
      const char = row[x];
      const tile = TILE_CHARS[char];
      if (tile === undefined) throw new Error(`unknown map char "${char}" at ${x},${y}`);
      terrain[y * width + x] = tile;
      if (char === "@") start = { x, y };
      if (tile === VENT) vents.push({ x, y });
      if (tile === CORE) core = { x, y };
      if (isShrine(tile)) shrines[SHRINE_ABILITY[tile]] = { x, y };
      if (isClaimable(tile)) claimable++;
    }
  }

  if (!start) throw new Error("map has no start (@)");
  if (terrain[start.y * width + start.x] === ROCK) throw new Error("start is inside rock");

  return { width, height, terrain, start, core, vents, shrines, claimable };
}
