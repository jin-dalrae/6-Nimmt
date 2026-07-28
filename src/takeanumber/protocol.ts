import type { Card, CenterRow, GameState, Player } from "./types";
import { Phase } from "./types";

export interface PublicPlayer {
  id: string;
  name: string;
  isBot?: boolean;
  handCount: number;
  hasChosenCard: boolean;
  faceDownCard: Card | null; // null or revealed
  personalRow: Card[];
  personalPileCount: number;
  score: number;
  pendingTakenCards: Card[] | null; // Only non-null if this player is picking personal card
}

export interface PublicGameState {
  players: PublicPlayer[];
  centerRows: [CenterRow, CenterRow, CenterRow];
  phase: Phase;
  activePlayerIndex: number | null;
  currentRound: number;
  totalRounds: number;
  log: string[];
  yourIndex: number | null;
  yourHand: Card[];
}

export function toPublicState(G: GameState, yourPlayerId: string): PublicGameState {
  const yourIndex = G.players.findIndex((p) => p.id === yourPlayerId);
  const yourHand = yourIndex !== -1 ? G.players[yourIndex].hand : [];

  const publicPlayers: PublicPlayer[] = G.players.map((p, idx) => {
    // Show faceDownCard only when resolving/placing or game ended
    const isRevealing = G.phase === Phase.PlaceCard || G.phase === Phase.PickPersonalCard;
    const faceDownCard = isRevealing || idx === yourIndex ? p.faceDownCard : null;

    return {
      id: p.id,
      name: p.name,
      isBot: p.isBot,
      handCount: p.hand.length,
      hasChosenCard: p.faceDownCard !== null,
      faceDownCard,
      personalRow: p.personalRow,
      personalPileCount: p.personalPile.length,
      score: p.score,
      pendingTakenCards: idx === yourIndex ? p.pendingTakenCards : null,
    };
  });

  return {
    players: publicPlayers,
    centerRows: G.centerRows,
    phase: G.phase,
    activePlayerIndex: G.activePlayerIndex,
    currentRound: G.currentRound,
    totalRounds: G.options.totalRounds,
    log: G.log,
    yourIndex: yourIndex !== -1 ? yourIndex : null,
    yourHand,
  };
}
