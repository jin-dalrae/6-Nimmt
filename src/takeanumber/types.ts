export interface Card {
  number: number;
  points: number;
}

export interface Player {
  id: string;
  name: string;
  isBot?: boolean;
  botStyle?: string;
  hand: Card[];
  faceDownCard: Card | null;
  /** Personal # Row (X Row) - kept in ascending order, score = 0 points */
  personalRow: Card[];
  /** Personal # Pile (X Pile) - face down dumped cards, score = points * 2 */
  personalPile: Card[];
  /** Total score accumulated over rounds */
  score: number;
  /** Cards currently taken in the middle of resolving a row take */
  pendingTakenCards: Card[] | null;
}

export enum Phase {
  ChooseCard = "choose",
  PlaceCard = "place",
  PickPersonalCard = "pick_personal",
  BetweenRounds = "between_rounds",
  Ended = "ended",
}

export interface CenterRow {
  /** Max cards that may sit in the row; the next card beyond this takes them. */
  capacity: number; // 3, 4, or 5
  cards: Card[];
}

export interface GameOptions {
  totalRounds?: number; // Default 2 rounds
}

export interface GameState {
  players: Player[];
  centerRows: [CenterRow, CenterRow, CenterRow]; //capacities 3, 4, 5
  phase: Phase;
  activePlayerIndex: number | null; // For resolving step by step or picking personal card
  options: Required<GameOptions>;
  currentRound: number;
  seed: string;
  lastActionSummary?: string;
  log: string[];
}
