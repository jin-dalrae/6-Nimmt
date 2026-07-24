import type { CharId, GameState, Role } from "./types";
import type { MrJackPublicState } from "./protocol";

/** Is it this seat's turn to act? */
export function isSeatTurn(G: GameState, seatRole: Role | null): boolean {
  if (!seatRole || G.phase === "ended") return false;
  // Either seat may advance the witness call
  if (G.phase === "call") return true;
  return G.currentRole === seatRole;
}

/**
 * Build a per-seat public view.
 * Detective never receives jackId until the game ends.
 * Jack always sees their identity.
 */
export function toPublicMrJack(
  G: GameState,
  seatRole: Role | null,
): MrJackPublicState {
  const ended = G.phase === "ended";
  const revealJack = ended || seatRole === "jack";
  const yourTurn = isSeatTurn(G, seatRole);

  // Strip private log lines for detective (secret Jack identity)
  const log = G.log.filter((line) => {
    if (revealJack) return true;
    if (/You are secretly:/i.test(line)) return false;
    if (/was Mr\. Jack/i.test(line) && !ended) return false;
    return true;
  });

  return {
    seed: G.seed,
    round: G.round,
    phase: G.phase,
    currentRole: G.currentRole,
    available: [...G.available],
    used: [...G.used],
    positions: { ...G.positions },
    litGas: [...G.litGas],
    gasSockets: [...G.gasSockets],
    manholes: [...G.manholes],
    exits: [...G.exits],
    buildings: [...G.buildings],
    streets: [...G.streets],
    jackId: revealJack ? G.jackId : null,
    alibiDeckCount: G.alibiDeck.length,
    cleared: [...G.cleared],
    lastSeen: G.lastSeen,
    detectiveWon: G.detectiveWon,
    accusationsLeft: G.accusationsLeft,
    selected: G.selected,
    legalMoves: yourTurn && G.phase === "move" ? [...G.legalMoves] : [],
    pendingPower: G.pendingPower,
    powerTargets:
      yourTurn && G.phase === "power" ? [...G.powerTargets] : [],
    log,
    yourRole: seatRole,
    yourTurn,
    ended,
  };
}

export function roleLabel(role: Role | null): string {
  if (role === "detective") return "Detective";
  if (role === "jack") return "Mr. Jack";
  return "Unassigned";
}

export function allChars(): CharId[] {
  return [
    "holmes",
    "watson",
    "smith",
    "lestrade",
    "stealthy",
    "gull",
    "bert",
    "goodley",
  ];
}
