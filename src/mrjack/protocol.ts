import type { CharId, HexKey, Phase, Role } from "./types";

export type MrJackClientMessage =
  | { type: "join"; name: string; sessionToken?: string; preferRole?: Role }
  | { type: "setRole"; role: Role }
  | { type: "start" }
  | { type: "selectChar"; charId: CharId }
  | { type: "move"; hex: HexKey }
  | { type: "power"; target: string }
  | { type: "skipPower" }
  | { type: "resolveCall" }
  | { type: "accuse"; charId: CharId }
  | { type: "restart" }
  | { type: "leave" };

export type MrJackLobbyPlayer = {
  id: string;
  name: string;
  connected: boolean;
  role: Role | null;
  isHost: boolean;
};

/** View of the board sent to each seat (Jack identity hidden from Detective). */
export type MrJackPublicState = {
  seed: string;
  round: number;
  phase: Phase;
  currentRole: Role;
  available: CharId[];
  used: CharId[];
  positions: Record<CharId, HexKey>;
  litGas: HexKey[];
  gasSockets: HexKey[];
  manholes: HexKey[];
  exits: HexKey[];
  buildings: HexKey[];
  streets: HexKey[];
  /** Only for Jack seat (or game over); Detective gets null */
  jackId: CharId | null;
  alibiDeckCount: number;
  cleared: CharId[];
  lastSeen: boolean | null;
  detectiveWon: boolean | null;
  accusationsLeft: number;
  selected: CharId | null;
  legalMoves: HexKey[];
  pendingPower: CharId | null;
  powerTargets: HexKey[] | CharId[];
  log: string[];
  yourRole: Role | null;
  yourTurn: boolean;
  ended: boolean;
};

export type MrJackServerMessage =
  | {
      type: "room";
      roomId: string;
      status: "lobby" | "playing" | "ended";
      players: MrJackLobbyPlayer[];
      hostId: string | null;
      youId: string;
      maxPlayers: number;
      sessionToken?: string;
    }
  | {
      type: "state";
      status: "playing" | "ended";
      game: MrJackPublicState;
    }
  | { type: "error"; message: string }
  | { type: "toast"; message: string };
