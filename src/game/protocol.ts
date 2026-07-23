import type { PublicGameState } from "./types";
import type { AiStyle } from "./ai";

export type { AiStyle };

export type ClientMessage =
  | { type: "join"; name: string }
  | { type: "start" }
  | { type: "addBots"; count?: number }
  | { type: "removeBot" }
  | { type: "setAiStyle"; style: AiStyle }
  | { type: "chooseCard"; cardNumber: number }
  | { type: "placeCard"; row: number; replace: boolean }
  /** When forced to take a row: put current card back and play another */
  | { type: "swapCard"; cardNumber: number }
  | { type: "restart" }
  | { type: "leave" };

export type LobbyPlayer = {
  id: string;
  name: string;
  connected: boolean;
  isBot: boolean;
};

/** Watcher during an in-progress (or just-ended) game */
export type SpectatorInfo = {
  id: string;
  name: string;
  connected: boolean;
};

export type ServerMessage =
  | {
      type: "room";
      roomId: string;
      status: "lobby" | "playing" | "ended";
      players: LobbyPlayer[];
      /** People watching (not in the current hand) */
      spectators: SpectatorInfo[];
      hostId: string | null;
      youId: string;
      /** Seated player vs mid-game watcher */
      youRole: "player" | "spectator";
      maxPlayers: number;
      hasAiKey: boolean;
      aiStyle: AiStyle;
    }
  | {
      type: "state";
      game: PublicGameState;
      status: "playing" | "ended";
      spectators: SpectatorInfo[];
      youAreSpectator: boolean;
    }
  | { type: "error"; message: string }
  | { type: "toast"; message: string };

export function roomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}
