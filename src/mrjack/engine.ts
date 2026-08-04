import { ALL_CHARS, CHARACTERS } from "./characters";
import {
  buildMap,
  hexDist,
  neighbors,
  OFFICIAL_STARTS,
  SETUP_CORDONED_EXITS,
  SETUP_COVERED_MANHOLES,
  SETUP_LIT_GAS,
  stepInDir,
} from "./board";
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

function log(G: GameState, msg: string) {
  G.log = [msg, ...G.log].slice(0, 40);
}

/** Who acts for activation slots 0..3 within a round (official pattern) */
function actorForSlot(round: number, slot: number): Role {
  // Odd: D J J D | Even: J D D J
  const odd = round % 2 === 1;
  const pattern: Role[] = odd
    ? ["detective", "jack", "jack", "detective"]
    : ["jack", "detective", "detective", "jack"];
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

  // Official setup: 6 lit gaslights, 2 covered manholes, 2 cordoned exits
  const litGas = SETUP_LIT_GAS.map(hexKey);
  const coveredManholes = SETUP_COVERED_MANHOLES.map(hexKey);
  const cordonedExits = SETUP_CORDONED_EXITS.map(hexKey);

  const positions = {} as Record<CharId, HexKey>;
  for (const id of ALL_CHARS) {
    positions[id] = hexKey(OFFICIAL_STARTS[id]);
  }

  const G: GameState = {
    seed,
    round: 1,
    phase: "selectChar",
    currentRole: actorForSlot(1, 0),
    available,
    used: [],
    positions,
    watsonDir: 0,
    litGas,
    gasSockets: map.gasSockets,
    manholes: map.manholes,
    coveredManholes,
    exits: map.exits,
    cordonedExits,
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
      "Whitechapel: 4 exits (2 cordoned), 6 gaslights lit, 2 manholes covered.",
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

function openManholes(G: GameState): HexKey[] {
  const covered = new Set(G.coveredManholes ?? []);
  return G.manholes.filter((m) => !covered.has(m));
}

/** May end movement on this hex? */
function canStop(G: GameState, who: CharId, to: HexKey): boolean {
  if (G.buildings.includes(to) || G.gasSockets.includes(to)) return false;
  if (!G.streets.includes(to)) return false;
  const occ = occupied(G);
  occ.delete(G.positions[who]);
  if (occ.has(to)) return false;
  return true;
}

/** May path through this hex (Stealthy can cross buildings/gas)? */
function canTraverse(G: GameState, who: CharId, to: HexKey): boolean {
  if (who === "stealthy") {
    if (G.buildings.includes(to) || G.gasSockets.includes(to)) return true;
    return G.streets.includes(to);
  }
  if (G.buildings.includes(to) || G.gasSockets.includes(to)) return false;
  return G.streets.includes(to);
}

/** BFS reachable hexes in [min,max] steps */
export function legalDestinations(G: GameState, who: CharId): HexKey[] {
  const def = CHARACTERS[who];
  const start = parseHex(G.positions[who]);
  const result = new Set<HexKey>();
  const q: Array<{ h: Hex; d: number }> = [{ h: start, d: 0 }];
  const seen = new Map<string, number>();
  seen.set(hexKey(start), 0);
  const sewer = openManholes(G);

  while (q.length) {
    const { h, d } = q.shift()!;
    if (d > 0 && d >= def.moveMin && d <= def.moveMax) {
      const k = hexKey(h);
      if (canStop(G, who, k)) result.add(k);
    }
    if (d >= def.moveMax) continue;

    const nextHexes: Hex[] = [...neighbors(h)];
    // Any character on an open manhole may spend 1 MP to another open manhole
    if (sewer.includes(hexKey(h))) {
      for (const m of sewer) {
        if (m !== hexKey(h)) nextHexes.push(parseHex(m));
      }
    }

    for (const n of nextHexes) {
      const nk = hexKey(n);
      if (!canTraverse(G, who, nk)) continue;
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

export function getWatsonBeamHexes(G: GameState): HexKey[] {
  const w = G.positions.watson;
  if (!w) return [];
  const wh = parseHex(w);
  const beam: HexKey[] = [];
  let curr = stepInDir(wh, G.watsonDir ?? 0);

  // Obstacles (buildings, gas sockets) stop the beam
  while (
    G.streets.includes(hexKey(curr)) &&
    !G.buildings.includes(hexKey(curr)) &&
    !G.gasSockets.includes(hexKey(curr))
  ) {
    beam.push(hexKey(curr));
    curr = stepInDir(curr, G.watsonDir ?? 0);
  }

  return beam;
}

function isIlluminated(G: GameState, pos: HexKey): boolean {
  // Lit gaslight illuminates all adjoining street hexes
  for (const g of G.litGas) {
    if (hexDist(parseHex(g), parseHex(pos)) === 1) return true;
  }

  // Watson lantern beam (Watson himself is not lit by it)
  if (pos !== G.positions.watson) {
    const beam = getWatsonBeamHexes(G);
    if (beam.includes(pos)) return true;
  }

  // Adjacent to another character
  for (const id of ALL_CHARS) {
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
  if (
    who === "holmes" ||
    who === "smith" ||
    who === "gull" ||
    who === "goodley" ||
    who === "lestrade" ||
    who === "watson" ||
    who === "bert"
  ) {
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
    case "watson":
      return ["dir_0", "dir_1", "dir_2", "dir_3", "dir_4", "dir_5"];
    case "lestrade":
      // Move a cordon onto any currently open exit (frees one, blocks another)
      return G.exits.filter((e) => !(G.cordonedExits ?? []).includes(e));
    case "bert":
      // Move a cover onto any currently open manhole
      return openManholes(G);
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
    if ((next.powerTargets as string[]).includes(target)) {
      if (next.litGas.length) {
        next.litGas = next.litGas.slice(1);
      }
      next.litGas.push(target as HexKey);
      log(next, `Smith moved a gaslight.`);
    }
  } else if (who === "gull") {
    const other = target as CharId;
    if ((ALL_CHARS as string[]).includes(other) && other !== "gull") {
      const a = next.positions.gull;
      next.positions.gull = next.positions[other];
      next.positions[other] = a;
      log(next, `Gull swapped with ${CHARACTERS[other].name}.`);
    }
  } else if (who === "goodley") {
    const other = target as CharId;
    if ((ALL_CHARS as string[]).includes(other) && other !== "goodley") {
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
    // Move one cordon onto the chosen open exit (free an old one)
    const open = next.exits.filter(
      (e) => !(next.cordonedExits ?? []).includes(e),
    );
    if (open.includes(target as HexKey) && (next.cordonedExits?.length ?? 0) > 0) {
      next.cordonedExits = [
        ...(next.cordonedExits ?? []).slice(1),
        target as HexKey,
      ];
      log(next, `Lestrade moved a police cordon.`);
    }
  } else if (who === "bert") {
    // Move one manhole cover onto an open manhole
    if (openManholes(next).includes(target as HexKey) && next.coveredManholes.length) {
      next.coveredManholes = [
        ...next.coveredManholes.slice(1),
        target as HexKey,
      ];
      log(next, `Bert moved a manhole cover.`);
    }
  } else if (who === "watson") {
    if (target.startsWith("dir_")) {
      const dirIndex = Number(target.replace("dir_", ""));
      if (dirIndex >= 0 && dirIndex <= 5) {
        next.watsonDir = dirIndex;
        log(next, `Watson oriented his lantern direction (${dirIndex}).`);
      }
    }
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

  if (next.round <= 4 && next.litGas.length > 0) {
    const ext = next.litGas.shift();
    if (ext) {
      log(next, `End of Round ${next.round}: Gaslight at (${ext}) went out.`);
    }
  }

  // Jack escape: if unseen this call and standing on an open (uncordoned) exit
  if (!seen) {
    const jp = next.positions[next.jackId];
    const openExits = next.exits.filter(
      (e) => !(next.cordonedExits ?? []).includes(e),
    );
    if (openExits.includes(jp)) {
      next.phase = "ended";
      next.detectiveWon = false;
      log(next, "Mr. Jack escaped through an open exit! Jack wins.");
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
