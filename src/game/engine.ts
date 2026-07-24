/**
 * Core rules adapted from boardgamers/take6-engine (MIT)
 * https://github.com/boardgamers/take6-engine
 *
 * Changes for SFboardgames:
 * - Dropped lodash / node assert for Cloudflare Workers
 * - Public view helpers for multiplayer
 * - Auto-place when only one legal placement
 */

import { getCard } from "./card";
import { cardsEqual, cloneState, shuffle, sumByPoints } from "./utils";
import {
  type AvailableMoves,
  type Card,
  type GameOptions,
  type GameState,
  type Move,
  MoveName,
  Phase,
  type Player,
  type PublicGameState,
} from "./types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function availableMoves(G: GameState, player: Player): AvailableMoves {
  switch (G.phase) {
    case Phase.ChooseCard:
      return { [MoveName.ChooseCard]: [...player.hand] };
    case Phase.BetweenDeals:
      return {};
    case Phase.PlaceCard:
    default: {
      const lastCards = G.rows.map((row) => row[row.length - 1]);
      const face = player.faceDownCard!;

      if (lastCards.every((card) => card.number > face.number)) {
        return {
          [MoveName.PlaceCard]: [0, 1, 2, 3].map((row) => ({
            row,
            replace: true,
          })),
        };
      }

      const candidates = lastCards.filter((c) => c.number < face.number);
      const best = Math.max(...candidates.map((c) => c.number));
      const row = lastCards.findIndex((c) => c.number === best);

      return {
        [MoveName.PlaceCard]: [
          {
            row,
            replace: G.rows[row].length >= 5,
          },
        ],
      };
    }
  }
}

export function setup(
  numPlayers: number,
  options: GameOptions = {},
  seed?: string,
  names: string[] = [],
): GameState {
  const resolved: GameState["options"] = {
    points: options.points ?? 66,
    handSize: options.handSize ?? 10,
    tightDeck: options.tightDeck ?? true,
  };
  const actualSeed = seed || Math.random().toString(36).slice(2);
  // Full deck = 104; tight = exactly one deal's cards (10n + 4 starters)
  const deckSize = resolved.tightDeck
    ? Math.min(104, numPlayers * resolved.handSize + 4)
    : 104;
  assert(
    deckSize >= numPlayers * resolved.handSize + 4,
    `Not enough cards for ${numPlayers} players`,
  );
  const deck = shuffle(
    Array.from({ length: deckSize }, (_, i) => getCard(i + 1)),
    actualSeed,
  );

  const rows = [
    [deck.shift()!],
    [deck.shift()!],
    [deck.shift()!],
    [deck.shift()!],
  ] as GameState["rows"];

  const players: Player[] = Array.from({ length: numPlayers }, (_, i) => ({
    hand: deck.splice(0, resolved.handSize),
    points: 0,
    discard: [],
    faceDownCard: null,
    availableMoves: null,
    name: names[i] ?? `Player ${i + 1}`,
  }));

  const G: GameState = {
    players,
    rows,
    options: resolved,
    phase: Phase.ChooseCard,
    round: 1,
    seed: actualSeed,
  };

  for (const player of G.players) {
    player.availableMoves = availableMoves(G, player);
  }

  return G;
}

export function move(G: GameState, playerMove: Move, playerNumber: number): GameState {
  const player = G.players[playerNumber];
  const available = player.availableMoves?.[playerMove.name];

  assert(available, `You cannot play ${playerMove.name} right now`);
  assert(
    available.some((x) =>
      playerMove.name === MoveName.ChooseCard
        ? cardsEqual(x as Card, playerMove.data as Card)
        : (x as { row: number; replace: boolean }).row ===
            (playerMove.data as { row: number }).row &&
          (x as { row: number; replace: boolean }).replace ===
            (playerMove.data as { replace: boolean }).replace,
    ),
    `Illegal ${playerMove.name}`,
  );

  switch (playerMove.name) {
    case MoveName.ChooseCard: {
      player.faceDownCard = playerMove.data;
      player.hand.splice(
        player.hand.findIndex((c) => cardsEqual(c, playerMove.data)),
        1,
      );
      player.availableMoves = null;

      if (G.players.every((pl) => pl.faceDownCard)) {
        G.phase = Phase.PlaceCard;
        return switchToNextPlayer(G);
      }
      return G;
    }
    case MoveName.PlaceCard: {
      player.availableMoves = null;

      if (playerMove.data.replace) {
        player.discard.push(...G.rows[playerMove.data.row]);
        player.points = sumByPoints(player.discard);
        G.rows[playerMove.data.row] = [player.faceDownCard!];
      } else {
        G.rows[playerMove.data.row].push(player.faceDownCard!);
      }

      player.faceDownCard = null;
      return switchToNextPlayer(G);
    }
  }
}

/** Auto-resolve forced placements (only one legal row). */
export function autoPlaceIfPossible(G: GameState): GameState {
  let state = G;
  let guard = 0;

  while (
    !ended(state) &&
    state.phase === Phase.PlaceCard &&
    guard++ < 20
  ) {
    const actor = state.players.findIndex(
      (pl) => pl.availableMoves?.[MoveName.PlaceCard]?.length === 1,
    );
    if (actor < 0) break;

    const only = state.players[actor].availableMoves![MoveName.PlaceCard]![0];
    state = move(state, { name: MoveName.PlaceCard, data: only }, actor);
  }

  return state;
}

function dealNewRound(G: GameState): void {
  G.round += 1;
  const fresh = setup(G.players.length, G.options, `${G.seed}-r${G.round}`);

  for (let i = 0; i < G.players.length; i++) {
    G.players[i].hand = fresh.players[i].hand;
    G.players[i].faceDownCard = null;
    G.players[i].availableMoves = null;
  }

  G.rows = fresh.rows;
  G.phase = Phase.ChooseCard;

  for (const player of G.players) {
    player.availableMoves = availableMoves(G, player);
  }
}

function finalizeEnded(G: GameState): void {
  for (const player of G.players) {
    player.availableMoves = null;
    player.faceDownCard = null;
  }
}

/** Hands empty after a deal, but game continues — show scores before redeal. */
function enterBetweenDeals(G: GameState): void {
  G.phase = Phase.BetweenDeals;
  for (const player of G.players) {
    player.availableMoves = null;
    player.faceDownCard = null;
  }
}

/** Call after the between-deals pause to deal the next hand. */
export function advanceAfterBetweenDeals(G: GameState): GameState {
  assert(G.phase === Phase.BetweenDeals, "Not between deals");
  if (G.players.some((pl) => pl.points >= G.options.points)) {
    finalizeEnded(G);
    return G;
  }
  dealNewRound(G);
  return G;
}

export function isBetweenDeals(G: GameState): boolean {
  return G.phase === Phase.BetweenDeals;
}

function switchToNextPlayer(G: GameState): GameState {
  // Official 6 Nimmt: once someone reaches the threshold, finish the *current deal*
  // (all cards from hands), then stop — do not deal another hand.
  if (ended(G)) {
    finalizeEnded(G);
    return G;
  }

  if (G.players.every((pl) => !pl.faceDownCard)) {
    if (G.players.every((pl) => pl.hand.length === 0)) {
      // Safety: never redeal if the threshold was hit this deal
      if (G.players.some((pl) => pl.points >= G.options.points)) {
        finalizeEnded(G);
        return G;
      }
      // Pause on standings before the next deal (server runs a short timer)
      enterBetweenDeals(G);
      return G;
    }

    G.phase = Phase.ChooseCard;
    for (const player of G.players) {
      player.availableMoves = availableMoves(G, player);
    }
    return G;
  }

  // Only the current lowest card should have place moves
  for (const pl of G.players) {
    pl.availableMoves = null;
  }

  const remaining = G.players.filter((pl) => pl.faceDownCard);
  const lowest = Math.min(...remaining.map((pl) => pl.faceDownCard!.number));
  const player = G.players.find((pl) => pl.faceDownCard?.number === lowest)!;
  player.availableMoves = availableMoves(G, player);
  return G;
}

/**
 * House rule: when your revealed card is too low for every row (must take a
 * row), you may put it back and play a different card from hand instead.
 * Placement order is recalculated among remaining face-down cards.
 */
export function swapForcedCard(
  G: GameState,
  playerNumber: number,
  newCardNumber: number,
): GameState {
  assert(G.phase === Phase.PlaceCard, "Can only change card while placing");
  const player = G.players[playerNumber];
  assert(player?.faceDownCard, "You have no card in play");

  const placeOpts = player.availableMoves?.[MoveName.PlaceCard] ?? [];
  assert(
    placeOpts.length > 1 && placeOpts.every((m) => m.replace),
    "You can only switch cards when forced to take a row",
  );

  const handIdx = player.hand.findIndex((c) => c.number === newCardNumber);
  assert(handIdx >= 0, "That card is not in your hand");

  const old = player.faceDownCard;
  const next = player.hand[handIdx];
  player.hand.splice(handIdx, 1);
  player.hand.push(old);
  player.faceDownCard = next;
  player.availableMoves = null;

  return switchToNextPlayer(G);
}

/**
 * Game ends only after the current deal is fully played *and* someone has
 * reached the point threshold (default 66). Hitting 66 mid-deal does not
 * stop the remaining cards — play out the hand first.
 */
export function ended(G: GameState): boolean {
  return (
    G.players.every((pl) => !pl.faceDownCard && pl.hand.length === 0) &&
    G.players.some((pl) => pl.points >= G.options.points)
  );
}

/** True once someone is at/over the threshold (even mid-deal). */
export function thresholdReached(G: GameState): boolean {
  return G.players.some((pl) => pl.points >= G.options.points);
}

export function winnerIndexes(G: GameState): number[] {
  if (!ended(G)) return [];
  const min = Math.min(...G.players.map((pl) => pl.points));
  return G.players
    .map((pl, i) => (pl.points === min ? i : -1))
    .filter((i) => i >= 0);
}

/** Highest bull-head totals — “lost” the race (can be ties). */
export function loserIndexes(G: GameState): number[] {
  if (!ended(G)) return [];
  const max = Math.max(...G.players.map((pl) => pl.points));
  return G.players
    .map((pl, i) => (pl.points === max ? i : -1))
    .filter((i) => i >= 0);
}

export function toPublicState(
  G: GameState,
  yourIndex: number,
  extras?: {
    betweenDealsEndsAt?: number | null;
    betweenDealsPaused?: boolean;
  },
): PublicGameState {
  const isEnded = ended(G);
  const isSpectator = yourIndex < 0;
  // Official: after everyone chooses, all cards flip at once, then place low→high.
  // Between deals also shows last-played state for the standings break.
  const revealCards =
    G.phase === Phase.PlaceCard ||
    G.phase === Phase.BetweenDeals ||
    isEnded;

  return {
    rows: G.rows.map((row) => row.map((c) => ({ ...c }))),
    phase: G.phase,
    round: G.round,
    handSize: G.options.handSize,
    tightDeck: G.options.tightDeck ?? false,
    pointsToEnd: G.options.points,
    yourIndex: isSpectator ? -1 : yourIndex,
    ended: isEnded,
    thresholdReached: thresholdReached(G),
    winnerIndexes: winnerIndexes(G),
    loserIndexes: loserIndexes(G),
    betweenDealsEndsAt:
      G.phase === Phase.BetweenDeals
        ? (extras?.betweenDealsEndsAt ?? null)
        : null,
    betweenDealsPaused:
      G.phase === Phase.BetweenDeals
        ? Boolean(extras?.betweenDealsPaused)
        : false,
    players: G.players.map((pl, i) => {
      const isYou = !isSpectator && i === yourIndex;
      return {
        name: pl.name ?? `Player ${i + 1}`,
        points: pl.points,
        handCount: pl.hand.length,
        hasChosen: pl.faceDownCard !== null,
        faceDownCard:
          pl.faceDownCard && (isYou || revealCards)
            ? { ...pl.faceDownCard }
            : pl.faceDownCard
              ? { number: 0, points: 0 }
              : null,
        discard: pl.discard.map((c) => ({ ...c })),
        isYou,
        hand: isYou ? pl.hand.map((c) => ({ ...c })) : undefined,
        availableMoves: isYou ? pl.availableMoves : undefined,
      };
    }),
  };
}

export function cloneGame(G: GameState): GameState {
  return cloneState(G);
}
