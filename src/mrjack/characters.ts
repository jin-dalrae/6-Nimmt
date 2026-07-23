import type { CharDef, CharId } from "./types";

export const CHARACTERS: Record<CharId, CharDef> = {
  holmes: {
    id: "holmes",
    name: "Holmes",
    color: "#c4b5fd",
    moveMin: 1,
    moveMax: 3,
    power: "After move: draw 1 alibi (see an innocent).",
  },
  watson: {
    id: "watson",
    name: "Watson",
    color: "#93c5fd",
    moveMin: 1,
    moveMax: 3,
    power: "Carries a lantern — lights his hex + 1 step ahead.",
  },
  smith: {
    id: "smith",
    name: "J. Smith",
    color: "#fcd34d",
    moveMin: 1,
    moveMax: 3,
    power: "After move: move one gaslight to another socket.",
  },
  lestrade: {
    id: "lestrade",
    name: "Lestrade",
    color: "#86efac",
    moveMin: 1,
    moveMax: 3,
    power: "Blocks an exit (cordon) — pick an exit to seal this turn.",
  },
  stealthy: {
    id: "stealthy",
    name: "Stealthy",
    color: "#f9a8d4",
    moveMin: 1,
    moveMax: 4,
    power: "May path through buildings.",
  },
  gull: {
    id: "gull",
    name: "Sir W. Gull",
    color: "#fdba74",
    moveMin: 1,
    moveMax: 3,
    power: "After move: swap places with any other character.",
  },
  bert: {
    id: "bert",
    name: "J. Bert",
    color: "#a5b4fc",
    moveMin: 1,
    moveMax: 3,
    power: "May move between manholes as 1 step.",
  },
  goodley: {
    id: "goodley",
    name: "Sgt Goodley",
    color: "#fca5a5",
    moveMin: 1,
    moveMax: 3,
    power: "After move: whistle — move another character 1 hex toward him.",
  },
};

export const ALL_CHARS: CharId[] = [
  "holmes",
  "watson",
  "smith",
  "lestrade",
  "stealthy",
  "gull",
  "bert",
  "goodley",
];
