import { MoveName, Phase, type PublicGameState } from "./types";

export type ActivityItem = {
  id: string;
  text: string;
  /** Extra “why” line shown under the alert / Hits entry */
  detail?: string;
  tone?: "info" | "warn" | "good" | "hot";
};

function ordinal(n: number): string {
  const j = n % 10;
  const k = n % 100;
  if (j === 1 && k !== 11) return `${n}st`;
  if (j === 2 && k !== 12) return `${n}nd`;
  if (j === 3 && k !== 13) return `${n}rd`;
  return `${n}th`;
}

/** Cards still belonging to a player this trick (hand + face-down if any). */
export function cardsLeftInDeal(game: PublicGameState): number {
  return Math.max(
    ...game.players.map((p) => p.handCount + (p.hasChosen || p.faceDownCard ? 1 : 0)),
    0,
  );
}

/** Trick number within the current deal (1 … handSize). */
export function trickNumber(game: PublicGameState): number {
  const handSize = game.handSize || 10;
  const left = cardsLeftInDeal(game);
  return Math.min(handSize, Math.max(1, handSize - left + 1));
}

export function trickLabel(game: PublicGameState): string {
  const handSize = game.handSize || 10;
  const n = trickNumber(game);
  return `${ordinal(n)} draw (${n}/${handSize})`;
}

export function dealLabel(game: PublicGameState): string {
  return `Deal ${game.round}`;
}

/**
 * Compact “who locked in” line for the status pill footer
 * (keeps the main alert free for take explanations / your action).
 */
export function lockStatusLine(game: PublicGameState): string | null {
  if (game.ended) return null;

  const watching = game.yourIndex < 0;
  const you = watching ? undefined : game.players[game.yourIndex];
  const ready = game.players.filter((p) => p.hasChosen).length;
  const total = game.players.length;
  const waiting = game.players.filter((p) => !p.hasChosen);
  const readyOthers = game.players.filter((p) => p.hasChosen && !p.isYou);
  const stillOut = game.players.filter((p) => !p.hasChosen && !p.isYou);

  if (game.phase === Phase.ChooseCard) {
    if (watching) {
      return `${ready}/${total} locked in`;
    }
    if (!you?.hasChosen) {
      if (readyOthers.length === 0) {
        return ready === 0
          ? `0/${total} locked — pick a card`
          : `${ready}/${total} locked — your turn`;
      }
      if (stillOut.length === 0) {
        return `${readyOthers.length} locked — your turn`;
      }
      return `${readyOthers.length} locked · still out: you + ${stillOut.map((p) => p.name).join(", ")}`;
    }
    if (waiting.length > 0) {
      return `Waiting: ${waiting.map((p) => p.name).join(", ")} · ${ready}/${total} locked`;
    }
    return `${ready}/${total} locked`;
  }

  if (game.phase === Phase.PlaceCard) {
    const left = game.players.filter((p) => p.faceDownCard).length;
    if (left <= 0) return null;
    return left === 1
      ? "1 card still placing"
      : `${left} cards still placing · low → high`;
  }

  return null;
}

export function phaseStatus(game: PublicGameState): {
  headline: string;
  detail: string;
  tone: "info" | "warn" | "good" | "hot";
} {
  if (game.ended) {
    return {
      headline: "Game over",
      detail: "Fewest bull heads wins · highest score loses the race.",
      tone: "good",
    };
  }

  const watching = game.yourIndex < 0;
  const you = watching ? undefined : game.players[game.yourIndex];
  const overThreshold = game.players.filter((p) => p.points >= game.pointsToEnd);

  if (watching) {
    if (game.phase === Phase.ChooseCard) {
      return {
        headline: "Watching — players picking cards",
        detail: "You'll join the lobby for the next game.",
        tone: "info",
      };
    }
    return {
      headline: "Watching — cards placing",
      detail: "Lowest card goes first. You'll join the lobby for the next game.",
      tone: "info",
    };
  }

  const finalDealNote =
    game.thresholdReached && overThreshold.length > 0
      ? `Final deal — ${overThreshold.map((p) => `${p.name} ${p.points}`).join(", ")} ≥${game.pointsToEnd}.`
      : "";

  if (game.phase === Phase.ChooseCard) {
    if (!you?.hasChosen) {
      return {
        headline: game.thresholdReached
          ? "Final deal — pick a card"
          : "Pick a card to play",
        detail: finalDealNote || "Tap a card from your hand.",
        tone: game.thresholdReached || game.players.some((p) => p.hasChosen && !p.isYou)
          ? "hot"
          : "info",
      };
    }
    if (game.players.some((p) => !p.hasChosen)) {
      return {
        headline: "Card locked",
        detail: finalDealNote || "Waiting for the rest of the table…",
        tone: "warn",
      };
    }
  }

  if (game.phase === Phase.PlaceCard) {
    const placeOpts = you?.availableMoves?.[MoveName.PlaceCard] ?? [];
    if (placeOpts.length > 1 && placeOpts.every((m) => m.replace)) {
      // Official Rule 4: card lower than every row end → choose any row to take
      return {
        headline: "Too low for every row — pick a row to take",
        detail:
          "Rule: your card fits nowhere. Choose any row (usually fewest 🐂). Your card starts that row. Or switch to another hand card.",
        tone: "hot",
      };
    }
    if (placeOpts.length === 1) {
      return {
        headline: "Your card is placing",
        detail: "On the board now (or auto-placing)…",
        tone: "warn",
      };
    }
    return {
      headline: "Placing cards on the table",
      detail: "Lowest card goes first · watch the board…",
      tone: "info",
    };
  }

  return { headline: "Playing…", detail: "", tone: "info" };
}

function who(p: { isYou?: boolean; name: string }): string {
  return p.isYou ? "You" : p.name;
}

function cardsWord(n: number): string {
  return n === 1 ? "1 card" : `${n} cards`;
}

function bullsWord(n: number): string {
  return n === 1 ? "1 🐂" : `${n} 🐂`;
}

/**
 * Official 6 Nimmt takes (both score the row’s bull heads):
 * 1) Full row — card fits the closest lower end, but that row already has 5 cards
 *    (6th card). Player must take those 5; their card starts the row.
 * 2) Lowest card — card is lower than every row end. Player chooses any row to
 *    take; their card starts that row.
 */
function describeRowTake(
  prev: PublicGameState,
  next: PublicGameState,
  playerPrev: PublicGameState["players"][0],
  playerNext: PublicGameState["players"][0],
  cardsTaken: number,
  bulls: number,
): { text: string; detail?: string } {
  const name = who(playerNext);
  const played =
    playerPrev.faceDownCard && playerPrev.faceDownCard.number > 0
      ? playerPrev.faceDownCard.number
      : null;

  // Which table row was replaced? After a take, that row is just [played].
  let takenRowIndex = -1;
  let takenRow: typeof prev.rows[0] = [];
  if (played != null) {
    for (let r = 0; r < next.rows.length; r++) {
      const nr = next.rows[r];
      if (nr.length === 1 && nr[0]?.number === played) {
        takenRowIndex = r;
        takenRow = prev.rows[r] ?? [];
        break;
      }
    }
  }

  const ends = prev.rows
    .map((row) => row[row.length - 1]?.number)
    .filter((n): n is number => n != null);
  const endsLabel =
    ends.length > 0 ? ends.slice().sort((a, b) => a - b).join(", ") : "—";
  const lower = played != null ? ends.filter((e) => e < played) : [];
  const tooLow = played != null && lower.length === 0;
  const closestEnd = lower.length > 0 ? Math.max(...lower) : null;
  const closestRow =
    closestEnd != null
      ? prev.rows.find((r) => r[r.length - 1]?.number === closestEnd)
      : null;
  const closestLen = closestRow?.length ?? 0;
  // Rule 3: would have been the 6th card on the closest row
  const fullRow = !tooLow && closestEnd != null && closestLen >= 5;

  const rowLabel =
    takenRowIndex >= 0
      ? `row ${takenRowIndex + 1}`
      : takenRow.length
        ? `row ending #${takenRow[takenRow.length - 1]?.number}`
        : "a row";
  const endOfTaken =
    takenRow.length > 0 ? takenRow[takenRow.length - 1]?.number : null;

  const handSize = next.handSize || 10;
  // After this take, cards left are roughly post-place; use prev for “which trick”
  const lateDeal = trickNumber(prev) >= Math.max(1, handSize - 2);
  const lateNote = lateDeal
    ? " Late in the deal, rows fill up and leftover low cards often have nowhere to go."
    : "";

  // Rule 3 — full row (6th card)
  if (played != null && fullRow && closestEnd != null) {
    if (playerNext.isYou) {
      return {
        text: `You took ${cardsWord(cardsTaken)} (${bullsWord(bulls)}) — 6th card on a full row`,
        detail: `Why: #${played} must go on the closest lower end (#${closestEnd}), but that row was already 5/5. The 6th card always takes the whole row; your #${played} starts it. No choice and no switch.${lateNote}`,
      };
    }
    return {
      text: `${name}: #${played} was 6th on full row (closest #${closestEnd}) — ${bullsWord(bulls)}`,
      detail: `That row was already 5/5, so the 6th card takes all ${cardsWord(cardsTaken)}.`,
    };
  }

  // Rule 4 — lowest card: choose any row
  if (played != null && tooLow) {
    const which =
      endOfTaken != null
        ? `${rowLabel} (was ending #${endOfTaken})`
        : rowLabel;
    if (playerNext.isYou) {
      return {
        text: `You took ${cardsWord(cardsTaken)} (${bullsWord(bulls)}) — card too low for every row`,
        detail: `Why: #${played} is lower than every row end (${endsLabel}), so it can’t sit on the table. You take one whole row (${which}); #${played} starts it. Next time: spend low cards earlier, or switch to another hand card when this happens.${lateNote}`,
      };
    }
    return {
      text: `${name}: #${played} too low for every row — took ${which}: ${bullsWord(bulls)}`,
      detail: `Row ends were ${endsLabel}; #${played} fit nowhere.`,
    };
  }

  // Fallback
  if (playerNext.isYou) {
    return {
      text: `You took ${cardsWord(cardsTaken)} from ${rowLabel} for ${bullsWord(bulls)} · total ${playerNext.points} 🐂`,
      detail: `Those cards’ bull heads are added to your score. Fewest 🐂 wins.${lateNote}`,
    };
  }
  return {
    text: `${name} took ${cardsWord(cardsTaken)} for ${bullsWord(bulls)} · total ${playerNext.points} 🐂`,
  };
}

/**
 * Meaningful events only: who took how many cards / bull heads.
 * Skips noise (locked in, normal place on table).
 */
export function diffActivity(
  prev: PublicGameState | null,
  next: PublicGameState,
): ActivityItem[] {
  const out: ActivityItem[] = [];
  const ts = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const handSize = next.handSize || 10;

  if (!prev) {
    out.push({
      id: ts(),
      text: `${dealLabel(next)}: you drew ${handSize} cards · ${trickLabel(next)}`,
      tone: "good",
    });
    return out;
  }

  // End of previous 10-card hand → new deal is big news (not a score hit)
  if (next.round !== prev.round) {
    out.push({
      id: ts(),
      text: `${dealLabel(next)}: everyone drew ${handSize} new cards — scores keep · ${trickLabel(next)}`,
      tone: "good",
    });
  }

  // Row takes only — the events that change score
  for (let i = 0; i < next.players.length; i++) {
    const a = prev.players[i];
    const b = next.players[i];
    if (!a || !b) continue;

    const cardsTaken = Math.max(0, (b.discard?.length ?? 0) - (a.discard?.length ?? 0));
    const bulls = b.points - a.points;

    if (cardsTaken > 0 || bulls > 0) {
      const { text, detail } = describeRowTake(
        prev,
        next,
        a,
        b,
        cardsTaken || 1,
        bulls > 0 ? bulls : 0,
      );

      out.push({
        id: ts(),
        text,
        detail,
        tone: "hot",
      });

      const thr = next.pointsToEnd;
      if (a.points < thr && b.points >= thr && !next.ended) {
        out.push({
          id: ts(),
          text: `${who(b)} hit ${b.points} (≥${thr}) — finish this deal`,
          tone: "hot",
        });
      }
    }
  }

  if (!prev.ended && next.ended) {
    const ranked = [...next.players]
      .map((p, i) => ({ p, i }))
      .sort((x, y) => x.p.points - y.p.points);
    const lines = ranked
      .map(({ p }, rank) => `${rank + 1}. ${who(p)} ${p.points} 🐂`)
      .join(" · ");
    out.push({
      id: ts(),
      text: `Game over — ${lines}`,
      tone: "good",
    });
  }

  return out;
}
