import seedrandom from "seedrandom";

export function shuffle<T>(array: T[], seed: string): T[] {
  const rng = seedrandom.alea(seed);
  const reverse = new Map<number, number>();

  array.forEach((_item, i) => {
    let n = rng.int32();
    while (reverse.has(n)) {
      n = rng.int32();
    }
    reverse.set(n, i);
  });

  return [...reverse.keys()].sort((a, b) => a - b).map((n) => array[reverse.get(n)!]);
}

export function sumByPoints(cards: { points: number }[]): number {
  return cards.reduce((sum, c) => sum + c.points, 0);
}

export function cardsEqual(a: { number: number }, b: { number: number }): boolean {
  return a.number === b.number;
}

export function cloneState<T>(value: T): T {
  return structuredClone(value);
}
