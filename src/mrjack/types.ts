/** Mr. Jack — unofficial digital adaptation (fan project) */

export type CharId =
  | "holmes"
  | "watson"
  | "smith"
  | "lestrade"
  | "stealthy"
  | "gull"
  | "bert"
  | "goodley";

export type Hex = { q: number; r: number };

export type HexKey = string; // "q,r"

export function hexKey(h: Hex): HexKey {
  return `${h.q},${h.r}`;
}

export function parseHex(k: HexKey): Hex {
  const [q, r] = k.split(",").map(Number);
  return { q, r };
}

export type Role = "detective" | "jack";

export type Phase =
  | "rolePick"
  | "selectChar"
  | "move"
  | "power"
  | "call"
  | "accuse"
  | "ended";

export type CharDef = {
  id: CharId;
  name: string;
  color: string;
  moveMin: number;
  moveMax: number;
  power: string;
};

export type GameState = {
  seed: string;
  round: number; // 1–8
  phase: Phase;
  /** Who acts this step */
  currentRole: Role;
  /** Characters still available this turn (face-up order) */
  available: CharId[];
  /** Used this turn */
  used: CharId[];
  positions: Record<CharId, HexKey>;
  /** Gaslight hexes that are currently lit */
  litGas: HexKey[];
  /** All gaslight sockets */
  gasSockets: HexKey[];
  /** Manhole hexes */
  manholes: HexKey[];
  /** Edge hexes Jack can escape from when unseen */
  exits: HexKey[];
  /** Building hexes (impassable except stealthy) */
  buildings: HexKey[];
  /** Walkable streets */
  streets: HexKey[];
  /** Jack's secret identity */
  jackId: CharId;
  /** Alibi cards remaining (character ids not jack) for Holmes */
  alibiDeck: CharId[];
  /** Cleared (innocent) characters */
  cleared: CharId[];
  /** Last call: was Jack seen? */
  lastSeen: boolean | null;
  detectiveWon: boolean | null;
  /** Accusations left for detective (1) */
  accusationsLeft: number;
  selected: CharId | null;
  legalMoves: HexKey[];
  /** Human plays this role; other is AI if vsAi */
  humanRole: Role;
  vsAi: boolean;
  log: string[];
  /** Power pending after move */
  pendingPower: CharId | null;
  powerTargets: HexKey[] | CharId[];
};
