import type { Card, GameState } from "./types";
import { Phase } from "./types";

export const BOT_NAMES = [
  "Take-5-o",
  "Bullseye",
  "Rowmaster",
  "Number Cruncher",
  "Ox Strategy",
  "Clever Card",
  "Ascend Bot",
];

export function chooseCardForBot(G: GameState, playerIndex: number): Card | null {
  const p = G.players[playerIndex];
  if (!p || p.hand.length === 0) return null;

  // Find safest cards that fit onto a row without taking it
  let bestCard: Card | null = null;
  let minRisk = Infinity;

  for (const card of p.hand) {
    let risk = 50; // default risk

    // Check which row it would go to
    let targetRowIdx = -1;
    let smallestDiff = Infinity;

    for (let r = 0; r < G.centerRows.length; r++) {
      const row = G.centerRows[r];
      const lastCard = row.cards[row.cards.length - 1];
      if (lastCard.number < card.number) {
        const diff = card.number - lastCard.number;
        if (diff < smallestDiff) {
          smallestDiff = diff;
          targetRowIdx = r;
        }
      }
    }

    if (targetRowIdx !== -1) {
      const row = G.centerRows[targetRowIdx];
      const slotsLeft = row.capacity - row.cards.length;
      if (slotsLeft > 0) {
        // Safe: still room under capacity
        risk = smallestDiff * 0.5;
      } else {
        // Row already full — this card takes it
        risk = 100 + row.cards.reduce((sum, c) => sum + c.points, 0);
      }
    } else {
      // Card is lower than all rows - will take a row
      // Find row with minimum points
      const minRowPts = Math.min(
        ...G.centerRows.map((r) => r.cards.reduce((sum, c) => sum + c.points, 0)),
      );
      risk = 80 + minRowPts;
    }

    if (risk < minRisk) {
      minRisk = risk;
      bestCard = card;
    }
  }

  return bestCard || p.hand[0];
}

export function chooseRowForBot(G: GameState): number {
  // Find center row with lowest total points
  let minPts = Infinity;
  let bestRow = 0;

  for (let r = 0; r < G.centerRows.length; r++) {
    const pts = G.centerRows[r].cards.reduce((sum, c) => sum + c.points, 0);
    if (pts < minPts) {
      minPts = pts;
      bestRow = r;
    }
  }

  return bestRow;
}

export function pickPersonalCardForBot(G: GameState, playerIndex: number): Card | null {
  const p = G.players[playerIndex];
  if (!p || !p.pendingTakenCards || p.pendingTakenCards.length === 0) return null;

  const lastInPersonal = p.personalRow[p.personalRow.length - 1];

  if (lastInPersonal) {
    // Prefer a card that is > lastInPersonal to avoid dumping personalRow!
    const validCards = p.pendingTakenCards
      .filter((c) => c.number > lastInPersonal.number)
      .sort((a, b) => a.number - b.number);

    if (validCards.length > 0) {
      return validCards[0]; // pick smallest valid card to leave room for future additions
    }
  }

  // If no card fits or personalRow is empty, pick card with lowest points
  const sortedByPoints = [...p.pendingTakenCards].sort((a, b) => a.points - b.points);
  return sortedByPoints[0];
}

export function runBotActionIfNeeded(
  G: GameState,
  callbacks: {
    chooseCard: (pIdx: number, cardNum: number) => void;
    chooseRow: (pIdx: number, rowIdx: number) => void;
    pickPersonal: (pIdx: number, cardNum: number) => void;
  },
): boolean {
  if (G.phase === Phase.ChooseCard) {
    let acted = false;
    for (let i = 0; i < G.players.length; i++) {
      const p = G.players[i];
      if (p.isBot && p.faceDownCard === null) {
        const card = chooseCardForBot(G, i);
        if (card) {
          callbacks.chooseCard(i, card.number);
          acted = true;
        }
      }
    }
    return acted;
  }

  if (G.phase === Phase.PlaceCard && G.activePlayerIndex !== null) {
    const p = G.players[G.activePlayerIndex];
    if (p && p.isBot) {
      const rowIdx = chooseRowForBot(G);
      callbacks.chooseRow(G.activePlayerIndex, rowIdx);
      return true;
    }
  }

  if (G.phase === Phase.PickPersonalCard && G.activePlayerIndex !== null) {
    const p = G.players[G.activePlayerIndex];
    if (p && p.isBot) {
      const card = pickPersonalCardForBot(G, G.activePlayerIndex);
      if (card) {
        callbacks.pickPersonal(G.activePlayerIndex, card.number);
        return true;
      }
    }
  }

  return false;
}
