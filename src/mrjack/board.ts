import type { Hex, HexKey } from "./types";
import { hexKey } from "./types";

/**
 * Whitechapel district — layout matching the official Mr. Jack board hex graph
 * (13 vertical columns, 86 hexes: streets, buildings, gas sockets, manholes, 4 exits).
 *
 * Coordinates are odd-q vertical offset (q = column, r = row).
 */

/** Six directions in cube space (pointy-top); used for Watson’s lantern ray. */
export const CUBE_DIRS: Array<{ x: number; y: number; z: number }> = [
  { x: +1, y: -1, z: 0 },
  { x: +1, y: 0, z: -1 },
  { x: 0, y: +1, z: -1 },
  { x: -1, y: +1, z: 0 },
  { x: -1, y: 0, z: +1 },
  { x: 0, y: -1, z: +1 },
];

/** @deprecated use neighbors(); kept for code that indexes direction 0–5 */
export const DIRS: Hex[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

function oddqToCube(col: number, row: number) {
  const x = col;
  const z = row - (col - (col & 1)) / 2;
  const y = -x - z;
  return { x, y, z };
}

function cubeToOddq(x: number, z: number): Hex {
  const col = x;
  const row = z + (col - (col & 1)) / 2;
  return { q: col, r: row };
}

/** Neighbours of an odd-q offset hex */
export function neighbors(h: Hex): Hex[] {
  const c = oddqToCube(h.q, h.r);
  return CUBE_DIRS.map((d) => cubeToOddq(c.x + d.x, c.z + d.z));
}

export function hexDist(a: Hex, b: Hex): number {
  const A = oddqToCube(a.q, a.r);
  const B = oddqToCube(b.q, b.r);
  return (
    (Math.abs(A.x - B.x) + Math.abs(A.y - B.y) + Math.abs(A.z - B.z)) / 2
  );
}

/** Step one hex from `h` along Watson lantern direction index 0–5 */
export function stepInDir(h: Hex, dirIndex: number): Hex {
  const d = CUBE_DIRS[((dirIndex % 6) + 6) % 6]!;
  const c = oddqToCube(h.q, h.r);
  return cubeToOddq(c.x + d.x, c.z + d.z);
}

/** Official starting positions for the 8 characters */
export const OFFICIAL_STARTS: Record<
  | "holmes"
  | "watson"
  | "smith"
  | "lestrade"
  | "stealthy"
  | "gull"
  | "bert"
  | "goodley",
  Hex
> = {
  lestrade: { q: 4, r: 2 },
  stealthy: { q: 0, r: 2 },
  bert: { q: 8, r: 1 },
  watson: { q: 8, r: 5 },
  holmes: { q: 6, r: 3 },
  smith: { q: 6, r: 0 },
  goodley: { q: 12, r: 1 },
  gull: { q: 4, r: -2 },
};

/** 6 of 8 gas sockets lit at setup */
export const SETUP_LIT_GAS: Hex[] = [
  { q: 1, r: 3 },
  { q: 11, r: -1 },
  { q: 2, r: -1 },
  { q: 10, r: 4 },
  { q: 5, r: 2 },
  { q: 7, r: 0 },
];

/** Two manhole covers at setup (Bert moves them) */
export const SETUP_COVERED_MANHOLES: Hex[] = [
  { q: 1, r: 4 },
  { q: 11, r: -2 },
];

/** Two police cordons at setup (Lestrade moves them) — NW & SE exits blocked */
export const SETUP_CORDONED_EXITS: Hex[] = [
  { q: 11, r: -2 },
  { q: 1, r: 4 },
];

export function buildMap() {
  // Walkable street hexes (including manhole streets + exit hexes)
  const streetList: Hex[] = [
    { q: 0, r: 0 },
    { q: 0, r: 1 },
    { q: 0, r: 2 },
    { q: 0, r: 3 },
    { q: 0, r: 4 },
    { q: 1, r: -2 },
    { q: 1, r: -1 },
    { q: 1, r: 2 },
    { q: 1, r: 4 },
    { q: 2, r: 0 },
    { q: 2, r: 2 },
    { q: 2, r: 3 },
    { q: 2, r: 4 },
    { q: 3, r: -1 },
    { q: 3, r: 1 },
    { q: 3, r: 3 },
    { q: 4, r: -2 },
    { q: 4, r: -1 },
    { q: 4, r: 0 },
    { q: 4, r: 1 },
    { q: 4, r: 2 },
    { q: 4, r: 3 },
    { q: 4, r: 4 },
    { q: 5, r: -3 },
    { q: 5, r: 0 },
    { q: 5, r: 4 },
    { q: 6, r: -2 },
    { q: 6, r: -1 },
    { q: 6, r: 0 },
    { q: 6, r: 1 },
    { q: 6, r: 2 },
    { q: 6, r: 3 },
    { q: 6, r: 4 },
    { q: 6, r: 5 },
    { q: 7, r: -2 },
    { q: 7, r: 2 },
    { q: 7, r: 5 },
    { q: 8, r: -1 },
    { q: 8, r: 0 },
    { q: 8, r: 1 },
    { q: 8, r: 2 },
    { q: 8, r: 3 },
    { q: 8, r: 4 },
    { q: 8, r: 5 },
    { q: 9, r: -1 },
    { q: 9, r: 1 },
    { q: 9, r: 3 },
    { q: 10, r: -1 },
    { q: 10, r: 0 },
    { q: 10, r: 1 },
    { q: 10, r: 3 },
    { q: 11, r: -2 },
    { q: 11, r: 0 },
    { q: 11, r: 3 },
    { q: 11, r: 4 },
    { q: 12, r: -1 },
    { q: 12, r: 0 },
    { q: 12, r: 1 },
    { q: 12, r: 2 },
    { q: 12, r: 3 },
  ];

  // Building hexes (impassable except Miss Stealthy crossing)
  const buildings: Hex[] = [
    { q: 1, r: 0 },
    { q: 1, r: 1 },
    { q: 2, r: 1 },
    { q: 3, r: -2 },
    { q: 3, r: 0 },
    { q: 3, r: 2 },
    { q: 5, r: -1 },
    { q: 5, r: 1 },
    { q: 5, r: 3 },
    { q: 7, r: -1 },
    { q: 7, r: 1 },
    { q: 7, r: 3 },
    { q: 9, r: 0 },
    { q: 9, r: 2 },
    { q: 9, r: 4 },
    { q: 10, r: 2 },
    { q: 11, r: 1 },
    { q: 11, r: 2 },
  ];

  // 8 gaslight sockets (not walkable; light adjacent streets when lit)
  const gasSockets: Hex[] = [
    { q: 1, r: 3 },
    { q: 2, r: -1 },
    { q: 5, r: -2 },
    { q: 5, r: 2 },
    { q: 7, r: 0 },
    { q: 7, r: 4 },
    { q: 10, r: 4 },
    { q: 11, r: -1 },
  ];

  // 9 manhole hexes (on streets)
  const manholes: Hex[] = [
    { q: 1, r: -1 },
    { q: 1, r: 4 },
    { q: 2, r: 2 },
    { q: 5, r: -3 },
    { q: 6, r: 2 },
    { q: 7, r: 5 },
    { q: 10, r: 1 },
    { q: 11, r: -2 },
    { q: 11, r: 3 },
  ];

  // 4 corner exits
  const exits: Hex[] = [
    { q: 1, r: -2 }, // NW
    { q: 1, r: 4 }, // SW
    { q: 11, r: -2 }, // NE
    { q: 11, r: 4 }, // SE
  ];

  const streets = streetList.map(hexKey);
  for (const e of exits.map(hexKey)) {
    if (!streets.includes(e)) streets.push(e);
  }

  return {
    streets,
    streetSet: new Set(streets),
    buildings: buildings.map(hexKey),
    gasSockets: gasSockets.map(hexKey),
    manholes: manholes.map(hexKey),
    exits: exits.map(hexKey),
  };
}

export function pixelPos(h: Hex, size = 28): { x: number; y: number } {
  // odd-q vertical layout (pointy-top columns)
  const x = size * ((3 / 2) * h.q);
  const y = size * (Math.sqrt(3) * (h.r + 0.5 * (h.q & 1)));
  return { x, y };
}
