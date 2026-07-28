import type { Card } from "./types";

export function cardPoints(num: number): number {
  if (num === 55) return 7;
  if (num % 11 === 0) return 5;
  if (num % 10 === 0) return 3;
  if (num % 5 === 0) return 2;
  return 1;
}

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (let i = 1; i <= 100; i++) {
    deck.push({
      number: i,
      points: cardPoints(i),
    });
  }
  return deck;
}
