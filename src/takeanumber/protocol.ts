import type { Card, CenterRow, GameState, Player } from "./types";
import { Phase } from "./types";

/** Client → server (online multiplayer) */
export type TanClientMessage =
  | { type: "join"; name: string; sessionToken?: string }
  | { type: "start" }
  | { type: "addBots"; count?: number }
  | { type: "removeBot" }
  | { type: "chooseCard"; cardNumber: number }
  | { type: "chooseRow"; rowIndex: number }
  | { type: "pickPersonal"; cardNumber: number }
  | { type: "startNextRound" }
  | { type: "restart" }
  | { type: "playAgain" }
  | { type: "leave" };

export type TanLobbyPlayer = {
  id: string;
  name: string;
  connected: boolean;
  isBot: boolean;
  isHost: boolean;
};

export interface PublicPlayer {
  id: string;
  name: string;
  isBot?: boolean;
  handCount: number;
  hasChosenCard: boolean;
  /** Shown only after reveal / to yourself */
  faceDownCard: Card | null;
  personalRow: Card[];
  personalPileCount: number;
  /** Bull heads in # pile (penalty = this × 2) */
  personalPileBulls: number;
  score: number;
  /** Only for the player who must pick */
  pendingTakenCards: Card[] | null;
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
  yourId: string | null;
}

/** Server → client */
export type TanServerMessage =
  | {
      type: "room";
      roomId: string;
      status: "lobby" | "playing" | "ended";
      players: TanLobbyPlayer[];
      hostId: string | null;
      youId: string;
      maxPlayers: number;
      minPlayers: number;
      sessionToken?: string;
    }
  | {
      type: "state";
      status: "playing" | "ended";
      game: PublicGameState;
    }
  | { type: "error"; message: string }
  | { type: "toast"; message: string };

export function toPublicState(G: GameState, yourPlayerId: string): PublicGameState {
  const yourIndex = G.players.findIndex((p) => p.id === yourPlayerId);
  const yourHand = yourIndex !== -1 ? [...G.players[yourIndex]!.hand] : [];

  // Reveal chosen cards once everyone has picked and we're placing / picking personal
  const isRevealing =
    G.phase === Phase.PlaceCard ||
    G.phase === Phase.PickPersonalCard ||
    G.phase === Phase.BetweenRounds ||
    G.phase === Phase.Ended;

  const publicPlayers: PublicPlayer[] = G.players.map((p, idx) => {
    const showFace =
      isRevealing || idx === yourIndex ? p.faceDownCard : null;
    const pileBulls = p.personalPile.reduce((s, c) => s + c.points, 0);

    return {
      id: p.id,
      name: p.name,
      isBot: p.isBot,
      handCount: p.hand.length,
      hasChosenCard: p.faceDownCard !== null,
      faceDownCard: showFace,
      personalRow: [...p.personalRow],
      personalPileCount: p.personalPile.length,
      personalPileBulls: pileBulls,
      score: p.score,
      pendingTakenCards:
        idx === yourIndex && p.pendingTakenCards
          ? [...p.pendingTakenCards]
          : null,
    };
  });

  return {
    players: publicPlayers,
    centerRows: G.centerRows.map((r) => ({
      capacity: r.capacity,
      cards: [...r.cards],
    })) as [CenterRow, CenterRow, CenterRow],
    phase: G.phase,
    activePlayerIndex: G.activePlayerIndex,
    currentRound: G.currentRound,
    totalRounds: G.options.totalRounds,
    log: G.log.slice(-40),
    yourIndex: yourIndex !== -1 ? yourIndex : null,
    yourHand,
    yourId: yourIndex !== -1 ? yourPlayerId : null,
  };
}

export function roomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

/** Clone game state so engine mutations never touch a shared reference unexpectedly */
export function cloneGame(G: GameState): GameState {
  return {
    ...G,
    players: G.players.map(
      (p): Player => ({
        ...p,
        hand: [...p.hand],
        faceDownCard: p.faceDownCard ? { ...p.faceDownCard } : null,
        personalRow: [...p.personalRow],
        personalPile: [...p.personalPile],
        pendingTakenCards: p.pendingTakenCards
          ? [...p.pendingTakenCards]
          : null,
      }),
    ),
    centerRows: G.centerRows.map((r) => ({
      capacity: r.capacity,
      cards: [...r.cards],
    })) as [CenterRow, CenterRow, CenterRow],
    options: { ...G.options },
    log: [...G.log],
  };
}
