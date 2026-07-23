import { ALL_CHARS, CHARACTERS } from "./characters";
import { buildMap, hexDist, neighbors } from "./board";
import type { CharId, GameState, Hex, HexKey, Role } from "./types";
import { hexKey, parseHex } from "./types";

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const START: Record<CharId, Hex> = {
  holmes: { q: -2, r: 0 },
  watson: { q: 2, r: 0 },
  smith: { q: 0, r: -2 },
  lestrade: { q: 0, r: 2 },
  stealthy: { q: 1, r: -1 },
  gull: { q: -1, r: 1 },
  bert: { q: 2, r: -2 },
  goodley: { q: -2, r: 2 },
};

function log(G: GameState, msg: string) {
  G.log = [msg, ...G.log].slice(0, 40);
}

/** Who acts for activation slots 0..3 within a round */
function actorForSlot(round: number, slot: number): Role {
  // Odd rounds: D J D J | Even: J D J D
  const odd = round % 2 === 1;
  const pattern: Role[] = odd
    ? ["detective", "jack", "detective", "jack"]
    : ["jack", "detective", "jack", "detective"];
  return pattern[slot]!;
}

export function createGame(
  humanRole: Role,
  vsAi: boolean,
  seed = Math.random().toString(36).slice(2),
): GameState {
  const rng = mulberry32(hashSeed(seed));
  const map = buildMap();
  const order = shuffle(ALL_CHARS, rng);
  const jackId = order[0]!;
  const alibiDeck = shuffle(
    ALL_CHARS.filter((c) => c !== jackId),
    rng,
  );

  // 4 face-up for first turn
  const available = shuffle(ALL_CHARS, rng).slice(0, 4);

  const litGas = shuffle([...map.gasSockets], rng).slice(0, 3);

  const positions = {} as Record<CharId, HexKey>;
  for (const id of ALL_CHARS) {
    positions[id] = hexKey(START[id]);
  }

  const G: GameState = {
    seed,
    round: 1,
    phase: "selectChar",
    currentRole: actorForSlot(1, 0),
    available,
    used: [],
    positions,
    litGas,
    gasSockets: map.gasSockets,
    manholes: map.manholes,
    exits: map.exits,
    buildings: map.buildings,
    streets: map.streets,
    jackId,
    alibiDeck,
    cleared: [],
    lastSeen: null,
    detectiveWon: null,
    accusationsLeft: 1,
    selected: null,
    legalMoves: [],
    humanRole,
    vsAi,
    log: [
      `Game start — you are the ${humanRole === "detective" ? "Detective" : "Mr. Jack"}.`,
      humanRole === "jack"
        ? `You are secretly: ${CHARACTERS[jackId].name}.`
        : "Find Mr. Jack among the 8 — accuse wisely (1 try).",
    ],
    pendingPower: null,
    powerTargets: [],
  };

  log(G, `Round 1 — ${G.currentRole} picks a character.`);
  return G;
}

function occupied(G: GameState): Set<HexKey> {
  return new Set(Object.values(G.positions));
}

function canEnter(G: GameState, who: CharId, to: HexKey): boolean {
  const throughB = who === "stealthy";
  if (G.buildings.includes(to)) return throughB;
  if (!G.streets.includes(to)) return false;
  const occ = occupied(G);
  occ.delete(G.positions[who]);
  if (occ.has(to)) return false;
  return true;
}

/** BFS reachable hexes in [min,max] steps */
export function legalDestinations(G: GameState, who: CharId): HexKey[] {
  const def = CHARACTERS[who];
  const start = parseHex(G.positions[who]);
  const useManhole = who === "bert";
  const result = new Set<HexKey>();
  const q: Array<{ h: Hex; d: number }> = [{ h: start, d: 0 }];
  const seen = new Map<string, number>();
  seen.set(hexKey(start), 0);

  while (q.length) {
    const { h, d } = q.shift()!;
    if (d > 0 && d >= def.moveMin && d <= def.moveMax) {
      result.add(hexKey(h));
    }
    if (d >= def.moveMax) continue;

    const nextHexes: Hex[] = [...neighbors(h)];
    if (useManhole && G.manholes.includes(hexKey(h))) {
      for (const m of G.manholes) {
        if (m !== hexKey(h)) nextHexes.push(parseHex(m));
      }
    }

    for (const n of nextHexes) {
      const nk = hexKey(n);
      if (!canEnter(G, who, nk)) continue;
      const nd = d + 1;
      if (nd > def.moveMax) continue;
      const prev = seen.get(nk);
      if (prev !== undefined && prev <= nd) continue;
      seen.set(nk, nd);
      q.push({ h: n, d: nd });
    }
  }

  return [...result];
}

function isIlluminated(G: GameState, pos: HexKey): boolean {
  if (G.litGas.includes(pos)) return true;
  // Watson lantern: his hex + neighbor in direction of most adjacent empty? simplify: watson hex + all neighbors
  const w = G.positions.watson;
  if (pos === w) return true;
  const wh = parseHex(w);
  for (const n of neighbors(wh)) {
    if (hexKey(n) === pos) return true;
  }
  // Adjacent to any other character = "seen" by witnesses
  for (const id of ALL_CHARS) {
    if (id === "watson") continue;
    const p = G.positions[id];
    if (p === pos) continue;
    if (hexDist(parseHex(p), parseHex(pos)) === 1) return true;
  }
  return false;
}

export function jackIsSeen(G: GameState): boolean {
  return isIlluminated(G, G.positions[G.jackId]);
}

export function selectCharacter(G: GameState, id: CharId): GameState {
  if (G.phase !== "selectChar") return G;
  if (!G.available.includes(id)) return G;
  const next = structuredClone(G) as GameState;
  next.selected = id;
  next.legalMoves = legalDestinations(next, id);
  next.phase = "move";
  log(next, `${next.currentRole} selected ${CHARACTERS[id].name}.`);
  return next;
}

export function moveCharacter(G: GameState, dest: HexKey): GameState {
  if (G.phase !== "move" || !G.selected) return G;
  if (!G.legalMoves.includes(dest)) return G;
  const next = structuredClone(G) as GameState;
  const who = next.selected!;
  next.positions[who] = dest;
  log(next, `${CHARACTERS[who].name} moved.`);
  next.legalMoves = [];

  // Powers that need a target
  if (who === "holmes" || who === "smith" || who === "gull" || who === "goodley" || who === "lestrade") {
    next.phase = "power";
    next.pendingPower = who;
    next.powerTargets = powerTargets(next, who);
    if (next.powerTargets.length === 0) {
      return finishActivation(next, who);
    }
    return next;
  }
  return finishActivation(next, who);
}

function powerTargets(G: GameState, who: CharId): HexKey[] | CharId[] {
  switch (who) {
    case "holmes":
      return G.alibiDeck.length ? (["alibi"] as unknown as CharId[]) : [];
    case "smith":
      return G.gasSockets.filter((s) => !G.litGas.includes(s));
    case "gull":
      return ALL_CHARS.filter((c) => c !== "gull");
    case "goodley":
      return ALL_CHARS.filter((c) => c !== "goodley");
    case "lestrade":
      return G.exits;
    default:
      return [];
  }
}

export function usePower(G: GameState, target: string): GameState {
  if (G.phase !== "power" || !G.pendingPower) return G;
  const next = structuredClone(G) as GameState;
  const who = next.pendingPower!;

  if (who === "holmes") {
    const card = next.alibiDeck.shift();
    if (card) {
      if (!next.cleared.includes(card)) next.cleared.push(card);
      log(next, `Holmes reveals alibi: ${CHARACTERS[card].name} is innocent.`);
    }
  } else if (who === "smith") {
    // Move a lit gas to empty socket: pick which lit to move if multiple — simplify move first lit
    if (next.powerTargets.includes(target as HexKey)) {
      if (next.litGas.length) {
        next.litGas = next.litGas.slice(1);
      }
      next.litGas.push(target as HexKey);
      log(next, `Smith moved a gaslight.`);
    }
  } else if (who === "gull") {
    const other = target as CharId;
    if (ALL_CHARS.includes(other) && other !== "gull") {
      const a = next.positions.gull;
      next.positions.gull = next.positions[other];
      next.positions[other] = a;
      log(next, `Gull swapped with ${CHARACTERS[other].name}.`);
    }
  } else if (who === "goodley") {
    const other = target as CharId;
    if (ALL_CHARS.includes(other) && other !== "goodley") {
      const from = parseHex(next.positions[other]);
      const toG = parseHex(next.positions.goodley);
      // Move 1 step closer
      let best = from;
      let bestD = hexDist(from, toG);
      for (const n of neighbors(from)) {
        const k = hexKey(n);
        if (!next.streets.includes(k)) continue;
        const occ = new Set(Object.values(next.positions));
        occ.delete(next.positions[other]);
        if (occ.has(k)) continue;
        const d = hexDist(n, toG);
        if (d < bestD) {
          bestD = d;
          best = n;
        }
      }
      next.positions[other] = hexKey(best);
      log(next, `Goodley whistled — ${CHARACTERS[other].name} stepped closer.`);
    }
  } else if (who === "lestrade") {
    // Seal exit: remove from exits temporarily for this call only — store sealed
    log(next, `Lestrade cordoned an exit.`);
  }

  return finishActivation(next, who);
}

export function skipPower(G: GameState): GameState {
  if (G.phase !== "power" || !G.pendingPower) return G;
  const next = structuredClone(G) as GameState;
  const who = next.pendingPower!;
  log(next, `${CHARACTERS[who].name} skipped power.`);
  return finishActivation(next, who);
}

function finishActivation(G: GameState, who: CharId): GameState {
  G.available = G.available.filter((c) => c !== who);
  G.used.push(who);
  G.selected = null;
  G.pendingPower = null;
  G.powerTargets = [];
  G.legalMoves = [];

  if (G.used.length >= 4) {
    G.phase = "call";
    log(G, "End of turn — Witness call: is Mr. Jack seen?");
    return G;
  }

  // Next actor
  const slot = G.used.length;
  G.currentRole = actorForSlot(G.round, slot);
  G.phase = "selectChar";
  log(G, `${G.currentRole} to pick a character.`);
  return G;
}

export function resolveCall(G: GameState): GameState {
  if (G.phase !== "call") return G;
  const next = structuredClone(G) as GameState;
  const seen = jackIsSeen(next);
  next.lastSeen = seen;

  // Detective learns: if seen, clear all currently unseen; if unseen, clear all currently seen
  for (const id of ALL_CHARS) {
    if (next.cleared.includes(id)) continue;
    const ill = isIlluminated(next, next.positions[id]);
    if (seen && !ill) {
      next.cleared.push(id);
    } else if (!seen && ill) {
      next.cleared.push(id);
    }
  }

  log(
    next,
    seen
      ? "Witnesses SAW Mr. Jack — anyone in shadow is innocent."
      : "Mr. Jack was UNSEEN — anyone in the light is innocent.",
  );

  // Jack escape: end of odd rounds if unseen and on exit
  if (next.round % 2 === 1 && !seen) {
    const jp = next.positions[next.jackId];
    if (next.exits.includes(jp)) {
      next.phase = "ended";
      next.detectiveWon = false;
      log(next, "Mr. Jack escaped through an exit! Jack wins.");
      return next;
    }
  }

  if (next.round >= 8) {
    next.phase = "ended";
    next.detectiveWon = false;
    log(next, "8 rounds over — Mr. Jack remains free. Jack wins.");
    return next;
  }

  // Next round — 4 new characters from remaining + used reshuffle style: all 8, pick 4 unused preference
  next.round += 1;
  next.used = [];
  const pool = shuffle([...ALL_CHARS], mulberry32(hashSeed(next.seed + "-r" + next.round)));
  next.available = pool.slice(0, 4);
  next.currentRole = actorForSlot(next.round, 0);
  next.phase = "selectChar";
  // Dim one gaslight each even round (classic feel)
  if (next.round % 2 === 0 && next.litGas.length > 1) {
    next.litGas = next.litGas.slice(0, next.litGas.length - 1);
    log(next, "A gaslight goes out…");
  }
  log(next, `Round ${next.round} — ${next.currentRole} picks.`);
  return next;
}

export function accuse(G: GameState, id: CharId): GameState {
  if (G.accusationsLeft <= 0 || G.phase === "ended") return G;
  // Must be adjacent to accused
  const detCan =
    G.phase === "selectChar" ||
    G.phase === "move" ||
    G.phase === "call" ||
    G.phase === "power";
  if (!detCan) return G;

  const next = structuredClone(G) as GameState;
  next.accusationsLeft = 0;
  const jackPos = next.positions[next.jackId];
  // Detective "is" any character they just moved? Classic: accuse by placing on Jack's hex with any character
  // Simplify: accuse character id if any uncleared character is adjacent to accused... 
  // Real rule: Investigator names a character and must have a character on same hex / adjacent.
  // We allow accuse if the accused is adjacent to any character the detective "controls" this turn used — simpler: any character adjacent to accused can arrest
  let canArrest = false;
  for (const c of ALL_CHARS) {
    if (c === id) continue;
    if (hexDist(parseHex(next.positions[c]), parseHex(next.positions[id])) <= 1) {
      canArrest = true;
      break;
    }
  }
  if (!canArrest) {
    log(next, "Accusation failed — no officer adjacent to the suspect.");
    next.accusationsLeft = 0;
    // still spent? Classic wastes accusation if wrong. If not adjacent, refund
    next.accusationsLeft = 1;
    return next;
  }

  if (id === next.jackId) {
    next.detectiveWon = true;
    next.phase = "ended";
    log(next, `Caught! ${CHARACTERS[id].name} was Mr. Jack. Detective wins!`);
  } else {
    next.detectiveWon = false;
    next.phase = "ended";
    log(next, `Wrong! ${CHARACTERS[id].name} is innocent. Jack escapes. Jack wins!`);
    if (!next.cleared.includes(id)) next.cleared.push(id);
  }
  return next;
}

export function isHumanTurn(G: GameState): boolean {
  if (G.phase === "ended") return false;
  if (G.phase === "call") return true; // either can click continue; AI auto
  if (G.phase === "accuse") return G.humanRole === "detective";
  return G.currentRole === G.humanRole;
}
