import "./styles.css";
import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePartySocket } from "partysocket/react";
import type {
  AiStyle,
  ClientMessage,
  LobbyPlayer,
  ServerMessage,
  SpectatorInfo,
} from "./game/protocol";
import {
  fetchRoomsPresence,
  forgetRoom,
  loadRecentRooms,
  rememberRoom,
  type RecentRoom,
  type RoomPresenceInfo,
} from "./game/recentRooms";
import type { PublicGameState } from "./game/types";
import { Lobby } from "./components/Lobby";
import { GameBoard } from "./components/GameBoard";
import { MrJackApp } from "./mrjack/MrJackApp";

function randomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

function readQueryRoom(): string {
  const q = new URLSearchParams(window.location.search).get("room");
  return (q || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
}

function formatRelative(ts: number): string {
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

function App() {
  const [screen, setScreen] = useState<"home" | "room">("home");
  const [name, setName] = useState(() => localStorage.getItem("sfbg-name") || "");
  const [roomInput, setRoomInput] = useState(() => readQueryRoom());
  const [activeRoom, setActiveRoom] = useState("");
  const [joined, setJoined] = useState(false);

  const [status, setStatus] = useState<"lobby" | "playing" | "ended">("lobby");
  const [players, setPlayers] = useState<LobbyPlayer[]>([]);
  const [spectators, setSpectators] = useState<SpectatorInfo[]>([]);
  const [youRole, setYouRole] = useState<"player" | "spectator">("player");
  const [hostId, setHostId] = useState<string | null>(null);
  const [youId, setYouId] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(10);
  const [hasAiKey, setHasAiKey] = useState(false);
  const [aiStyle, setAiStyle] = useState<AiStyle>("solid");
  const [tightDeck, setTightDeck] = useState(true);
  const [game, setGame] = useState<PublicGameState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [pendingSoloBots, setPendingSoloBots] = useState(0);
  const [recentRooms, setRecentRooms] = useState<RecentRoom[]>(() => loadRecentRooms());
  const [presence, setPresence] = useState<Record<string, RoomPresenceInfo>>({});
  const [presenceLoading, setPresenceLoading] = useState(false);
  /** Allow one history back when leaving via Leave button */
  const allowHistoryBack = useRef(false);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2800);
  }, []);

  const onMessage = useCallback(
    (event: MessageEvent) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }

      switch (msg.type) {
        case "room":
          setPlayers(msg.players);
          setSpectators(msg.spectators ?? []);
          setHostId(msg.hostId);
          setMaxPlayers(msg.maxPlayers);
          setHasAiKey(msg.hasAiKey);
          setAiStyle(msg.aiStyle);
          if (typeof msg.tightDeck === "boolean") setTightDeck(msg.tightDeck);
          // youId empty = connect preview only — don't flip into "playing" UI yet
          if (msg.youId) {
            setYouId(msg.youId);
            setYouRole(msg.youRole ?? "player");
            setJoined(true);
            setStatus(msg.status);
            if (msg.status === "lobby") {
              setGame(null);
            }
          }
          break;
        case "state":
          setGame(msg.game);
          setStatus(msg.status);
          setSpectators(msg.spectators ?? []);
          if (msg.youAreSpectator) setYouRole("spectator");
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
    [showToast],
  );

  const socket = usePartySocket({
    party: "game-room",
    room: activeRoom || "lobby-placeholder",
    enabled: screen === "room" && !!activeRoom,
    onOpen() {
      setConnected(true);
    },
    onClose() {
      setConnected(false);
    },
    onMessage,
  });

  const send = useCallback(
    (msg: ClientMessage) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(msg));
      }
    },
    [socket],
  );

  // Join once connected to room
  useEffect(() => {
    if (screen !== "room" || !activeRoom || !connected || joined) return;
    if (!name.trim()) return;
    send({ type: "join", name: name.trim() });
  }, [screen, activeRoom, connected, joined, name, send]);

  // Solo mode: after join as host, auto-add bots
  useEffect(() => {
    if (!joined || !youId || !hostId || youId !== hostId) return;
    if (pendingSoloBots <= 0) return;
    if (status !== "lobby") return;
    send({ type: "addBots", count: pendingSoloBots });
    setPendingSoloBots(0);
  }, [joined, youId, hostId, pendingSoloBots, status, send]);

  // Remember room once successfully joined
  useEffect(() => {
    if (joined && activeRoom) {
      setRecentRooms(rememberRoom(activeRoom));
    }
  }, [joined, activeRoom]);

  // Poll human presence for recent rooms while on home
  useEffect(() => {
    if (screen !== "home" || recentRooms.length === 0) {
      setPresence({});
      return;
    }

    let cancelled = false;
    let first = true;
    async function refresh() {
      if (first) setPresenceLoading(true);
      const map = await fetchRoomsPresence(recentRooms.map((r) => r.code));
      if (!cancelled) {
        setPresence(map);
        if (first) {
          setPresenceLoading(false);
          first = false;
        }
      }
    }

    void refresh();
    const id = window.setInterval(() => void refresh(), 12_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [screen, recentRooms]);

  // Block browser / swipe-back while in a room (esp. when scrolling the hand)
  useEffect(() => {
    if (screen !== "room" || !activeRoom) return;

    const guard = { sfbgGuard: true as const, room: activeRoom };
    // Extra history entry so the first Back is trapped in-room
    window.history.pushState(guard, "", window.location.href);

    const onPopState = () => {
      if (allowHistoryBack.current) {
        allowHistoryBack.current = false;
        return;
      }
      // Stay in the room
      window.history.pushState(guard, "", window.location.href);
      showToast("Use Leave to exit — back is blocked while in a room");
    };

    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
    };
  }, [screen, activeRoom, showToast]);

  function enterRoom(code: string, soloBots = 0) {
    const room = code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
    if (room.length < 4) {
      setError("Room code should be 4–5 characters");
      return;
    }
    if (!name.trim()) {
      setError("Enter a display name");
      return;
    }
    localStorage.setItem("sfbg-name", name.trim());
    setError(null);
    setJoined(false);
    setGame(null);
    setStatus("lobby");
    setPlayers([]);
    setSpectators([]);
    setYouRole("player");
    setYouId("");
    setPendingSoloBots(soloBots);
    setActiveRoom(room);
    setScreen("room");
    setRecentRooms(rememberRoom(room));
    const url = new URL(window.location.href);
    url.searchParams.set("room", room);
    window.history.replaceState({ sfbgRoom: room }, "", url.toString());
  }

  function leaveRoom() {
    allowHistoryBack.current = true;
    send({ type: "leave" });
    setScreen("home");
    setActiveRoom("");
    setJoined(false);
    setGame(null);
    setPlayers([]);
    setSpectators([]);
    setYouRole("player");
    setYouId("");
    setRecentRooms(loadRecentRooms());
    const url = new URL(window.location.href);
    url.searchParams.delete("room");
    // Drop the guard entry if present, then show home
    window.history.replaceState({}, "", url.toString());
  }

  const isHost = youId !== "" && youId === hostId && youRole === "player";
  const isSpectator = youRole === "spectator";

  const subtitle = useMemo(() => {
    if (screen === "home") return "Real-time multiplayer on Cloudflare";
    if (!connected) return "Connecting…";
    if (status === "lobby") return `Room ${activeRoom}`;
    if (isSpectator) return `Watching · ${activeRoom}`;
    return `Playing · ${activeRoom}`;
  }, [screen, connected, status, activeRoom, isSpectator]);

  const isPlaying =
    screen === "room" && joined && (status === "playing" || status === "ended");

  return (
    <div
      className={`app-shell mx-auto flex min-h-dvh max-w-7xl flex-col px-4 ${
        isPlaying
          ? "app-shell--playing py-2 sm:py-4"
          : "py-6 sm:py-10"
      }`}
    >
      <header className={`${isPlaying ? "header--compact" : "mb-8 text-center"}`}>
        {isPlaying ? (
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1 text-left sm:text-center sm:flex-none">
              <h1 className="truncate font-bold tracking-tight">
                6 Nimmt! <span className="text-amber-300">🐂</span>
              </h1>
              <p className="mt-0.5 truncate text-xs text-emerald-100/70">{subtitle}</p>
            </div>
            {/* Hits / Rules portaled here from GameBoard */}
            <div
              id="game-header-actions"
              className="flex shrink-0 items-center gap-1.5"
            />
          </div>
        ) : (
          <>
            <p className="brand-line text-xs font-semibold uppercase tracking-[0.35em] text-amber-300/90">
              SFboardgames
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
              6 Nimmt! <span className="text-amber-300">🐂</span>
            </h1>
            <p className="mt-2 text-sm text-emerald-100/70">{subtitle}</p>
          </>
        )}
      </header>

      {toast ? (
        <div className="toast fixed bottom-[calc(11rem+env(safe-area-inset-bottom,0px))] left-1/2 z-50 max-w-[90vw] -translate-x-1/2 rounded-full bg-slate-900/95 px-4 py-2 text-center text-sm text-amber-100 shadow-xl ring-1 ring-white/10 lg:bottom-6">
          {toast}
        </div>
      ) : null}

      {screen === "home" ? (
        <div className="mx-auto w-full max-w-md felt-panel p-6 sm:p-8">
          <label className="mb-1 block text-sm text-emerald-100/80">Your name</label>
          <input
            className="mb-4 w-full rounded-xl border border-white/15 bg-black/30 px-4 py-3 outline-none ring-amber-300/40 focus:ring-2"
            value={name}
            maxLength={20}
            placeholder="e.g. Alex"
            onChange={(e) => setName(e.target.value)}
          />

          <label className="mb-1 block text-sm text-emerald-100/80">Room code</label>
          <input
            className="mb-2 w-full rounded-xl border border-white/15 bg-black/30 px-4 py-3 font-mono uppercase tracking-widest outline-none ring-amber-300/40 focus:ring-2"
            value={roomInput}
            maxLength={5}
            placeholder="ABC12"
            onChange={(e) => setRoomInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === "Enter") enterRoom(roomInput);
            }}
          />

          {error ? <p className="mb-3 text-sm text-red-300">{error}</p> : null}

          <div className="mt-4 flex flex-col gap-2">
            <button
              type="button"
              className="rounded-xl bg-amber-400 px-4 py-3 font-semibold text-slate-900 hover:bg-amber-300"
              onClick={() => {
                const code = roomInput.trim() ? roomInput : randomCode();
                setRoomInput(code);
                enterRoom(code);
              }}
            >
              {roomInput.trim() ? "Join room" : "Create room"}
            </button>
            <button
              type="button"
              className="rounded-xl border border-sky-400/50 bg-sky-500/15 px-4 py-3 font-medium text-sky-50 hover:bg-sky-500/25"
              onClick={() => {
                const code = randomCode();
                setRoomInput(code);
                enterRoom(code, 3);
              }}
            >
              Play solo vs AI (3 bots)
            </button>
            <button
              type="button"
              className="rounded-xl border border-white/20 px-4 py-3 text-emerald-100 hover:bg-white/5"
              onClick={() => {
                const code = randomCode();
                setRoomInput(code);
                enterRoom(code);
              }}
            >
              New random room
            </button>
          </div>

          {recentRooms.length > 0 ? (
            <div className="mt-6 border-t border-white/10 pt-5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-emerald-100/80">
                  Previous rooms
                </h2>
                {presenceLoading ? (
                  <span className="text-[0.65rem] text-emerald-100/40">Updating…</span>
                ) : (
                  <span className="text-[0.65rem] text-emerald-100/40">Humans only · live</span>
                )}
              </div>
              <ul className="space-y-2">
                {recentRooms.map((r) => {
                  const info = presence[r.code];
                  const humans = info?.humans ?? [];
                  const humanCount = info?.humanCount ?? 0;
                  const roomStatus = info?.status;
                  return (
                    <li
                      key={r.code}
                      className="flex items-stretch gap-2 rounded-xl border border-white/10 bg-black/20 p-2"
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 rounded-lg px-2 py-1.5 text-left hover:bg-white/5"
                        onClick={() => {
                          setRoomInput(r.code);
                          enterRoom(r.code);
                        }}
                      >
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="font-mono text-lg font-bold tracking-widest text-amber-300">
                            {r.code}
                          </span>
                          <span className="text-[0.65rem] text-emerald-100/45">
                            {formatRelative(r.lastJoinedAt)}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs leading-snug text-emerald-100/75">
                          {info === undefined && presenceLoading ? (
                            <span className="text-emerald-100/40">Checking who’s there…</span>
                          ) : humanCount > 0 ? (
                            <>
                              <span className="font-medium text-emerald-300">
                                {humanCount} human{humanCount === 1 ? "" : "s"} online
                              </span>
                              {" · "}
                              {humans
                                .map((h) =>
                                  h.watching ? `${h.name} (watching)` : h.name,
                                )
                                .join(", ")}
                              {roomStatus && roomStatus !== "lobby" ? (
                                <span className="text-amber-200/90">
                                  {" "}
                                  · {roomStatus === "playing" ? "in game" : "game ended"}
                                  {" · join to watch"}
                                </span>
                              ) : null}
                            </>
                          ) : (
                            <>
                              <span className="text-emerald-100/45">No one there</span>
                              {roomStatus === "playing" ? (
                                <span className="text-amber-200/80"> · game running (AI only?)</span>
                              ) : roomStatus === "ended" ? (
                                <span className="text-emerald-100/40"> · last game ended</span>
                              ) : null}
                            </>
                          )}
                        </p>
                      </button>
                      <button
                        type="button"
                        title="Remove from list"
                        className="shrink-0 self-center rounded-lg px-2 py-2 text-sm text-emerald-100/40 hover:bg-white/5 hover:text-emerald-100/80"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRecentRooms(forgetRoom(r.code));
                        }}
                      >
                        ✕
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          <p className="mt-6 text-center text-xs leading-relaxed text-emerald-100/50">
            Multiplayer: share the room code. Solo: play against Gemini bots (or heuristics
            without a key). Engine adapted from{" "}
            <a
              className="underline decoration-emerald-700 underline-offset-2 hover:text-emerald-100"
              href="https://github.com/boardgamers/take6-engine"
              target="_blank"
              rel="noreferrer"
            >
              take6-engine
            </a>
            .
          </p>
        </div>
      ) : null}

      {/* Single Mr. Jack entry — bottom of home only */}
      {screen === "home" ? (
        <div className="mx-auto mt-8 w-full max-w-md px-0">
          <a
            href="/mrjack"
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-violet-400/50 bg-violet-500/15 px-5 py-3.5 text-sm font-semibold text-violet-50 hover:bg-violet-500/25"
          >
            Play Mr. Jack <span aria-hidden>🕵️</span>
          </a>
        </div>
      ) : null}

      {screen === "room" && !joined ? (
        <div className="mx-auto w-full max-w-md felt-panel p-6 text-center">
          <p className="text-emerald-100/80">
            {error
              ? "Couldn’t join"
              : connected
                ? "Joining room…"
                : "Connecting…"}
          </p>
          <p className="mt-1 font-mono text-sm tracking-widest text-amber-300/90">{activeRoom}</p>
          {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}

          {error ? (
            <div className="mt-4 text-left">
              <label className="mb-1 block text-sm text-emerald-100/80">Your name</label>
              <input
                className="mb-3 w-full rounded-xl border border-white/15 bg-black/30 px-4 py-3 outline-none ring-amber-300/40 focus:ring-2"
                value={name}
                maxLength={20}
                onChange={(e) => setName(e.target.value)}
              />
              <button
                type="button"
                className="w-full rounded-xl bg-amber-400 px-4 py-3 font-semibold text-slate-900 hover:bg-amber-300 disabled:opacity-50"
                disabled={!name.trim() || !connected}
                onClick={() => {
                  setError(null);
                  localStorage.setItem("sfbg-name", name.trim());
                  send({ type: "join", name: name.trim() });
                }}
              >
                Try again
              </button>
            </div>
          ) : null}

          <button
            type="button"
            onClick={leaveRoom}
            className="mt-4 rounded-xl border border-white/20 px-4 py-2 text-sm text-emerald-100 hover:bg-white/5"
          >
            Back to home
          </button>
        </div>
      ) : null}

      {screen === "room" && joined && status === "lobby" ? (
        <div className="flex flex-1 justify-center">
          <Lobby
            roomId={activeRoom}
            players={players}
            spectators={spectators}
            hostId={hostId}
            youId={youId}
            maxPlayers={maxPlayers}
            hasAiKey={hasAiKey}
            aiStyle={aiStyle}
            onStart={() => send({ type: "start", tightDeck })}
            onAddBots={(count) => send({ type: "addBots", count })}
            onRemoveBot={() => send({ type: "removeBot" })}
            onSetAiStyle={(style) => send({ type: "setAiStyle", style })}
            onSetBotAiStyle={(botId, style) => send({ type: "setBotAiStyle", botId, style })}
            tightDeck={tightDeck}
            onSetTightDeck={(tight) => {
              setTightDeck(tight);
              send({ type: "setTightDeck", tightDeck: tight });
            }}
            onLeave={leaveRoom}
          />
        </div>
      ) : null}

      {screen === "room" && joined && (status === "playing" || status === "ended") && game ? (
        <GameBoard
          game={game}
          isHost={isHost}
          isSpectator={isSpectator}
          spectators={spectators}
          onChoose={(cardNumber) => send({ type: "chooseCard", cardNumber })}
          onPlace={(row, replace) => send({ type: "placeCard", row, replace })}
          onSwapCard={(cardNumber) => send({ type: "swapCard", cardNumber })}
          onRestart={() => send({ type: "restart" })}
        />
      ) : null}

      {screen === "room" && joined && (status === "playing" || status === "ended") && !game ? (
        <div className="mx-auto w-full max-w-md felt-panel p-6 text-center">
          <p className="text-emerald-100/70">Loading game…</p>
          <button
            type="button"
            onClick={leaveRoom}
            className="mt-4 rounded-xl border border-white/20 px-4 py-2 text-sm text-emerald-100 hover:bg-white/5"
          >
            Back to home
          </button>
        </div>
      ) : null}

      <footer
        className={`mt-auto text-center ${
          isPlaying ? "hidden pb-2 pt-4 sm:block sm:pt-6" : "pt-6 pb-6"
        }`}
      >
        <p className="text-xs text-emerald-100/40">
          SFboardgames · fan project · not affiliated with publishers
        </p>
      </footer>
    </div>
  );
}

function Root() {
  // Support /mrjack, /mrjack/, and ?game=mrjack (cache-bust friendly)
  const path = (window.location.pathname.replace(/\/+$/, "") || "/").toLowerCase();
  const q = new URLSearchParams(window.location.search).get("game");
  const isMrJack =
    path === "/mrjack" ||
    path.endsWith("/mrjack") ||
    q === "mrjack";

  useEffect(() => {
    document.title = isMrJack
      ? "SFboardgames · Mr. Jack"
      : "SFboardgames · 6 Nimmt!";
  }, [isMrJack]);

  if (isMrJack) {
    return <MrJackApp />;
  }
  return <App />;
}

createRoot(document.getElementById("root")!).render(<Root />);
