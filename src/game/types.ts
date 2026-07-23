/**
 * Game types adapted from boardgamers/take6-engine (MIT)
 * https://github.com/boardgamers/take6-engine
 */

export type AiStyleId = "easy" | "solid" | "sharp" | "wild";

export interface GameOptions {
  points?: number;
  handSize?: number;
  /**
   * Use only cards 1…(handSize × players + 4) so every card is in play each deal.
   * Official rules use the full 1–104 deck.
   */
  tightDeck?: boolean;
}

export interface Card {
  number: number;
  points: number;
}

export interface Player {
  faceDownCard: Card | null;
  hand: Card[];
  points: number;
  name?: string;
  availableMoves: AvailableMoves | null;
  discard: Card[];
}

export enum Phase {
  ChooseCard = "choose",
  PlaceCard = "place",
}

export interface GameState {
  players: Player[];
  rows: [Card[], Card[], Card[], Card[]];
  phase: Phase;
  options: Required<GameOptions>;
  round: number;
  seed: string;
}

export enum MoveName {
  ChooseCard = "chooseCard",
  PlaceCard = "placeCard",
}

export type Move =
  | { name: MoveName.ChooseCard; data: Card }
  | {
      name: MoveName.PlaceCard;
      data: { row: number; replace: boolean };
    };

export interface AvailableMoves {
  [MoveName.ChooseCard]?: Card[];
  [MoveName.PlaceCard]?: Array<{ row: number; replace: boolean }>;
}

export interface PublicPlayer {
  name: string;
  points: number;
  handCount: number;
  hasChosen: boolean;
  faceDownCard: Card | null;
  discard: Card[];
  isYou: boolean;
  isBot?: boolean;
  /** Bot difficulty when isBot */
  aiStyle?: AiStyleId;
  hand?: Card[];
  availableMoves?: AvailableMoves | null;
}

export interface PublicGameState {
  rows: Card[][];
  phase: Phase;
  round: number;
  /** Cards dealt per player each deal (usually 10) */
  handSize: number;
  /** Deck is 1…(handSize×players+4) instead of 1–104 */
  tightDeck: boolean;
  pointsToEnd: number;
  players: PublicPlayer[];
  yourIndex: number;
  ended: boolean;
  /** Someone already has ≥ pointsToEnd; finish this deal, then game ends */
  thresholdReached: boolean;
  winnerIndexes: number[];
  /** Highest score(s) when game has ended */
  loserIndexes: number[];
}
