import type { Hex, HexKey } from "./types";
import { hexKey } from "./types";

/** Axial hex neighbors */
const DIRS: Hex[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export function neighbors(h: Hex): Hex[] {
  return DIRS.map((d) => ({ q: h.q + d.q, r: h.r + d.r }));
}

export function hexDist(a: Hex, b: Hex): number {
  return (
    (Math.abs(a.q - b.q) +
      Math.abs(a.q + a.r - b.q - b.r) +
      Math.abs(a.r - b.r)) /
    2
  );
}

/**
 * Compact Whitechapel-inspired hex map (axial).
 * Streets form a connected district; buildings block (except Stealthy).
 */
export function buildMap() {
  const streetList: Hex[] = [
    // center cluster
    { q: 0, r: 0 },
    { q: 1, r: 0 },
    { q: 0, r: 1 },
    { q: -1, r: 1 },
    { q: -1, r: 0 },
    { q: 0, r: -1 },
    { q: 1, r: -1 },
    // ring
    { q: 2, r: -1 },
    { q: 2, r: 0 },
    { q: 1, r: 1 },
    { q: 0, r: 2 },
    { q: -1, r: 2 },
    { q: -2, r: 2 },
    { q: -2, r: 1 },
    { q: -2, r: 0 },
    { q: -1, r: -1 },
    { q: 0, r: -2 },
    { q: 1, r: -2 },
    { q: 2, r: -2 },
    // outer
    { q: 3, r: -2 },
    { q: 3, r: -1 },
    { q: 2, r: 1 },
    { q: 1, r: 2 },
    { q: -3, r: 1 },
    { q: -3, r: 2 },
    { q: -2, r: -1 },
    { q: 3, r: 0 },
    { q: -3, r: 0 },
  ];

  const buildings: Hex[] = [
    { q: 2, r: -3 },
    { q: -1, r: 3 },
    { q: 0, r: 3 },
  ];

  const gasSockets: Hex[] = [
    { q: 1, r: 0 },
    { q: -1, r: 1 },
    { q: 0, r: -1 },
    { q: 2, r: 0 },
    { q: -2, r: 1 },
    { q: 1, r: -2 },
  ];

  const manholes: Hex[] = [
    { q: 0, r: 0 },
    { q: 2, r: -1 },
    { q: -2, r: 2 },
    { q: 0, r: 2 },
  ];

  // Exits: outer street hexes
  const exits: Hex[] = [
    { q: 3, r: -2 },
    { q: 3, r: 0 },
    { q: -3, r: 0 },
    { q: -3, r: 2 },
    { q: 1, r: 2 },
    { q: -2, r: -1 },
  ];

  const streets = streetList.map(hexKey);
  const streetSet = new Set(streets);

  return {
    streets,
    streetSet,
    buildings: buildings.map(hexKey),
    gasSockets: gasSockets.map(hexKey),
    manholes: manholes.map(hexKey),
    exits: exits.map(hexKey),
  };
}

export function pixelPos(h: Hex, size = 28): { x: number; y: number } {
  const x = size * (Math.sqrt(3) * h.q + (Math.sqrt(3) / 2) * h.r);
  const y = size * ((3 / 2) * h.r);
  return { x, y };
}
