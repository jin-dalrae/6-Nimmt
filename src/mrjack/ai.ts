import { CHARACTERS } from "./characters";
import {
  accuse,
  isHumanTurn,
  jackIsSeen,
  legalDestinations,
  moveCharacter,
  resolveCall,
  selectCharacter,
  skipPower,
  usePower,
} from "./engine";
import type { CharId, GameState, HexKey } from "./types";
import { parseHex } from "./types";
import { hexDist } from "./board";

/** Simple AI: plays the non-human role */
export function aiStep(G: GameState): GameState {
  if (G.phase === "ended" || isHumanTurn(G)) return G;

  if (G.phase === "call") {
    return resolveCall(G);
  }

  if (G.phase === "selectChar") {
    const picks = G.available;
    if (!picks.length) return G;
    let choice = picks[0]!;
    if (G.currentRole === "detective") {
      // Prefer uncleared characters
      choice =
        picks.find((c) => !G.cleared.includes(c)) ??
        picks[Math.floor(Math.random() * picks.length)]!;
    } else {
      // Jack: prefer moving jack if available, else random
      choice = picks.includes(G.jackId)
        ? G.jackId
        : picks[Math.floor(Math.random() * picks.length)]!;
    }
    return selectCharacter(G, choice);
  }

  if (G.phase === "move" && G.selected) {
    const moves = G.legalMoves.length ? G.legalMoves : legalDestinations(G, G.selected);
    if (!moves.length) {
      // stuck — skip by finishing somehow: re-pick legal or stay invalid
      return G;
    }
    let dest = moves[0]!;
    if (G.currentRole === "jack") {
      if (G.selected === G.jackId) {
        // Prefer shadow / exit
        const scored = moves.map((m) => {
          let s = Math.random();
          if (G.exits.includes(m)) s += 3;
          if (!G.litGas.includes(m)) s += 1;
          // away from others
          let minD = 99;
          for (const id of Object.keys(G.positions) as CharId[]) {
            if (id === G.selected) continue;
            minD = Math.min(minD, hexDist(parseHex(m), parseHex(G.positions[id])));
          }
          s += Math.min(minD, 3) * 0.3;
          return { m, s };
        });
        scored.sort((a, b) => b.s - a.s);
        dest = scored[0]!.m;
      }
    } else {
      // Detective: toward uncleared clusters / light
      dest = moves[Math.floor(Math.random() * moves.length)]!;
    }
    return moveCharacter(G, dest as HexKey);
  }

  if (G.phase === "power" && G.pendingPower) {
    const t = G.powerTargets;
    if (!t.length) return skipPower(G);
    if (G.pendingPower === "holmes") return usePower(G, "alibi");
    const pick = t[Math.floor(Math.random() * t.length)]!;
    return usePower(G, pick as string);
  }

  return G;
}

export function runAiUntilHuman(G: GameState, max = 12): GameState {
  let cur = G;
  for (let i = 0; i < max; i++) {
    if (cur.phase === "ended" || isHumanTurn(cur)) break;
    const next = aiStep(cur);
    if (next === cur) break;
    cur = next;
  }
  return cur;
}

export function suggestAccuse(G: GameState): CharId | null {
  const suspects = (Object.keys(CHARACTERS) as CharId[]).filter(
    (c) => !G.cleared.includes(c),
  );
  if (suspects.length === 1) return suspects[0]!;
  return null;
}

export { jackIsSeen };
