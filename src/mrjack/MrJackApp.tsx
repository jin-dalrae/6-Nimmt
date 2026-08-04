import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePartySocket } from "partysocket/react";
import { ALL_CHARS, CHARACTERS } from "./characters";
import { buildMap, hexDist, pixelPos, stepInDir } from "./board";
import {
  accuse,
  createGame,
  getWatsonBeamHexes,
  isHumanTurn,
  legalDestinations,
  moveCharacter,
  resolveCall,
  selectCharacter,
  skipPower,
  usePower,
} from "./engine";
import { runAiUntilHuman } from "./ai";
// Gemini opponent runs on the Worker via POST /api/mrjack/ai (key never in browser)
import type {
  MrJackClientMessage,
  MrJackLobbyPlayer,
  MrJackPublicState,
  MrJackServerMessage,
} from "./protocol";
import { roleLabel } from "./public";
import type { CharId, GameState, HexKey, Role } from "./types";
import { parseHex } from "./types";
import {
  clearSessionToken,
  loadSessionToken,
  saveSessionToken,
} from "../game/sessionToken";

function randomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

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
    const ang = (Math.PI / 180) * 60 * i - Math.PI / 6;
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

/** Shared board + side panel for local GameState or online public view */
function BoardView({
  G,
  human,
  yourRole,
  jackId,
  onSelect,
  onMove,
  onPower,
  onSkipPower,
  onResolveCall,
  onAccuse,
}: {
  G: {
    round: number;
    phase: string;
    currentRole: Role;
    available: CharId[];
    positions: Record<CharId, HexKey>;
    watsonDir?: number;
    litGas: HexKey[];
    gasSockets?: HexKey[];
    manholes?: HexKey[];
    coveredManholes?: HexKey[];
    exits: HexKey[];
    cordonedExits?: HexKey[];
    buildings: HexKey[];
    streets: HexKey[];
    cleared: CharId[];
    lastSeen: boolean | null;
    detectiveWon: boolean | null;
    accusationsLeft: number;
    selected: CharId | null;
    legalMoves: HexKey[];
    pendingPower: CharId | null;
    powerTargets: HexKey[] | CharId[];
    log: string[];
    ended: boolean;
  };
  human: boolean;
  yourRole: Role | null;
  jackId: CharId | null;
  onSelect: (id: CharId) => void;
  onMove: (hex: HexKey) => void;
  onPower: (t: string) => void;
  onSkipPower: () => void;
  onResolveCall: () => void;
  onAccuse: (id: CharId) => void;
}) {
  const size = 18; // denser official-scale board (13 columns)
  const defaultExits = useMemo(() => buildMap().exits, []);
  const watsonBeamHexes = useMemo(
    () => getWatsonBeamHexes(G as unknown as GameState),
    [G],
  );
  const mapFallback = useMemo(() => buildMap(), []);
  const gasSockets = G.gasSockets ?? mapFallback.gasSockets;
  const manholes = G.manholes ?? mapFallback.manholes;
  const coveredManholes = G.coveredManholes ?? [];

  // Bound the full map: streets + buildings + gas + exits + tokens
  const boundKeys = useMemo(() => {
    const keys = new Set<string>([
      ...G.streets,
      ...G.buildings,
      ...G.exits,
      ...gasSockets,
      ...manholes,
      ...Object.values(G.positions),
      ...defaultExits,
    ]);
    return [...keys];
  }, [
    G.streets,
    G.buildings,
    G.exits,
    gasSockets,
    manholes,
    G.positions,
    defaultExits,
  ]);
  const boundHexes = boundKeys.map(parseHex);
  const xs = boundHexes.map((h) => pixelPos(h, size).x);
  const ys = boundHexes.map((h) => pixelPos(h, size).y);
  // Hex outer radius ≈ size; tokens/labels need extra room so edges aren't clipped
  const pad = size * 2.1;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const maxX = Math.max(...xs) + pad;
  const maxY = Math.max(...ys) + pad;
  const vb = `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
  const suspects = ALL_CHARS.filter((c) => !G.cleared.includes(c));

  return (
    <>
      {G.ended ? (
        <div className="felt-panel mb-3 p-4 text-center">
          <p className="text-lg font-bold text-amber-300">
            {G.detectiveWon ? "Detective wins!" : "Mr. Jack wins!"}
          </p>
          {jackId ? (
            <p className="mt-1 text-sm text-emerald-100/80">
              Mr. Jack was <strong>{CHARACTERS[jackId].name}</strong>.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="felt-panel min-w-0 overflow-visible p-2 sm:p-3">
          {G.log && G.log.length > 0 && (
            <div className="mb-2.5 rounded-xl border border-violet-400/30 bg-violet-950/40 p-2.5 text-xs text-violet-100">
              <div className="font-bold text-violet-300 text-[0.7rem] uppercase tracking-wider mb-1 flex items-center justify-between">
                <span>⚡ Recent Activity & Opponent Moves</span>
              </div>
              <ul className="space-y-0.5 font-mono text-[0.7rem] text-violet-100/90">
                {G.log.slice(0, 3).map((item, idx) => (
                  <li key={idx} className="truncate">
                    • {item}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <svg
            viewBox={vb}
            className="mx-auto h-auto w-full max-w-none"
            style={{ overflow: "visible" }}
          >
            {G.buildings.map((k) => {
              const h = parseHex(k);
              const { x, y } = pixelPos(h, size);
              return (
                <g key={`b-${k}`}>
                  <HexPoly
                    q={h.q}
                    r={h.r}
                    size={size}
                    fill="#1e293b"
                    stroke="#475569"
                    dim
                  />
                  <text
                    x={x}
                    y={y + 3}
                    textAnchor="middle"
                    fontSize={10}
                    opacity={0.55}
                    pointerEvents="none"
                  >
                    🏛️
                  </text>
                </g>
              );
            })}
            {gasSockets.map((k) => {
              const h = parseHex(k);
              const { x, y } = pixelPos(h, size);
              const lit = G.litGas.includes(k);
              return (
                <g key={`g-${k}`}>
                  <HexPoly
                    q={h.q}
                    r={h.r}
                    size={size}
                    fill={lit ? "rgba(254, 243, 199, 0.4)" : "rgba(30, 41, 59, 0.85)"}
                    stroke={lit ? "#fbbf24" : "#475569"}
                  />
                  <text
                    x={x}
                    y={y + 4}
                    textAnchor="middle"
                    fontSize={11}
                    pointerEvents="none"
                  >
                    {lit ? "💡" : "🕯️"}
                  </text>
                </g>
              );
            })}
            {G.streets.map((k) => {
              const h = parseHex(k);
              const { x, y } = pixelPos(h, size);
              const lit = G.litGas.some(
                (g) => hexDist(parseHex(g), h) === 1,
              );
              const man = manholes.includes(k);
              const covered = coveredManholes.includes(k);
              const cordoned = G.cordonedExits ?? [];
              const isOpenExit = G.exits.includes(k) && !cordoned.includes(k);
              const isCordonedExit =
                G.exits.includes(k) && cordoned.includes(k)
                  ? true
                  : defaultExits.includes(k) &&
                    !G.exits.includes(k);
              const inWatsonBeam = watsonBeamHexes.includes(k);
              const legal =
                G.legalMoves.includes(k) && human && G.phase === "move";
              const isPowerTarget =
                G.phase === "power" && human && (G.powerTargets as string[]).includes(k);

              return (
                <g key={k}>
                  <HexPoly
                    q={h.q}
                    r={h.r}
                    size={size}
                    fill={
                      isPowerTarget
                        ? "rgba(56, 189, 248, 0.45)"
                        : legal
                          ? "rgba(251, 191, 36, 0.55)"
                          : inWatsonBeam
                            ? "rgba(253, 224, 71, 0.45)"
                            : isOpenExit
                              ? "rgba(52, 211, 153, 0.28)"
                              : isCordonedExit
                                ? "rgba(244, 63, 94, 0.28)"
                                : lit
                                  ? "rgba(254, 243, 199, 0.28)"
                                  : "rgba(15, 23, 42, 0.55)"
                    }
                    stroke={
                      isPowerTarget
                        ? "#38bdf8"
                        : legal
                          ? "#fbbf24"
                          : isCordonedExit
                            ? "#f43f5e"
                            : isOpenExit
                              ? "#34d399"
                              : man
                                ? "#94a3b8"
                                : "#334155"
                    }
                    onClick={
                      isPowerTarget
                        ? () => onPower(k)
                        : legal
                          ? () => onMove(k as HexKey)
                          : undefined
                    }
                  />

                  {isOpenExit ? (
                    <text
                      x={x}
                      y={y + 4}
                      textAnchor="middle"
                      fontSize={9}
                      pointerEvents="none"
                    >
                      🚪
                    </text>
                  ) : isCordonedExit ? (
                    <text
                      x={x}
                      y={y + 4}
                      textAnchor="middle"
                      fontSize={9}
                      pointerEvents="none"
                    >
                      🚧
                    </text>
                  ) : null}

                  {man && !isOpenExit && !isCordonedExit ? (
                    <text
                      x={x}
                      y={y - 4}
                      textAnchor="middle"
                      fontSize={8}
                      pointerEvents="none"
                      opacity={covered ? 0.35 : 0.85}
                    >
                      {covered ? "🚫" : "🕳️"}
                    </text>
                  ) : null}
                </g>
              );
            })}

            {G.positions.watson && (() => {
              const wh = parseHex(G.positions.watson);
              const { x: wx, y: wy } = pixelPos(wh, size);
              const beam = watsonBeamHexes;
              const endHex = beam.length
                ? parseHex(beam[beam.length - 1]!)
                : stepInDir(wh, G.watsonDir ?? 0);
              const { x: fx, y: fy } = pixelPos(endHex, size);

              return (
                <line
                  x1={wx}
                  y1={wy}
                  x2={fx}
                  y2={fy}
                  stroke="#fde047"
                  strokeWidth={3.5}
                  strokeDasharray="6 3"
                  opacity={0.85}
                  pointerEvents="none"
                />
              );
            })()}

            {ALL_CHARS.map((id) => {
              const h = parseHex(G.positions[id]);
              const { x, y } = pixelPos(h, size);
              const cleared = G.cleared.includes(id);
              const selected = G.selected === id;
              const isPowerTarget =
                G.phase === "power" && human && (G.powerTargets as string[]).includes(id);

              return (
                <g
                  key={id}
                  onClick={isPowerTarget ? () => onPower(id) : undefined}
                  style={{ cursor: isPowerTarget ? "pointer" : "default" }}
                >
                  {isPowerTarget && (
                    <circle
                      cx={x}
                      cy={y}
                      r={16}
                      fill="none"
                      stroke="#38bdf8"
                      strokeWidth={2.5}
                      className="animate-pulse"
                    />
                  )}
                  <circle
                    cx={x}
                    cy={y}
                    r={selected ? 14 : 12}
                    fill={CHARACTERS[id].color}
                    stroke={selected ? "#fbbf24" : isPowerTarget ? "#38bdf8" : "#0f172a"}
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
                    pointerEvents="none"
                  >
                    {CHARACTERS[id].name.slice(0, 2)}
                  </text>
                </g>
              );
            })}
          </svg>
          <p className="mt-1.5 text-center text-[0.65rem] text-emerald-100/55">
            Gold = move · 🚪 open exit · 🚧 cordon · 💡 lit gas · 🕯️ socket · 🕳️ manhole · 🏛️ building
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
                      : human
                        ? "Your turn"
                        : "Waiting for opponent…"}
            </p>

            {G.phase === "selectChar" && human ? (
              <>
                {(() => {
                  const isOdd = G.round % 2 === 1;
                  // Official: odd D-J-J-D, even J-D-D-J
                  const slotPattern: Role[] = isOdd
                    ? ["detective", "jack", "jack", "detective"]
                    : ["jack", "detective", "detective", "jack"];
                  const currentSlotIndex = Math.min(3, Math.max(0, 4 - G.available.length));

                  return (
                    <div className="mt-2 mb-3 rounded-xl border border-white/10 bg-black/30 p-2 text-xs">
                      <div className="mb-1 flex items-center justify-between text-[0.65rem] font-semibold text-emerald-100/60">
                        <span>Round {G.round} Draft Sequence</span>
                        <span>Slot {currentSlotIndex + 1}/4</span>
                      </div>
                      <div className="grid grid-cols-4 gap-1 text-center font-bold text-[0.65rem]">
                        {slotPattern.map((r, idx) => {
                          const isCurrent = idx === currentSlotIndex;
                          const isPast = idx < currentSlotIndex;
                          return (
                            <div
                              key={idx}
                              className={`rounded py-1 px-1 border transition ${
                                isCurrent
                                  ? "border-amber-400 bg-amber-400/20 text-amber-200"
                                  : isPast
                                    ? "border-white/5 bg-black/40 text-emerald-100/30 line-through"
                                    : "border-white/10 bg-black/20 text-emerald-100/60"
                              }`}
                            >
                              {r === "detective" ? "🕵️ Det" : "🎩 Jack"}
                            </div>
                          );
                        })}
                      </div>
                      {G.available.length === 1 && (
                        <p className="mt-1.5 text-[0.65rem] text-amber-200/90 italic">
                          📌 Slot 4/4 (Final activation): Only 1 character remains ({CHARACTERS[G.available[0]].name}).
                        </p>
                      )}
                    </div>
                  );
                })()}

                <div className="grid grid-cols-2 gap-1.5">
                  {G.available.map((id) => (
                    <button
                      key={id}
                      type="button"
                      disabled={G.cleared.includes(id) && G.currentRole === "detective"}
                      onClick={() => onSelect(id)}
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
              </>
            ) : null}

            {G.phase === "power" && human ? (
              <div className="mt-2 flex flex-col gap-1">
                {G.pendingPower === "holmes" ? (
                  <button
                    type="button"
                    className="rounded-lg bg-amber-400 px-3 py-2 text-sm font-semibold text-slate-900"
                    onClick={() => onPower("alibi")}
                  >
                    Draw alibi card
                  </button>
                ) : (
                  (G.powerTargets as string[]).map((t) => {
                    let label = `Target Hex (${t})`;
                    if (ALL_CHARS.includes(t as CharId)) {
                      label = `Target ${CHARACTERS[t as CharId].name}`;
                    } else if (G.pendingPower === "lestrade") {
                      label = `🚧 Cordon Exit at (${t})`;
                    } else if (G.pendingPower === "smith") {
                      label = `💡 Light Gas Socket at (${t})`;
                    } else if (G.pendingPower === "gull") {
                      label = `🔄 Swap position with ${CHARACTERS[t as CharId]?.name ?? t}`;
                    } else if (G.pendingPower === "watson") {
                      const dirIdx = Number(t.replace("dir_", ""));
                      const arrows = ["↗ Right", "↘ South-East", "↙ South-West", "↖ Left", "↖ North-West", "↗ North-East"];
                      label = `🔦 Point Lantern: ${arrows[dirIdx] ?? t}`;
                    } else if (G.pendingPower === "goodley") {
                      label = `🎺 Pull ${CHARACTERS[t as CharId]?.name ?? t} 1 step closer`;
                    }
                    return (
                      <button
                        key={t}
                        type="button"
                        className="rounded-lg border border-sky-400/30 bg-sky-500/10 px-2 py-1.5 text-left text-xs font-medium text-sky-100 hover:bg-sky-500/20"
                        onClick={() => onPower(t)}
                      >
                        {label}
                      </button>
                    );
                  })
                )}
                <button
                  type="button"
                  className="text-xs text-emerald-100/50 hover:text-emerald-100"
                  onClick={onSkipPower}
                >
                  Skip power
                </button>
              </div>
            ) : null}

            {G.phase === "call" ? (
              <button
                type="button"
                className="mt-2 w-full rounded-xl bg-amber-400 px-3 py-2 text-sm font-semibold text-slate-900"
                onClick={onResolveCall}
              >
                Resolve witness call
              </button>
            ) : null}

            {G.phase === "move" && human && G.selected ? (
              <p className="mt-2 text-xs text-emerald-100/60">
                {CHARACTERS[G.selected].name}: {G.legalMoves.length} destinations
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
                    yourRole === "detective" &&
                    G.accusationsLeft > 0 &&
                    G.phase !== "ended" ? (
                      <button
                        type="button"
                        className="text-[0.65rem] text-red-300 hover:underline"
                        onClick={() => onAccuse(id)}
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
    </>
  );
}

export function MrJackApp() {
  const [mode, setMode] = useState<"menu" | "local" | "online">("menu");

  // —— Local vs AI ——
  const [role, setRole] = useState<Role>("detective");
  const [vsAi, setVsAi] = useState(true);
  const [localG, setLocalG] = useState<GameState | null>(null);
  const [hasGemini, setHasGemini] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiEngine, setAiEngine] = useState<string | null>(null);
  const aiBusyRef = useRef(false);

  useEffect(() => {
    fetch("/api/mrjack/status")
      .then((r) => r.json() as Promise<{ hasAiKey?: boolean }>)
      .then((j) => setHasGemini(Boolean(j.hasAiKey)))
      .catch(() => setHasGemini(false));
  }, []);

  /** Advance AI via Worker (Gemini when key set) with local heuristic fallback. */
  const runOpponentAsync = useCallback(async (g: GameState): Promise<GameState> => {
    if (!g.vsAi || g.phase === "ended" || isHumanTurn(g)) return g;
    try {
      const res = await fetch("/api/mrjack/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ game: g }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          game?: GameState;
          engine?: string;
          error?: string;
        };
        if (data.game?.phase) {
          setAiEngine(data.engine ?? (hasGemini ? "gemini+heuristic" : "heuristic"));
          setHasGemini((prev) =>
            data.engine?.includes("gemini") ? true : prev,
          );
          return data.game;
        }
        console.warn("MrJack AI response missing game", data);
      } else {
        console.warn("MrJack AI HTTP", res.status, await res.text().catch(() => ""));
      }
    } catch (e) {
      console.warn("MrJack AI fetch failed", e);
    }
    setAiEngine("heuristic");
    return runAiUntilHuman(g);
  }, [hasGemini]);

  // —— Online ——
  const [name, setName] = useState(
    () => localStorage.getItem("sfbg-name") || "",
  );
  const [roomInput, setRoomInput] = useState("");
  const [activeRoom, setActiveRoom] = useState("");
  const [onlineJoined, setOnlineJoined] = useState(false);
  const [onlineStatus, setOnlineStatus] = useState<"lobby" | "playing" | "ended">(
    "lobby",
  );
  const [onlinePlayers, setOnlinePlayers] = useState<MrJackLobbyPlayer[]>([]);
  const [hostId, setHostId] = useState<string | null>(null);
  const [youId, setYouId] = useState("");
  const [onlineGame, setOnlineGame] = useState<MrJackPublicState | null>(null);
  const [connected, setConnected] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preferRole, setPreferRole] = useState<Role>("detective");

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2800);
  }, []);

  const onOnlineMessage = useCallback(
    (event: MessageEvent) => {
      let msg: MrJackServerMessage;
      try {
        msg = JSON.parse(String(event.data)) as MrJackServerMessage;
      } catch {
        return;
      }
      switch (msg.type) {
        case "room":
          setOnlinePlayers(msg.players);
          setHostId(msg.hostId);
          setOnlineStatus(msg.status);
          if (msg.youId) {
            setYouId(msg.youId);
            setOnlineJoined(true);
          }
          if (msg.sessionToken && activeRoom) {
            saveSessionToken(`mj-${activeRoom}`, msg.sessionToken);
          }
          if (msg.status === "lobby") setOnlineGame(null);
          break;
        case "state":
          setOnlineStatus(msg.status);
          setOnlineGame(msg.game);
          break;
        case "error":
          setError(msg.message);
          showToast(msg.message);
          break;
        case "toast":
          showToast(msg.message);
          break;
      }
    },
    [activeRoom, showToast],
  );

  const socket = usePartySocket({
    party: "mr-jack-room",
    room: activeRoom || "lobby-placeholder",
    enabled: mode === "online" && !!activeRoom,
    onOpen() {
      setConnected(true);
    },
    onClose() {
      setConnected(false);
    },
    onError() {
      setConnected(false);
    },
    onMessage: onOnlineMessage,
  });

  const send = useCallback(
    (msg: MrJackClientMessage) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(msg));
      }
    },
    [socket],
  );

  // Auto-join when room socket opens
  useEffect(() => {
    if (mode !== "online" || !activeRoom || !connected || !name.trim()) return;
    if (onlineJoined) return;
    const sessionToken = loadSessionToken(`mj-${activeRoom}`);
    send({
      type: "join",
      name: name.trim(),
      sessionToken,
      preferRole,
    });
  }, [mode, activeRoom, connected, name, onlineJoined, preferRole, send]);

  // Re-join on reconnect
  useEffect(() => {
    if (mode !== "online" || !activeRoom || !connected || !onlineJoined) return;
    if (!name.trim()) return;
    const sessionToken = loadSessionToken(`mj-${activeRoom}`);
    if (sessionToken) {
      send({ type: "join", name: name.trim(), sessionToken, preferRole });
    }
  }, [connected]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyLocal = useCallback(
    (fn: (g: GameState) => GameState) => {
      setLocalG((prev) => {
        if (!prev) return prev;
        const next = fn(prev);
        // AI continues in effect after state updates (async Gemini)
        return next;
      });
    },
    [],
  );

  // When it's the AI's turn (or witness call in solo vs AI), advance via Worker/Gemini
  useEffect(() => {
    if (!localG || !localG.vsAi || localG.phase === "ended") return;

    // Witness call is mechanical — auto-resolve in solo so the game doesn't stall
    if (localG.phase === "call") {
      if (aiBusyRef.current) return;
      let cancelled = false;
      aiBusyRef.current = true;
      setAiBusy(true);
      const t = window.setTimeout(() => {
        if (cancelled) return;
        setLocalG((prev) =>
          prev && prev.phase === "call" ? resolveCall(prev) : prev,
        );
        aiBusyRef.current = false;
        setAiBusy(false);
      }, 500);
      return () => {
        cancelled = true;
        window.clearTimeout(t);
        aiBusyRef.current = false;
      };
    }

    if (isHumanTurn(localG)) return;
    if (aiBusyRef.current) return;

    let cancelled = false;
    let finished = false;
    aiBusyRef.current = true;
    setAiBusy(true);
    const snapshot = localG;
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const next = await runOpponentAsync(snapshot);
          if (cancelled) return;
          const newLogs = next.log.filter((line) => !snapshot.log.includes(line));
          if (newLogs.length > 0) {
            showToast(`⚡ ${newLogs[0]}`);
          }
          setLocalG(next);
        } catch (e) {
          console.warn("MrJack AI turn failed", e);
          if (!cancelled) {
            // Always make progress with local heuristic if the Worker fails
            setLocalG((prev) =>
              prev && !isHumanTurn(prev) ? runAiUntilHuman(prev) : prev,
            );
            setAiEngine("heuristic");
            showToast("AI fell back to local heuristics");
          }
        } finally {
          finished = true;
          aiBusyRef.current = false;
          if (!cancelled) setAiBusy(false);
        }
      })();
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
      // Only free the lock if this run never finished (superseded mid-flight)
      if (!finished) aiBusyRef.current = false;
    };
  }, [localG, runOpponentAsync, showToast]);

  async function startLocal() {
    let g = createGame(role, vsAi);
    setLocalG(g);
    setMode("local");
    setAiEngine(null);
    if (vsAi && !isHumanTurn(g)) {
      setAiBusy(true);
      try {
        g = await runOpponentAsync(g);
        setLocalG(g);
      } finally {
        setAiBusy(false);
      }
    }
  }

  function enterOnlineRoom(code?: string) {
    const room = (code || roomInput || randomCode())
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 5);
    if (room.length < 4) {
      setError("Room code needs 4–5 characters");
      return;
    }
    if (!name.trim()) {
      setError("Enter a name");
      return;
    }
    localStorage.setItem("sfbg-name", name.trim());
    setError(null);
    setOnlineJoined(false);
    setYouId("");
    setOnlineGame(null);
    setOnlineStatus("lobby");
    setRoomInput(room);
    setActiveRoom(room);
    setMode("online");
  }

  function leaveOnline() {
    send({ type: "leave" });
    if (activeRoom) clearSessionToken(`mj-${activeRoom}`);
    setActiveRoom("");
    setOnlineJoined(false);
    setOnlineGame(null);
    setYouId("");
    setMode("menu");
  }

  const isHost = youId !== "" && youId === hostId;
  const myLobby = onlinePlayers.find((p) => p.id === youId);

  // —— Menu ——
  if (mode === "menu") {
    return (
      <div className="mx-auto max-w-lg px-4 py-8">
        {toast ? (
          <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-slate-900/95 px-4 py-2 text-sm text-amber-100 shadow-xl ring-1 ring-white/10">
            {toast}
          </div>
        ) : null}
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
            Unofficial fan adaptation. Play online with a friend (room code), or solo vs AI.
            Not affiliated with Hurrican / the designers.
          </p>

          {/* Online */}
          <div className="mt-6 rounded-xl border border-sky-400/30 bg-sky-950/30 p-4">
            <h2 className="text-sm font-semibold text-sky-100">Play online</h2>
            <p className="mt-1 text-xs text-emerald-100/55">
              Like Take 5 — share a room code. 2 players: Detective vs Mr. Jack.
            </p>
            <label className="mt-3 mb-1 block text-sm text-emerald-100/80">Your name</label>
            <input
              className="mb-2 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 outline-none ring-amber-300/40 focus:ring-2"
              value={name}
              maxLength={20}
              placeholder="e.g. Alex"
              onChange={(e) => setName(e.target.value)}
            />
            <label className="mb-1 block text-sm text-emerald-100/80">Prefer role</label>
            <div className="mb-2 grid grid-cols-2 gap-2">
              {(
                [
                  ["detective", "Detective"],
                  ["jack", "Mr. Jack"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setPreferRole(id)}
                  className={`rounded-lg border px-2 py-2 text-sm ${
                    preferRole === id
                      ? "border-amber-300/70 bg-amber-400/15"
                      : "border-white/10 bg-black/20"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="mb-1 block text-sm text-emerald-100/80">Room code</label>
            <input
              className="mb-3 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 font-mono uppercase tracking-widest outline-none ring-amber-300/40 focus:ring-2"
              value={roomInput}
              maxLength={5}
              placeholder="ABC12"
              onChange={(e) =>
                setRoomInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))
              }
            />
            {error ? <p className="mb-2 text-sm text-red-300">{error}</p> : null}
            <div className="flex flex-col gap-2">
              <button
                type="button"
                className="rounded-xl bg-sky-400 px-4 py-3 font-semibold text-slate-900 hover:bg-sky-300"
                onClick={() => enterOnlineRoom(roomInput.trim() || undefined)}
              >
                {roomInput.trim() ? "Join room" : "Create room"}
              </button>
            </div>
          </div>

          {/* Local */}
          <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4">
            <h2 className="text-sm font-semibold text-emerald-100/90">Local / vs AI</h2>
            <label className="mt-3 mb-1 block text-sm text-emerald-100/80">You play as</label>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["detective", "Detective", "Eliminate suspects"],
                  ["jack", "Mr. Jack", "Stay hidden 8 rounds"],
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
            <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={vsAi}
                onChange={(e) => setVsAi(e.target.checked)}
                className="rounded"
              />
              Play vs AI (Gemini when available)
            </label>
            <p className="mt-1 text-[0.7rem] text-emerald-100/45">
              {hasGemini
                ? "Gemini is configured on the server — the AI will take real turns as your opponent."
                : "No GEMINI_API_KEY on the server — AI uses local heuristics (still plays)."}
            </p>
            <button
              type="button"
              onClick={() => void startLocal()}
              className="mt-4 w-full rounded-xl border border-amber-400/50 bg-amber-400/15 px-4 py-3 font-semibold text-amber-50 hover:bg-amber-400/25"
            >
              Start local game
            </button>
          </div>

          <div className="mt-8 rounded-2xl border border-white/10 bg-slate-900/60 p-4 backdrop-blur-md text-center">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-emerald-100/60 mb-3">
              Other Games
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <a
                href="/"
                className="flex items-center justify-center gap-1.5 rounded-xl border border-amber-400/50 bg-amber-500/15 px-3 py-2.5 text-xs font-semibold text-amber-100 hover:bg-amber-500/25"
              >
                Take 5! 🐂
              </a>
              <a
                href="/take-a-number"
                className="flex items-center justify-center gap-1.5 rounded-xl border border-sky-400/50 bg-sky-500/15 px-3 py-2.5 text-xs font-semibold text-sky-100 hover:bg-sky-500/25"
              >
                Take a Number 🔢
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // —— Local play ——
  if (mode === "local" && localG) {
    const human = isHumanTurn(localG);
    return (
      <div className="mx-auto max-w-6xl px-3 py-4 sm:px-4 sm:py-6">
        <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold sm:text-2xl">
              Mr. Jack <span className="text-violet-300">🕵️</span>
            </h1>
            <p className="text-xs text-emerald-100/70">
              Round {localG.round}/8 · You:{" "}
              {localG.humanRole === "detective" ? "Detective" : "Jack"}
              {localG.humanRole === "jack"
                ? ` (${CHARACTERS[localG.jackId].name})`
                : ""}{" "}
              ·{" "}
              {human
                ? "Your turn"
                : localG.vsAi
                  ? aiBusy
                    ? hasGemini
                      ? "Gemini is thinking…"
                      : "AI thinking…"
                    : "AI…"
                  : "…"}
              {aiEngine ? (
                <span className="text-emerald-100/45"> · {aiEngine}</span>
              ) : null}
            </p>
          </div>
          <div className="flex gap-2">
            <a
              href="/"
              className="rounded-full border border-white/15 px-3 py-1 text-xs hover:bg-white/5"
            >
              Take 5!
            </a>
            <button
              type="button"
              className="rounded-full border border-white/15 px-3 py-1 text-xs hover:bg-white/5"
              onClick={() => {
                setMode("menu");
                setLocalG(null);
                setAiBusy(false);
              }}
            >
              Menu
            </button>
          </div>
        </header>
        <BoardView
          G={{
            ...localG,
            ended: localG.phase === "ended",
            legalMoves:
              human && localG.phase === "move"
                ? localG.legalMoves.length
                  ? localG.legalMoves
                  : legalDestinations(localG, localG.selected!)
                : [],
          }}
          human={human}
          yourRole={localG.humanRole}
          jackId={
            localG.humanRole === "jack" || localG.phase === "ended"
              ? localG.jackId
              : null
          }
          onSelect={(id) => applyLocal((g) => selectCharacter(g, id))}
          onMove={(hex) => applyLocal((g) => moveCharacter(g, hex))}
          onPower={(t) => applyLocal((g) => usePower(g, t))}
          onSkipPower={() => applyLocal((g) => skipPower(g))}
          onResolveCall={() => applyLocal((g) => resolveCall(g))}
          onAccuse={(id) => applyLocal((g) => accuse(g, id))}
        />
      </div>
    );
  }

  // —— Online lobby / play ——
  return (
    <div className="mx-auto max-w-6xl px-3 py-4 sm:px-4 sm:py-6">
      {toast ? (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-slate-900/95 px-4 py-2 text-sm text-amber-100 shadow-xl ring-1 ring-white/10">
          {toast}
        </div>
      ) : null}

      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold sm:text-2xl">
            Mr. Jack <span className="text-violet-300">🕵️</span>
          </h1>
          <p className="text-xs text-emerald-100/70">
            Room{" "}
            <span className="font-mono font-semibold tracking-widest text-amber-300">
              {activeRoom}
            </span>
            {!connected ? " · reconnecting…" : ""}
            {onlineGame
              ? ` · Round ${onlineGame.round}/8 · You: ${roleLabel(onlineGame.yourRole)}`
              : ""}
            {onlineGame?.yourRole === "jack" && onlineGame.jackId
              ? ` (${CHARACTERS[onlineGame.jackId].name})`
              : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href="/"
            className="rounded-full border border-white/15 px-3 py-1 text-xs hover:bg-white/5"
          >
            6 Nimmt!
          </a>
          <button
            type="button"
            className="rounded-full border border-white/15 px-3 py-1 text-xs hover:bg-white/5"
            onClick={leaveOnline}
          >
            Leave
          </button>
        </div>
      </header>

      {error ? (
        <p className="mb-2 text-center text-sm text-red-300">{error}</p>
      ) : null}

      {/* Lobby */}
      {onlineStatus === "lobby" || !onlineGame ? (
        <div className="mx-auto max-w-md felt-panel p-5 sm:p-6">
          <h2 className="text-center text-lg font-semibold text-emerald-50">
            Online lobby
          </h2>
          <p className="mt-1 text-center font-mono text-2xl font-bold tracking-widest text-amber-300">
            {activeRoom}
          </p>
          <p className="mt-2 text-center text-xs text-emerald-100/55">
            Share this code with your friend · 2 players
          </p>

          <ul className="mt-4 space-y-2">
            {onlinePlayers.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between rounded-lg bg-black/25 px-3 py-2 text-sm"
              >
                <span>
                  {p.name}
                  {p.id === youId ? " (you)" : ""}
                  {p.isHost ? (
                    <span className="ml-2 text-xs text-emerald-300">host</span>
                  ) : null}
                  {!p.connected ? (
                    <span className="ml-2 text-xs text-amber-200/80">offline</span>
                  ) : null}
                </span>
                <span className="text-xs text-amber-100/80">{roleLabel(p.role)}</span>
              </li>
            ))}
            {onlinePlayers.length < 2 ? (
              <li className="rounded-lg border border-dashed border-white/15 px-3 py-2 text-center text-xs text-emerald-100/45">
                Waiting for opponent…
              </li>
            ) : null}
          </ul>

          {onlineJoined ? (
            <div className="mt-4">
              <p className="mb-1 text-xs text-emerald-100/60">Your role</p>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["detective", "Detective"],
                    ["jack", "Mr. Jack"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => send({ type: "setRole", role: id })}
                    className={`rounded-lg border px-2 py-2 text-sm ${
                      myLobby?.role === id
                        ? "border-amber-300/70 bg-amber-400/15"
                        : "border-white/10 bg-black/20"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="mt-4 text-center text-sm text-emerald-100/60">
              {connected ? "Joining…" : "Connecting…"}
            </p>
          )}

          {isHost ? (
            <button
              type="button"
              disabled={onlinePlayers.length < 2}
              onClick={() => send({ type: "start" })}
              className="mt-5 w-full rounded-xl bg-amber-400 px-4 py-3 font-semibold text-slate-900 hover:bg-amber-300 disabled:opacity-40"
            >
              Start investigation
            </button>
          ) : onlineJoined ? (
            <p className="mt-5 text-center text-sm text-emerald-100/60">
              Waiting for host to start…
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Online game */}
      {onlineGame && (onlineStatus === "playing" || onlineStatus === "ended") ? (
        <>
          <p className="mb-2 text-center text-sm text-emerald-100/75">
            {onlineGame.yourTurn
              ? "Your turn"
              : onlineGame.ended
                ? "Game over"
                : `${roleLabel(onlineGame.currentRole)}'s turn`}
          </p>
          <BoardView
            G={onlineGame}
            human={onlineGame.yourTurn && !onlineGame.ended}
            yourRole={onlineGame.yourRole}
            jackId={onlineGame.jackId}
            onSelect={(id) => send({ type: "selectChar", charId: id })}
            onMove={(hex) => send({ type: "move", hex })}
            onPower={(t) => send({ type: "power", target: t })}
            onSkipPower={() => send({ type: "skipPower" })}
            onResolveCall={() => send({ type: "resolveCall" })}
            onAccuse={(id) => send({ type: "accuse", charId: id })}
          />
          {onlineStatus === "ended" && isHost ? (
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => send({ type: "restart" })}
                className="rounded-xl bg-amber-400 px-5 py-2.5 font-semibold text-slate-900 hover:bg-amber-300"
              >
                Back to lobby
              </button>
            </div>
          ) : onlineStatus === "ended" ? (
            <p className="mt-3 text-center text-sm text-emerald-100/60">
              Waiting for host to open the lobby…
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
