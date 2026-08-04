import seedrandom from "seedrandom";
import { createDeck } from "./card";
import type { Card, CenterRow, GameOptions, GameState, Player } from "./types";
import { Phase } from "./types";

function shuffle<T>(array: T[], rng: () => number): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function setupGame(
  playerDefs: { id: string; name: string; isBot?: boolean; botStyle?: string }[],
  seed = Math.random().toString(36).slice(2, 9),
  options: GameOptions = {},
): GameState {
  const rng = seedrandom(seed);
  const deck = shuffle(createDeck(), rng);

  // 3 center rows with capacities 3, 4, 5
  const centerRows: [CenterRow, CenterRow, CenterRow] = [
    { capacity: 3, cards: [deck.pop()!] },
    { capacity: 4, cards: [deck.pop()!] },
    { capacity: 5, cards: [deck.pop()!] },
  ];

  // Deal 8 cards to each player
  const players: Player[] = playerDefs.map((p) => {
    const hand: Card[] = [];
    for (let i = 0; i < 8; i++) {
      hand.push(deck.pop()!);
    }
    hand.sort((a, b) => a.number - b.number);

    return {
      id: p.id,
      name: p.name,
      isBot: p.isBot,
      botStyle: p.botStyle,
      hand,
      faceDownCard: null,
      personalRow: [],
      personalPile: [],
      score: 0,
      pendingTakenCards: null,
    };
  });

  return {
    players,
    centerRows,
    phase: Phase.ChooseCard,
    activePlayerIndex: null,
    options: {
      totalRounds: options.totalRounds ?? 2,
    },
    currentRound: 1,
    seed,
    log: ["Game started! Deal 1."],
  };
}

export function chooseCard(G: GameState, playerIndex: number, cardNum: number): GameState {
  if (G.phase !== Phase.ChooseCard) return G;
  const p = G.players[playerIndex];
  if (!p) return G;

  const cardIdx = p.hand.findIndex((c) => c.number === cardNum);
  if (cardIdx === -1) return G;

  const [chosenCard] = p.hand.splice(cardIdx, 1);
  p.faceDownCard = chosenCard;

  // Check if all players have chosen faceDownCard
  if (G.players.every((pl) => pl.faceDownCard !== null)) {
    return resolveTurn(G);
  }

  return { ...G };
}

export function resolveTurn(G: GameState): GameState {
  // Process the faceDownCards in ascending order
  while (G.players.some((p) => p.faceDownCard !== null)) {
    // Find player with lowest faceDownCard
    let lowestIdx = -1;
    let lowestVal = Infinity;

    for (let i = 0; i < G.players.length; i++) {
      const card = G.players[i].faceDownCard;
      if (card && card.number < lowestVal) {
        lowestVal = card.number;
        lowestIdx = i;
      }
    }

    if (lowestIdx === -1) break;

    const p = G.players[lowestIdx];
    const card = p.faceDownCard!;

    // Find valid center rows where row end < card.number
    let bestRowIdx = -1;
    let smallestDiff = Infinity;

    for (let r = 0; r < G.centerRows.length; r++) {
      const row = G.centerRows[r];
      const lastCard = row.cards[row.cards.length - 1];
      if (lastCard.number < card.number) {
        const diff = card.number - lastCard.number;
        if (diff < smallestDiff) {
          smallestDiff = diff;
          bestRowIdx = r;
        }
      }
    }

    if (bestRowIdx === -1) {
      // Card is lower than ALL row ends -> player must choose row to take
      G.phase = Phase.PlaceCard;
      G.activePlayerIndex = lowestIdx;
      G.log.push(`${p.name}'s card (${card.number}) is lower than all rows. Must pick a row to take.`);
      return { ...G };
    }

    // Row holds up to `capacity` cards. The next card past capacity takes the full row.
    // e.g. 4-row may sit at 4; placing a 5th takes those 4 and starts the row again.
    const targetRow = G.centerRows[bestRowIdx];
    if (targetRow.cards.length >= targetRow.capacity) {
      const taken = [...targetRow.cards];
      targetRow.cards = [card];
      p.faceDownCard = null;
      p.pendingTakenCards = taken;

      G.phase = Phase.PickPersonalCard;
      G.activePlayerIndex = lowestIdx;
      G.log.push(
        `${p.name} placed ${card.number} on the full ${targetRow.capacity}-Cards Row and took ${taken.length} card(s)!`,
      );
      return { ...G };
    } else {
      targetRow.cards.push(card);
      p.faceDownCard = null;
      G.log.push(`${p.name} placed ${card.number} on the ${targetRow.capacity}-Cards Row.`);
    }
  }

  // All cards for this turn resolved! Check if any player's hand is empty (Round end)
  if (G.players.some((p) => p.hand.length === 0)) {
    return endRound(G);
  }

  G.phase = Phase.ChooseCard;
  G.activePlayerIndex = null;
  return { ...G };
}

export function chooseRowToTake(G: GameState, playerIndex: number, rowIndex: number): GameState {
  if (G.phase !== Phase.PlaceCard || G.activePlayerIndex !== playerIndex) return G;
  const p = G.players[playerIndex];
  if (!p || !p.faceDownCard) return G;

  const targetRow = G.centerRows[rowIndex];
  if (!targetRow) return G;

  const card = p.faceDownCard;
  const taken = [...targetRow.cards];
  targetRow.cards = [card];
  p.faceDownCard = null;
  p.pendingTakenCards = taken;

  G.phase = Phase.PickPersonalCard;
  G.log.push(`${p.name} chose the ${targetRow.capacity}-Cards Row and took ${taken.length} card(s).`);

  return { ...G };
}

export function pickPersonalCard(G: GameState, playerIndex: number, cardNum: number): GameState {
  if (G.phase !== Phase.PickPersonalCard || G.activePlayerIndex !== playerIndex) return G;
  const p = G.players[playerIndex];
  if (!p || !p.pendingTakenCards) return G;

  const idx = p.pendingTakenCards.findIndex((c) => c.number === cardNum);
  if (idx === -1) return G;

  const [chosen] = p.pendingTakenCards.splice(idx, 1);
  const remainingTaken = p.pendingTakenCards;
  p.pendingTakenCards = null;

  // Add remaining taken cards to hand
  p.hand.push(...remainingTaken);
  p.hand.sort((a, b) => a.number - b.number);

  // Add chosen card to personal # Row (X Row)
  const lastInPersonal = p.personalRow[p.personalRow.length - 1];
  if (!lastInPersonal || chosen.number > lastInPersonal.number) {
    p.personalRow.push(chosen);
    G.log.push(`${p.name} added ${chosen.number} to their personal # Row.`);
  } else {
    // Overflow! Dump existing personalRow to personalPile
    p.personalPile.push(...p.personalRow);
    p.personalRow = [chosen];
    G.log.push(
      `💥 ${p.name}'s personal # Row broke ascending order with ${chosen.number}! Dumped row to # Pile (2x penalty).`,
    );
  }

  // Continue resolving remaining turn cards
  return resolveTurn(G);
}

function calculateRoundScores(p: Player): number {
  // Hand cards = 1 pt per bullhead
  const handPts = p.hand.reduce((sum, c) => sum + c.points, 0);
  // # Pile cards = 2 pts per bullhead (DOUBLED)
  const pilePts = p.personalPile.reduce((sum, c) => sum + c.points * 2, 0);
  // # Row cards = 0 pts (SAFE)
  return handPts + pilePts;
}

export function endRound(G: GameState): GameState {
  G.log.push(`--- Round ${G.currentRound} Finished! ---`);
  for (const p of G.players) {
    const pts = calculateRoundScores(p);
    p.score += pts;
    G.log.push(`${p.name} scored ${pts} penalty points in Round ${G.currentRound}.`);
  }

  if (G.currentRound >= G.options.totalRounds) {
    G.phase = Phase.Ended;
    G.log.push("🏆 Game Over!");
    return { ...G };
  } else {
    G.phase = Phase.BetweenRounds;
    return { ...G };
  }
}

export function startNextRound(G: GameState): GameState {
  if (G.phase !== Phase.BetweenRounds) return G;

  G.currentRound += 1;
  const rng = seedrandom(`${G.seed}-r${G.currentRound}`);
  const deck = shuffle(createDeck(), rng);

  G.centerRows = [
    { capacity: 3, cards: [deck.pop()!] },
    { capacity: 4, cards: [deck.pop()!] },
    { capacity: 5, cards: [deck.pop()!] },
  ];

  for (const p of G.players) {
    p.hand = [];
    for (let i = 0; i < 8; i++) {
      p.hand.push(deck.pop()!);
    }
    p.hand.sort((a, b) => a.number - b.number);
    p.faceDownCard = null;
    p.personalRow = [];
    p.personalPile = [];
    p.pendingTakenCards = null;
  }

  G.phase = Phase.ChooseCard;
  G.activePlayerIndex = null;
  G.log.push(`--- Starting Round ${G.currentRound}! ---`);
  return { ...G };
}
