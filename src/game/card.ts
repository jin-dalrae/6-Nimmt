/**
 * Card scoring from boardgamers/take6-engine (MIT)
 * https://github.com/boardgamers/take6-engine
 */

import type { Card } from "./types";

/** Bull-head points for card numbers 1–104 */
export function getCard(number: number): Card {
  let points = 1;

  if (number === 55) {
    points = 7;
  } else if (number % 11 === 0) {
    points = 5;
  } else if (number % 10 === 0) {
    points = 3;
  } else if (number % 5 === 0) {
    points = 2;
  }

  return { number, points };
}

export function bullsLabel(points: number): string {
  return "🐂".repeat(Math.min(points, 7));
}
