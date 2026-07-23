import { MoveName, Phase, type PublicGameState } from "./types";

export type ActivityItem = {
  id: string;
  text: string;
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
  const ready = game.players.filter((p) => p.hasChosen).length;
  const total = game.players.length;
  const waiting = game.players.filter((p) => !p.hasChosen);
  const readyOthers = game.players.filter((p) => p.hasChosen && !p.isYou);
  const stillOut = game.players.filter((p) => !p.hasChosen && !p.isYou);
  const overThreshold = game.players.filter((p) => p.points >= game.pointsToEnd);

  if (watching) {
    if (game.phase === Phase.ChooseCard) {
      return {
        headline: "Watching — players picking cards",
        detail: `${ready}/${total} locked in. You'll join the lobby for the next game.`,
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
      ? ` Final deal — ${overThreshold.map((p) => `${p.name} ${p.points}`).join(", ")} ≥${game.pointsToEnd}.`
      : "";

  if (game.phase === Phase.ChooseCard) {
    if (!you?.hasChosen) {
      if (readyOthers.length > 0) {
        return {
          headline: `${readyOthers.length} already locked in — your turn`,
          detail:
            (stillOut.length > 0
              ? `Still waiting: you + ${stillOut.map((p) => p.name).join(", ")}.`
              : "Everyone else is ready. Pick a card from your hand.") + finalDealNote,
          tone: "hot",
        };
      }
      return {
        headline: game.thresholdReached
          ? "Final deal — pick a card"
          : "Pick a card to play",
        detail: `Nobody locked in yet · ${ready}/${total} ready.${finalDealNote}`,
        tone: game.thresholdReached ? "hot" : "info",
      };
    }
    if (waiting.length > 0) {
      return {
        headline: "Card locked — waiting on others",
        detail: `Waiting: ${waiting.map((p) => p.name).join(", ")} · ${ready}/${total} ready.${finalDealNote}`,
        tone: "warn",
      };
    }
  }

  if (game.phase === Phase.PlaceCard) {
    const placeOpts = you?.availableMoves?.[MoveName.PlaceCard] ?? [];
    if (placeOpts.length > 1) {
      return {
        headline: "Card too low — take a row or switch card",
        detail: "Tap a row to collect it, or pick another card from your hand.",
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

/** Explain a row take: full row vs too-low, closest end, bulls. */
function describeRowTake(
  prev: PublicGameState,
  playerPrev: PublicGameState["players"][0],
  playerNext: PublicGameState["players"][0],
  cardsTaken: number,
  bulls: number,
): string {
  const name = who(playerNext);
  const played =
    playerPrev.faceDownCard && playerPrev.faceDownCard.number > 0
      ? playerPrev.faceDownCard.number
      : null;

  let closestEnd: number | null = null;
  let prevRowLen = 0;
  let tooLow = false;
  let fullRow = false;

  if (played != null && prev.rows.length) {
    const ends = prev.rows
      .map((row) => row[row.length - 1]?.number)
      .filter((n): n is number => n != null);
    const lower = ends.filter((e) => e < played);
    if (lower.length === 0) {
      // Card lower than every row end → forced pick
      tooLow = true;
    } else {
      // Legal attach: closest lower end
      closestEnd = Math.max(...lower);
      const row = prev.rows.find((r) => r[r.length - 1]?.number === closestEnd);
      prevRowLen = row?.length ?? 0;
      // 6th card on a full row
      fullRow = prevRowLen >= 5;
    }
  }

  // Full row: "#46 was closest to #43 but that row was full → 7 🐂"
  if (played != null && fullRow && closestEnd != null) {
    if (playerNext.isYou) {
      return `Your #${played} was closest to #${closestEnd}, but that row was already full (${prevRowLen}/5) — you got ${bullsWord(bulls)}`;
    }
    return `${name} got ${bullsWord(bulls)} for a full row (#${played} closest to #${closestEnd})`;
  }

  // Too low for every row
  if (played != null && tooLow) {
    if (playerNext.isYou) {
      return `Your #${played} was lower than every row — took ${cardsWord(cardsTaken)} for ${bullsWord(bulls)}`;
    }
    return `${name} got ${bullsWord(bulls)} taking a row (#${played} too low for every end)`;
  }

  // Fallback with card count + bulls
  if (playerNext.isYou) {
    return `You got ${cardsWord(cardsTaken)} for ${bullsWord(bulls)} · total ${playerNext.points} 🐂`;
  }
  return `${name} got ${bullsWord(bulls)} · total ${playerNext.points} 🐂`;
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

  if (!prev) {
    out.push({
      id: ts(),
      text: `${dealLabel(next)} · ${trickLabel(next)} — hands dealt`,
      tone: "info",
    });
    return out;
  }

  if (next.round !== prev.round) {
    out.push({
      id: ts(),
      text: `${dealLabel(next)} — new hands (${trickLabel(next)})`,
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
      const text = describeRowTake(prev, a, b, cardsTaken || 1, bulls > 0 ? bulls : 0);

      out.push({
        id: ts(),
        text,
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
