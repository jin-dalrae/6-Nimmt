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

/**
 * Human-readable rule for why a card has its bull-head value.
 * Used for red-border hints and tooltips.
 */
export function getPointsRule(number: number): { points: number; rule: string; detail: string } {
  if (number === 55) {
    return {
      points: 7,
      rule: "Card 55",
      detail: "55 is the only card worth 7 bull heads (worst card in the deck).",
    };
  }
  if (number % 11 === 0) {
    return {
      points: 5,
      rule: "Multiple of 11",
      detail: `${number} is a multiple of 11 → 5 bull heads. Red border marks cards with 5+ points.`,
    };
  }
  if (number % 10 === 0) {
    return {
      points: 3,
      rule: "Multiple of 10",
      detail: `${number} ends in 0 (multiple of 10) → 3 bull heads.`,
    };
  }
  if (number % 5 === 0) {
    return {
      points: 2,
      rule: "Ends in 5",
      detail: `${number} ends in 5 → 2 bull heads.`,
    };
  }
  return {
    points: 1,
    rule: "Normal card",
    detail: `${number} has no special pattern → 1 bull head.`,
  };
}
