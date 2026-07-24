/**
 * Gemini-backed Mr. Jack opponent (server-side).
 * Falls back to heuristic aiStep when no key or API fails.
 */

import { ALL_CHARS, CHARACTERS } from "./characters";
import {
  isHumanTurn,
  legalDestinations,
  moveCharacter,
  resolveCall,
  selectCharacter,
  skipPower,
  usePower,
} from "./engine";
import { aiStep } from "./ai";
import type { CharId, GameState, HexKey, Role } from "./types";

const GEMINI_MODEL = "gemini-2.5-flash";

export type AiAction =
  | { action: "resolveCall" }
  | { action: "select"; char: CharId }
  | { action: "move"; hex: HexKey }
  | { action: "power"; target: string }
  | { action: "skipPower" };

function summaryForAi(G: GameState): string {
  const aiRole: Role = G.humanRole === "detective" ? "jack" : "detective";
  const pos = ALL_CHARS.map(
    (id) =>
      `${CHARACTERS[id].name}@${G.positions[id]}${G.cleared.includes(id) ? "(cleared)" : ""}`,
  ).join(", ");
  const jackLine =
    aiRole === "jack"
      ? `You ARE Mr. Jack: ${CHARACTERS[G.jackId].name} at ${G.positions[G.jackId]}. Stay unseen or escape via exit on odd rounds when unseen.`
      : `You are the Detective. Eliminate suspects via witness calls. Jack's identity is secret. Accuse only when sure (1 try).`;

  return `Mr. Jack (unofficial digital rules). Round ${G.round}/8. Phase: ${G.phase}. Current actor: ${G.currentRole}.
You control: ${aiRole}. ${jackLine}
Available characters this turn: ${G.available.map((c) => CHARACTERS[c].name).join(", ") || "(none)"}
Selected: ${G.selected ? CHARACTERS[G.selected].name : "none"}
Cleared (innocent): ${G.cleared.map((c) => CHARACTERS[c].name).join(", ") || "none"}
Lit gas hexes: ${G.litGas.join(" ") || "none"}
Exits: ${G.exits.join(" ")}
Positions: ${pos}
Last witness call: ${G.lastSeen === null ? "n/a" : G.lastSeen ? "SEEN" : "UNSEEN"}
Pending power: ${G.pendingPower ?? "none"} targets: ${(G.powerTargets as string[]).join(", ") || "none"}
Legal move hexes: ${G.legalMoves.join(" ") || (G.selected ? legalDestinations(G, G.selected).join(" ") : "n/a")}`;
}

async function geminiJson(
  apiKey: string,
  prompt: string,
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
        temperature: 0.35,
        maxOutputTokens: 96,
        responseMimeType: "application/json",
      },
    }),
  });
  if (!res.ok) {
    console.warn("MrJack Gemini error", res.status, await res.text().catch(() => ""));
    return null;
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
}

function parseAction(raw: string): AiAction | null {
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const action = String(j.action || "");
    if (action === "resolveCall") return { action: "resolveCall" };
    if (action === "skipPower") return { action: "skipPower" };
    if (action === "select" && typeof j.char === "string") {
      const char = j.char.toLowerCase() as CharId;
      if (ALL_CHARS.includes(char)) return { action: "select", char };
      // allow character display name
      const byName = ALL_CHARS.find(
        (c) => CHARACTERS[c].name.toLowerCase() === String(j.char).toLowerCase(),
      );
      if (byName) return { action: "select", char: byName };
    }
    if (action === "move" && typeof j.hex === "string") {
      return { action: "move", hex: j.hex as HexKey };
    }
    if (action === "power" && typeof j.target === "string") {
      return { action: "power", target: j.target };
    }
  } catch {
    // ignore
  }
  return null;
}

export function applyAiAction(G: GameState, act: AiAction): GameState | null {
  if (G.phase === "ended" || isHumanTurn(G)) return null;

  switch (act.action) {
    case "resolveCall": {
      if (G.phase !== "call") return null;
      return resolveCall(G);
    }
    case "select": {
      if (G.phase !== "selectChar") return null;
      if (!G.available.includes(act.char)) return null;
      const next = selectCharacter(G, act.char);
      return next.selected === act.char ? next : null;
    }
    case "move": {
      if (G.phase !== "move" || !G.selected) return null;
      const legal =
        G.legalMoves.length > 0 ? G.legalMoves : legalDestinations(G, G.selected);
      if (!legal.includes(act.hex)) return null;
      const patched = structuredClone(G) as GameState;
      patched.legalMoves = legal;
      const next = moveCharacter(patched, act.hex);
      return next.positions[G.selected] === act.hex || next.phase !== G.phase
        ? next
        : null;
    }
    case "power": {
      if (G.phase !== "power") return null;
      const next = usePower(G, act.target);
      return next !== G ? next : null;
    }
    case "skipPower": {
      if (G.phase !== "power") return null;
      return skipPower(G);
    }
  }
}

function phaseHint(G: GameState): string {
  if (G.phase === "call") {
    return `Reply JSON only: {"action":"resolveCall"}`;
  }
  if (G.phase === "selectChar") {
    return `Pick one available character id from: ${G.available.join(", ")}.
Reply JSON only: {"action":"select","char":"<id>"}`;
  }
  if (G.phase === "move" && G.selected) {
    const legal =
      G.legalMoves.length > 0 ? G.legalMoves : legalDestinations(G, G.selected);
    return `Move ${CHARACTERS[G.selected].name} to one legal hex: ${legal.join(" ") || "(none)"}.
Reply JSON only: {"action":"move","hex":"q,r"}`;
  }
  if (G.phase === "power") {
    const t = (G.powerTargets as string[]).join(", ");
    return `Use power or skip. Targets: ${t || "none"}.
Reply JSON only: {"action":"power","target":"..."} or {"action":"skipPower"}`;
  }
  return `Reply JSON only with a legal action for phase ${G.phase}.`;
}

/** One AI decision; Gemini when possible, else heuristic. */
export async function geminiAiStep(
  G: GameState,
  apiKey: string | undefined,
): Promise<GameState> {
  if (G.phase === "ended" || isHumanTurn(G)) return G;

  // Call phase is mechanical — always resolve
  if (G.phase === "call") return resolveCall(G);

  if (apiKey) {
    try {
      const text = await geminiJson(
        apiKey,
        `You play Mr. Jack (board game, unofficial digital rules). Take exactly ONE legal action for the current phase.
${summaryForAi(G)}
${phaseHint(G)}`,
      );
      if (text) {
        const act = parseAction(text);
        if (act) {
          const next = applyAiAction(G, act);
          if (next) return next;
        }
      }
    } catch (e) {
      console.warn("MrJack Gemini step failed", e);
    }
  }

  return aiStep(G);
}

/** Advance AI until human must act (or ended). */
export async function runAiUntilHumanGemini(
  G: GameState,
  apiKey: string | undefined,
  max = 14,
): Promise<GameState> {
  let cur = G;
  for (let i = 0; i < max; i++) {
    if (cur.phase === "ended" || isHumanTurn(cur)) break;
    const next = await geminiAiStep(cur, apiKey);
    if (next === cur) {
      // force heuristic progress once
      const forced = aiStep(cur);
      if (forced === cur) break;
      cur = forced;
      continue;
    }
    cur = next;
  }
  return cur;
}
