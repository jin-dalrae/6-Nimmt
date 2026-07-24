import { useCallback, useEffect, useMemo, useState } from "react";
import { usePartySocket } from "partysocket/react";
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
    litGas: HexKey[];
    gasSockets: HexKey[];
    manholes: HexKey[];
    exits: HexKey[];
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
              const legal =
                G.legalMoves.includes(k) && human && G.phase === "move";
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
                  onClick={legal ? () => onMove(k as HexKey) : undefined}
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
                      : human
                        ? "Your turn"
                        : "Waiting for opponent…"}
            </p>

            {G.phase === "selectChar" && human ? (
              <div className="mt-2 grid grid-cols-2 gap-1.5">
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
                  (G.powerTargets as string[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      className="rounded-lg border border-white/15 px-2 py-1.5 text-left text-xs hover:bg-white/5"
                      onClick={() => onPower(t)}
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

  const applyLocal = useCallback((fn: (g: GameState) => GameState) => {
    setLocalG((prev) => {
      if (!prev) return prev;
      let next = fn(prev);
      if (next.vsAi) next = runAiUntilHuman(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!localG || !localG.vsAi || localG.phase === "ended") return;
    if (isHumanTurn(localG)) return;
    const t = window.setTimeout(() => {
      setLocalG((prev) => (prev ? runAiUntilHuman(prev) : prev));
    }, 450);
    return () => clearTimeout(t);
  }, [localG]);

  function startLocal() {
    let g = createGame(role, vsAi);
    if (vsAi) g = runAiUntilHuman(g);
    setLocalG(g);
    setMode("local");
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
              Like 6 Nimmt — share a room code. 2 players: Detective vs Mr. Jack.
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
              Play vs AI (on this device)
            </label>
            <button
              type="button"
              onClick={startLocal}
              className="mt-4 w-full rounded-xl border border-amber-400/50 bg-amber-400/15 px-4 py-3 font-semibold text-amber-50 hover:bg-amber-400/25"
            >
              Start local game
            </button>
          </div>

          <a
            href="/"
            className="mt-4 block text-center text-sm text-emerald-100/60 hover:text-emerald-100"
          >
            ← Back to 6 Nimmt!
          </a>
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
              · {human ? "Your turn" : localG.vsAi ? "AI thinking…" : "…"}
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
              onClick={() => {
                setMode("menu");
                setLocalG(null);
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
