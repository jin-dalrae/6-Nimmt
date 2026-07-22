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

  const you = game.players[game.yourIndex];
  const ready = game.players.filter((p) => p.hasChosen).length;
  const total = game.players.length;
  const waiting = game.players.filter((p) => !p.hasChosen);
  const readyOthers = game.players.filter((p) => p.hasChosen && !p.isYou);
  const stillOut = game.players.filter((p) => !p.hasChosen && !p.isYou);
  const overThreshold = game.players.filter((p) => p.points >= game.pointsToEnd);

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
        headline: "Your card is too low — take a row",
        detail: "Tap a row on the table (you score its bull heads).",
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

/** Diff previous → next public state into human activity lines. */
export function diffActivity(
  prev: PublicGameState | null,
  next: PublicGameState,
): ActivityItem[] {
  const out: ActivityItem[] = [];
  const ts = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  if (!prev) {
    out.push({
      id: ts(),
      text: `${dealLabel(next)} started — ${trickLabel(next)}. Everyone picks a card.`,
      tone: "info",
    });
    return out;
  }

  if (next.round !== prev.round) {
    out.push({
      id: ts(),
      text: `${dealLabel(next)} — new hands dealt. Starting ${trickLabel(next)}.`,
      tone: "good",
    });
  }

  // Someone locked in a card
  for (let i = 0; i < next.players.length; i++) {
    const a = prev.players[i];
    const b = next.players[i];
    if (!a || !b) continue;
    if (!a.hasChosen && b.hasChosen) {
      out.push({
        id: ts(),
        text: b.isYou
          ? "You locked in a card."
          : `${b.name} locked in a card.${b.isBot ? " 🤖" : ""}`,
        tone: b.isYou ? "good" : "info",
      });
    }
  }

  // All revealed → place phase
  if (prev.phase === Phase.ChooseCard && next.phase === Phase.PlaceCard) {
    const cards = next.players
      .filter((p) => p.faceDownCard && p.faceDownCard.number > 0)
      .map((p) => `${p.name} #${p.faceDownCard!.number}`)
      .join(" · ");
    out.push({
      id: ts(),
      text: `All cards revealed (low → high): ${cards}`,
      tone: "good",
    });
  }

  // Placements / row takes (face-down cleared, points or rows changed)
  for (let i = 0; i < next.players.length; i++) {
    const a = prev.players[i];
    const b = next.players[i];
    if (!a || !b) continue;
    const had = a.faceDownCard && a.faceDownCard.number !== 0 ? a.faceDownCard : null;
    const hadHidden = a.hasChosen && a.faceDownCard?.number === 0;
    const gone = a.hasChosen && !b.hasChosen;

    if (gone) {
      const delta = b.points - a.points;
      const cardNum = had?.number;
      if (delta > 0) {
        out.push({
          id: ts(),
          text: `${b.isYou ? "You" : b.name} took a row${cardNum ? ` with #${cardNum}` : ""} → +${delta} 🐂 (now ${b.points})`,
          tone: "hot",
        });
        const thr = next.pointsToEnd;
        if (a.points < thr && b.points >= thr && !next.ended) {
          out.push({
            id: ts(),
            text: `${b.isYou ? "You are" : `${b.name} is`} at ${b.points} (≥${thr}) — finish this deal, then scores are final.`,
            tone: "hot",
          });
        }
      } else if (cardNum) {
        out.push({
          id: ts(),
          text: `${b.isYou ? "You" : b.name} placed #${cardNum} on the table.`,
          tone: "info",
        });
      } else if (hadHidden || a.hasChosen) {
        out.push({
          id: ts(),
          text: `${b.isYou ? "You" : b.name} placed a card on the table.`,
          tone: "info",
        });
      }
    }
  }

  // New trick after place → choose
  if (
    prev.phase === Phase.PlaceCard &&
    next.phase === Phase.ChooseCard &&
    next.round === prev.round &&
    !next.ended
  ) {
    out.push({
      id: ts(),
      text: `Trick done → ${trickLabel(next)}. Pick your next card.`,
      tone: "good",
    });
  }

  if (!prev.ended && next.ended) {
    const winners = next.winnerIndexes.map((i) => next.players[i]?.name).filter(Boolean);
    const losers = (next.loserIndexes ?? [])
      .map((i) => next.players[i]?.name)
      .filter(Boolean);
    out.push({
      id: ts(),
      text: `Deal finished — game over! Winner${winners.length > 1 ? "s" : ""} (fewest 🐂): ${winners.join(", ")}. Highest: ${losers.join(", ")}.`,
      tone: "good",
    });
  }

  return out;
}
