import { useCallback, useEffect, useMemo, useState } from "react";
import { ALL_CHARS, CHARACTERS } from "./characters";
import { pixelPos } from "./board";
import {
  accuse,
  createGame,
  isHumanTurn,
  legalDestinations,
  moveCharacter,
  resolveCall,
  selectCharacter,
  skipPower,
  usePower,
} from "./engine";
import { runAiUntilHuman } from "./ai";
import type { CharId, GameState, HexKey, Role } from "./types";
import { parseHex } from "./types";

function HexPoly({
  q,
  r,
  size,
  fill,
  stroke,
  onClick,
  dim,
}: {
  q: number;
  r: number;
  size: number;
  fill: string;
  stroke: string;
  onClick?: () => void;
  dim?: boolean;
}) {
  const { x, y } = pixelPos({ q, r }, size);
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const ang = ((Math.PI / 180) * 60 * i - Math.PI / 6);
    pts.push(`${x + size * Math.cos(ang)},${y + size * Math.sin(ang)}`);
  }
  return (
    <polygon
      points={pts.join(" ")}
      fill={fill}
      stroke={stroke}
      strokeWidth={1.2}
      opacity={dim ? 0.45 : 1}
      onClick={onClick}
      style={{ cursor: onClick ? "pointer" : "default" }}
    />
  );
}

export function MrJackApp() {
  const [screen, setScreen] = useState<"menu" | "play">("menu");
  const [role, setRole] = useState<Role>("detective");
  const [vsAi, setVsAi] = useState(true);
  const [G, setG] = useState<GameState | null>(null);

  const apply = useCallback((fn: (g: GameState) => GameState) => {
    setG((prev) => {
      if (!prev) return prev;
      let next = fn(prev);
      if (next.vsAi) next = runAiUntilHuman(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!G || !G.vsAi || G.phase === "ended") return;
    if (isHumanTurn(G)) return;
    const t = window.setTimeout(() => {
      setG((prev) => (prev ? runAiUntilHuman(prev) : prev));
    }, 450);
    return () => clearTimeout(t);
  }, [G]);

  function start() {
    let g = createGame(role, vsAi);
    if (vsAi) g = runAiUntilHuman(g);
    setG(g);
    setScreen("play");
  }

  const suspects = useMemo(
    () => ALL_CHARS.filter((c) => G && !G.cleared.includes(c)),
    [G],
  );

  if (screen === "menu" || !G) {
    return (
      <div className="mx-auto max-w-lg px-4 py-8">
        <div className="felt-panel p-6 sm:p-8">
          <p className="text-center text-xs font-semibold uppercase tracking-[0.3em] text-amber-300/90">
            SFboardgames
          </p>
          <h1 className="mt-2 text-center text-3xl font-bold">
            Mr. Jack <span className="text-violet-300">🕵️</span>
          </h1>
          <p className="mt-2 text-center text-sm text-emerald-100/70">
            Whitechapel, 1888 — find the Ripper, or vanish into the fog.
          </p>
          <p className="mt-4 text-xs leading-relaxed text-emerald-100/50">
            Unofficial fan adaptation of the 2-player deduction game. Detective eliminates
            suspects with witness calls; Jack stays hidden (or escapes). Not affiliated with
            Hurrican / the designers.
          </p>

          <label className="mt-6 mb-1 block text-sm text-emerald-100/80">You play as</label>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["detective", "Detective", "Eliminate suspects, one accusation"],
                ["jack", "Mr. Jack", "Stay unseen 8 rounds or escape"],
              ] as const
            ).map(([id, label, blurb]) => (
              <button
                key={id}
                type="button"
                onClick={() => setRole(id)}
                className={`rounded-xl border px-3 py-3 text-left ${
                  role === id
                    ? "border-amber-300/70 bg-amber-400/15 ring-1 ring-amber-300/40"
                    : "border-white/10 bg-black/20"
                }`}
              >
                <div className="font-semibold">{label}</div>
                <div className="mt-0.5 text-xs text-emerald-100/55">{blurb}</div>
              </button>
            ))}
          </div>

          <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={vsAi}
              onChange={(e) => setVsAi(e.target.checked)}
              className="rounded"
            />
            Play vs AI (recommended)
          </label>

          <button
            type="button"
            onClick={start}
            className="mt-6 w-full rounded-xl bg-amber-400 px-4 py-3 font-semibold text-slate-900 hover:bg-amber-300"
          >
            Start investigation
          </button>
          <a
            href="/"
            className="mt-3 block text-center text-sm text-emerald-100/60 hover:text-emerald-100"
          >
            ← Back to 6 Nimmt!
          </a>
        </div>
      </div>
    );
  }

  const human = isHumanTurn(G);
  const size = 26;
  const positions = G.streets.map(parseHex);
  const xs = positions.map((h) => pixelPos(h, size).x);
  const ys = positions.map((h) => pixelPos(h, size).y);
  const pad = 40;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const maxX = Math.max(...xs) + pad;
  const maxY = Math.max(...ys) + pad;
  const vb = `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;

  return (
    <div className="mx-auto max-w-6xl px-3 py-4 sm:px-4 sm:py-6">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold sm:text-2xl">
            Mr. Jack <span className="text-violet-300">🕵️</span>
          </h1>
          <p className="text-xs text-emerald-100/70">
            Round {G.round}/8 · You: {G.humanRole === "detective" ? "Detective" : "Jack"}
            {G.humanRole === "jack" ? ` (${CHARACTERS[G.jackId].name})` : ""} ·{" "}
            {human ? "Your turn" : "AI thinking…"}
          </p>
        </div>
        <div className="flex gap-2">
          <a href="/" className="rounded-full border border-white/15 px-3 py-1 text-xs hover:bg-white/5">
            6 Nimmt!
          </a>
          <button
            type="button"
            className="rounded-full border border-white/15 px-3 py-1 text-xs hover:bg-white/5"
            onClick={() => {
              setScreen("menu");
              setG(null);
            }}
          >
            New game
          </button>
        </div>
      </header>

      {G.phase === "ended" ? (
        <div className="felt-panel mb-3 p-4 text-center">
          <p className="text-lg font-bold text-amber-300">
            {G.detectiveWon ? "Detective wins!" : "Mr. Jack wins!"}
          </p>
          <p className="mt-1 text-sm text-emerald-100/80">
            Mr. Jack was <strong>{CHARACTERS[G.jackId].name}</strong>.
          </p>
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[1fr_16rem]">
        <div className="felt-panel overflow-x-auto p-2 sm:p-3">
          <svg viewBox={vb} className="mx-auto h-auto w-full max-w-2xl">
            {G.buildings.map((k) => {
              const h = parseHex(k);
              return (
                <HexPoly
                  key={k}
                  q={h.q}
                  r={h.r}
                  size={size}
                  fill="#1e293b"
                  stroke="#475569"
                  dim
                />
              );
            })}
            {G.streets.map((k) => {
              const h = parseHex(k);
              const lit = G.litGas.includes(k);
              const exit = G.exits.includes(k);
              const man = G.manholes.includes(k);
              const legal = G.legalMoves.includes(k) && human && G.phase === "move";
              return (
                <HexPoly
                  key={k}
                  q={h.q}
                  r={h.r}
                  size={size}
                  fill={
                    legal
                      ? "rgba(251, 191, 36, 0.55)"
                      : lit
                        ? "rgba(254, 243, 199, 0.35)"
                        : exit
                          ? "rgba(52, 211, 153, 0.2)"
                          : "rgba(15, 23, 42, 0.55)"
                  }
                  stroke={legal ? "#fbbf24" : man ? "#64748b" : "#334155"}
                  onClick={
                    legal
                      ? () => apply((g) => moveCharacter(g, k as HexKey))
                      : undefined
                  }
                />
              );
            })}
            {ALL_CHARS.map((id) => {
              const h = parseHex(G.positions[id]);
              const { x, y } = pixelPos(h, size);
              const cleared = G.cleared.includes(id);
              const selected = G.selected === id;
              return (
                <g key={id}>
                  <circle
                    cx={x}
                    cy={y}
                    r={selected ? 14 : 12}
                    fill={CHARACTERS[id].color}
                    stroke={selected ? "#fbbf24" : "#0f172a"}
                    strokeWidth={selected ? 2.5 : 1.5}
                    opacity={cleared ? 0.35 : 1}
                  />
                  <text
                    x={x}
                    y={y + 3}
                    textAnchor="middle"
                    fontSize={8}
                    fontWeight={700}
                    fill="#0f172a"
                  >
                    {CHARACTERS[id].name.slice(0, 2)}
                  </text>
                </g>
              );
            })}
          </svg>
          <p className="mt-1 text-center text-[0.65rem] text-emerald-100/45">
            Gold hex = legal move · Pale = lit · Green edge = exit · Dark = building
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <div className="felt-panel p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-100/70">
              {G.phase === "selectChar" && human
                ? `${G.currentRole === "detective" ? "Detective" : "Jack"} — pick a character`
                : G.phase === "move" && human
                  ? "Click a gold hex to move"
                  : G.phase === "power" && human
                    ? `Power: ${CHARACTERS[G.pendingPower!]?.power ?? ""}`
                    : G.phase === "call"
                      ? "Witness call"
                      : "Status"}
            </p>

            {G.phase === "selectChar" && human ? (
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                {G.available.map((id) => (
                  <button
                    key={id}
                    type="button"
                    disabled={G.cleared.includes(id) && G.currentRole === "detective"}
                    onClick={() => apply((g) => selectCharacter(g, id))}
                    className="rounded-lg border border-white/10 px-2 py-2 text-left text-xs hover:bg-white/5 disabled:opacity-40"
                    style={{ borderLeftColor: CHARACTERS[id].color, borderLeftWidth: 3 }}
                  >
                    <div className="font-semibold">{CHARACTERS[id].name}</div>
                    <div className="text-[0.65rem] text-emerald-100/50">
                      move {CHARACTERS[id].moveMin}–{CHARACTERS[id].moveMax}
                    </div>
                  </button>
                ))}
              </div>
            ) : null}

            {G.phase === "power" && human ? (
              <div className="mt-2 flex flex-col gap-1">
                {G.pendingPower === "holmes" ? (
                  <button
                    type="button"
                    className="rounded-lg bg-amber-400 px-3 py-2 text-sm font-semibold text-slate-900"
                    onClick={() => apply((g) => usePower(g, "alibi"))}
                  >
                    Draw alibi card
                  </button>
                ) : (
                  (G.powerTargets as string[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      className="rounded-lg border border-white/15 px-2 py-1.5 text-left text-xs hover:bg-white/5"
                      onClick={() => apply((g) => usePower(g, t))}
                    >
                      {ALL_CHARS.includes(t as CharId)
                        ? `Target ${CHARACTERS[t as CharId].name}`
                        : `Hex ${t}`}
                    </button>
                  ))
                )}
                <button
                  type="button"
                  className="text-xs text-emerald-100/50 hover:text-emerald-100"
                  onClick={() => apply((g) => skipPower(g))}
                >
                  Skip power
                </button>
              </div>
            ) : null}

            {G.phase === "call" ? (
              <button
                type="button"
                className="mt-2 w-full rounded-xl bg-amber-400 px-3 py-2 text-sm font-semibold text-slate-900"
                onClick={() => apply((g) => resolveCall(g))}
              >
                Resolve witness call
              </button>
            ) : null}

            {G.phase === "move" && human && G.selected ? (
              <p className="mt-2 text-xs text-emerald-100/60">
                {CHARACTERS[G.selected].name}: {G.legalMoves.length || legalDestinations(G, G.selected).length}{" "}
                destinations
              </p>
            ) : null}
          </div>

          <div className="felt-panel p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-100/70">
              Suspects ({suspects.length} left)
            </p>
            <ul className="mt-1.5 max-h-40 space-y-1 overflow-y-auto text-xs">
              {ALL_CHARS.map((id) => {
                const cleared = G.cleared.includes(id);
                return (
                  <li
                    key={id}
                    className={`flex items-center justify-between rounded-md px-2 py-1 ${
                      cleared ? "opacity-40 line-through" : "bg-black/20"
                    }`}
                  >
                    <span>
                      <span
                        className="mr-1.5 inline-block h-2 w-2 rounded-full"
                        style={{ background: CHARACTERS[id].color }}
                      />
                      {CHARACTERS[id].name}
                    </span>
                    {!cleared &&
                    G.humanRole === "detective" &&
                    G.accusationsLeft > 0 &&
                    G.phase !== "ended" ? (
                      <button
                        type="button"
                        className="text-[0.65rem] text-red-300 hover:underline"
                        onClick={() => apply((g) => accuse(g, id))}
                      >
                        Accuse
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <p className="mt-1 text-[0.65rem] text-emerald-100/40">
              Accusations left: {G.accusationsLeft}
              {G.lastSeen === true
                ? " · Last call: SEEN"
                : G.lastSeen === false
                  ? " · Last call: UNSEEN"
                  : ""}
            </p>
          </div>

          <div className="felt-panel max-h-36 overflow-y-auto p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-100/70">
              Log
            </p>
            <ul className="mt-1 space-y-0.5 text-[0.7rem] text-emerald-100/65">
              {G.log.map((line, i) => (
                <li key={i}>· {line}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
