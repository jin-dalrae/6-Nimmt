/**
 * Game types adapted from boardgamers/take6-engine (MIT)
 * https://github.com/boardgamers/take6-engine
 */

export interface GameOptions {
  points?: number;
  handSize?: number;
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
  hand?: Card[];
  availableMoves?: AvailableMoves | null;
}

export interface PublicGameState {
  rows: Card[][];
  phase: Phase;
  round: number;
  pointsToEnd: number;
  players: PublicPlayer[];
  yourIndex: number;
  ended: boolean;
  winnerIndexes: number[];
}
