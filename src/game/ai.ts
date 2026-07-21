/**
 * Bot card selection: Gemini when GEMINI_API_KEY is set, else heuristics.
 * Host can pick play style: easy | solid | sharp | wild
 */

import type { Card, GameState } from "./types";
import { MoveName, Phase } from "./types";

const GEMINI_MODEL = "gemini-2.5-flash";

export type AiStyle = "easy" | "solid" | "sharp" | "wild";

export const AI_STYLES: Array<{
  id: AiStyle;
  label: string;
  blurb: string;
}> = [
  {
    id: "easy",
    label: "Easy",
    blurb: "Loose plays — good for learning",
  },
  {
    id: "solid",
    label: "Solid",
    blurb: "Balanced, avoids big rows",
  },
  {
    id: "sharp",
    label: "Sharp",
    blurb: "Careful, low-risk Gemini",
  },
  {
    id: "wild",
    label: "Wild",
    blurb: "Unpredictable table chaos",
  },
];

export function isAiStyle(v: unknown): v is AiStyle {
  return v === "easy" || v === "solid" || v === "sharp" || v === "wild";
}

/** Thinking pause so bots don't blur the table (ms). */
export function botPaceMs(style: AiStyle): number {
  switch (style) {
    case "easy":
      return 700;
    case "solid":
      return 900;
    case "sharp":
      return 1100;
    case "wild":
      return 550;
  }
}

function stylePrompt(style: AiStyle): string {
  switch (style) {
    case "easy":
      return `Style: EASY. Play casually. Prefer mid-range cards. Don't over-optimize. Occasional suboptimal cards are fine.`;
    case "solid":
      return `Style: SOLID. Standard good play. Avoid taking 6th cards. Prefer tight fits on short rows. Keep high cards for later.`;
    case "sharp":
      return `Style: SHARP / expert. Minimize expected bull heads. Track which rows are dangerous (length 4–5). Dump risky cards only when forced. Prefer the safest legal play.`;
    case "wild":
      return `Style: WILD. Be unpredictable. Sometimes bluff with extreme cards (very low or very high). Create table chaos on purpose.`;
  }
}

function temperatureFor(style: AiStyle): number {
  switch (style) {
    case "easy":
      return 0.9;
    case "solid":
      return 0.45;
    case "sharp":
      return 0.2;
    case "wild":
      return 1.15;
  }
}

/** Heuristic weights by style. */
function heuristicChooseCard(G: GameState, playerIndex: number, style: AiStyle): Card {
  const player = G.players[playerIndex];
  const hand = [...player.hand].sort((a, b) => a.number - b.number);
  if (hand.length === 1) return hand[0];

  // Easy / wild: sometimes pure random
  if (style === "easy" && Math.random() < 0.35) {
    return hand[Math.floor(Math.random() * hand.length)];
  }
  if (style === "wild" && Math.random() < 0.45) {
    return hand[Math.floor(Math.random() * hand.length)];
  }

  const rowEnds = G.rows.map((row) => row[row.length - 1].number);
  const rowLens = G.rows.map((row) => row.length);

  let best = hand[0];
  let bestScore = -Infinity;

  const dangerWeight = style === "sharp" ? 1.4 : style === "solid" ? 1 : 0.7;
  const gapWeight = style === "sharp" ? 1.3 : 1;
  const noise =
    style === "sharp" ? 0.15 : style === "solid" ? 0.5 : style === "easy" ? 2.5 : 3.5;

  for (const card of hand) {
    let score = 0;
    const fitEnds = rowEnds.filter((n) => n < card.number);
    if (fitEnds.length === 0) {
      score -= (30 + card.points * 4) * dangerWeight;
    } else {
      const bestEnd = Math.max(...fitEnds);
      const row = rowEnds.indexOf(bestEnd);
      const len = rowLens[row];
      if (len >= 5) {
        score -= (40 + G.rows[row].reduce((s, c) => s + c.points, 0)) * dangerWeight;
      } else {
        score += (20 - len * 3) * gapWeight;
        score += Math.max(0, 12 - (card.number - bestEnd)) * gapWeight;
        if (style === "sharp" && len >= 4) score -= 8;
      }
    }
    if (card.number > 90) score += style === "sharp" ? 4 : 2;
    if (card.number >= 30 && card.number <= 70) score += 1;
    score += Math.random() * noise;

    if (score > bestScore) {
      bestScore = score;
      best = card;
    }
  }

  return best;
}

export function heuristicPlaceRow(
  G: GameState,
  playerIndex: number,
  style: AiStyle = "solid",
): {
  row: number;
  replace: boolean;
} {
  const opts = G.players[playerIndex].availableMoves?.[MoveName.PlaceCard] ?? [];
  if (opts.length === 0) throw new Error("No place moves");
  if (opts.length === 1) return opts[0];

  if ((style === "easy" || style === "wild") && Math.random() < 0.4) {
    return opts[Math.floor(Math.random() * opts.length)];
  }

  let best = opts[0];
  let bestPts = Infinity;
  for (const opt of opts) {
    const pts = G.rows[opt.row].reduce((s, c) => s + c.points, 0);
    // Sharp: slight preference for shorter rows when points equal
    const tie =
      style === "sharp" ? G.rows[opt.row].length * 0.01 : Math.random() * 0.01;
    if (pts + tie < bestPts) {
      bestPts = pts + tie;
      best = opt;
    }
  }
  return best;
}

async function geminiJson(
  apiKey: string,
  prompt: string,
  temperature: number,
): Promise<string | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature,
        maxOutputTokens: 64,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!res.ok) {
    console.warn("Gemini error", res.status, await res.text().catch(() => ""));
    return null;
  }

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
}

function boardSummary(G: GameState, playerIndex: number): string {
  const player = G.players[playerIndex];
  const rows = G.rows
    .map(
      (row, i) =>
        `Row ${i}: [${row.map((c) => `${c.number}(${c.points})`).join(", ")}] len=${row.length}/5`,
    )
    .join("\n");
  const scores = G.players
    .map((p, i) => `${p.name ?? i}: ${p.points}pts hand=${p.hand.length}`)
    .join(", ");
  const hand = player.hand.map((c) => `${c.number}(${c.points}🐂)`).join(", ");
  return `Scores: ${scores}\nRows:\n${rows}\nYour hand: ${hand}\nYour points: ${player.points}\nRound: ${G.round}`;
}

/** Easy/solid can skip Gemini sometimes for speed; sharp always tries. */
function shouldUseGemini(style: AiStyle, apiKey: string | undefined): boolean {
  if (!apiKey) return false;
  if (style === "sharp") return true;
  if (style === "solid") return true;
  if (style === "easy") return Math.random() < 0.35; // mostly heuristic
  if (style === "wild") return Math.random() < 0.55;
  return true;
}

export async function chooseCardForBot(
  G: GameState,
  playerIndex: number,
  apiKey: string | undefined,
  style: AiStyle = "solid",
): Promise<Card> {
  const hand = G.players[playerIndex].hand;
  if (hand.length === 0) throw new Error("Empty hand");
  if (hand.length === 1) return hand[0];

  if (shouldUseGemini(style, apiKey)) {
    try {
      const text = await geminiJson(
        apiKey!,
        `You play 6 Nimmt! (Take 6). Goal: fewest bull-head points.
Rules: play one card face-down; lowest card places first on the row ending with the highest number still below it; 6th card takes the row (score those points). If card is lower than all row ends, player chooses a row to take.
${stylePrompt(style)}
${boardSummary(G, playerIndex)}
Pick exactly one card number from your hand.
Reply JSON only: {"card": <number>}`,
        temperatureFor(style),
      );
      if (text) {
        const parsed = JSON.parse(text) as { card?: number };
        const card = hand.find((c) => c.number === parsed.card);
        if (card) return card;
      }
    } catch (e) {
      console.warn("Gemini choose fallback", e);
    }
  }

  return heuristicChooseCard(G, playerIndex, style);
}

export async function placeRowForBot(
  G: GameState,
  playerIndex: number,
  apiKey: string | undefined,
  style: AiStyle = "solid",
): Promise<{ row: number; replace: boolean }> {
  const opts = G.players[playerIndex].availableMoves?.[MoveName.PlaceCard] ?? [];
  if (opts.length === 0) throw new Error("No place moves");
  if (opts.length === 1) return opts[0];

  if (shouldUseGemini(style, apiKey) && G.phase === Phase.PlaceCard) {
    try {
      const costs = opts
        .map((o) => {
          const pts = G.rows[o.row].reduce((s, c) => s + c.points, 0);
          return `row ${o.row}: ${pts} points — cards [${G.rows[o.row].map((c) => c.number).join(",")}]`;
        })
        .join("\n");
      const text = await geminiJson(
        apiKey!,
        `You must take one entire row in 6 Nimmt! (your card is too low).
${stylePrompt(style)}
Your card: ${G.players[playerIndex].faceDownCard?.number}
Options:\n${costs}
Reply JSON only: {"row": <0-3>}`,
        temperatureFor(style),
      );
      if (text) {
        const parsed = JSON.parse(text) as { row?: number };
        const match = opts.find((o) => o.row === parsed.row);
        if (match) return match;
      }
    } catch (e) {
      console.warn("Gemini place fallback", e);
    }
  }

  return heuristicPlaceRow(G, playerIndex, style);
}

export const BOT_NAMES = [
  "Gemini",
  "Bull Bot",
  "Nimmt-o",
  "Card Shark",
  "Row Runner",
  "Six-Averse",
  "Ox Oracle",
  "Table Tern",
  "Felt Phantom",
];
