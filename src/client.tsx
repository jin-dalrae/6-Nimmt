import "./styles.css";
import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePartySocket } from "partysocket/react";
import type { AiStyle, ClientMessage, LobbyPlayer, ServerMessage } from "./game/protocol";
import type { PublicGameState } from "./game/types";
import { Lobby } from "./components/Lobby";
import { GameBoard } from "./components/GameBoard";

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

function App() {
  const [screen, setScreen] = useState<"home" | "room">("home");
  const [name, setName] = useState(() => localStorage.getItem("sfbg-name") || "");
  const [roomInput, setRoomInput] = useState(() => readQueryRoom());
  const [activeRoom, setActiveRoom] = useState("");
  const [joined, setJoined] = useState(false);

  const [status, setStatus] = useState<"lobby" | "playing" | "ended">("lobby");
  const [players, setPlayers] = useState<LobbyPlayer[]>([]);
  const [hostId, setHostId] = useState<string | null>(null);
  const [youId, setYouId] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(10);
  const [hasAiKey, setHasAiKey] = useState(false);
  const [aiStyle, setAiStyle] = useState<AiStyle>("solid");
  const [game, setGame] = useState<PublicGameState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [pendingSoloBots, setPendingSoloBots] = useState(0);

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
          setStatus(msg.status);
          setPlayers(msg.players);
          setHostId(msg.hostId);
          setMaxPlayers(msg.maxPlayers);
          setHasAiKey(msg.hasAiKey);
          setAiStyle(msg.aiStyle);
          if (msg.youId) {
            setYouId(msg.youId);
            setJoined(true);
          }
          if (msg.status === "lobby") {
            setGame(null);
          }
          break;
        case "state":
          setGame(msg.game);
          setStatus(msg.status);
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
    setYouId("");
    setPendingSoloBots(soloBots);
    setActiveRoom(room);
    setScreen("room");
    const url = new URL(window.location.href);
    url.searchParams.set("room", room);
    window.history.replaceState({}, "", url.toString());
  }

  function leaveRoom() {
    send({ type: "leave" });
    setScreen("home");
    setActiveRoom("");
    setJoined(false);
    setGame(null);
    setPlayers([]);
    setYouId("");
    const url = new URL(window.location.href);
    url.searchParams.delete("room");
    window.history.replaceState({}, "", url.toString());
  }

  const isHost = youId !== "" && youId === hostId;

  const subtitle = useMemo(() => {
    if (screen === "home") return "Real-time multiplayer on Cloudflare";
    if (!connected) return "Connecting…";
    if (status === "lobby") return `Room ${activeRoom}`;
    return `Playing · ${activeRoom}`;
  }, [screen, connected, status, activeRoom]);

  const isPlaying = screen === "room" && (status === "playing" || status === "ended");

  return (
    <div
      className={`mx-auto flex min-h-screen max-w-7xl flex-col px-4 ${
        isPlaying
          ? "app-shell--playing py-2 sm:py-4"
          : "py-6 sm:py-10"
      }`}
    >
      <header className={`text-center ${isPlaying ? "header--compact" : "mb-8"}`}>
        <p className="brand-line text-xs font-semibold uppercase tracking-[0.35em] text-amber-300/90">
          SFboardgames
        </p>
        <h1
          className={`font-bold tracking-tight ${
            isPlaying ? "" : "mt-2 text-3xl sm:text-4xl"
          }`}
        >
          6 Nimmt! <span className="text-amber-300">🐂</span>
        </h1>
        <p className={`text-emerald-100/70 ${isPlaying ? "mt-0.5 text-xs" : "mt-2 text-sm"}`}>
          {subtitle}
        </p>
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

      {screen === "room" && status === "lobby" ? (
        <div className="flex flex-1 justify-center">
          <Lobby
            roomId={activeRoom}
            players={players}
            hostId={hostId}
            youId={youId}
            maxPlayers={maxPlayers}
            hasAiKey={hasAiKey}
            aiStyle={aiStyle}
            onStart={() => send({ type: "start" })}
            onAddBots={(count) => send({ type: "addBots", count })}
            onRemoveBot={() => send({ type: "removeBot" })}
            onSetAiStyle={(style) => send({ type: "setAiStyle", style })}
            onLeave={leaveRoom}
          />
        </div>
      ) : null}

      {screen === "room" && (status === "playing" || status === "ended") && game ? (
        <GameBoard
          game={game}
          isHost={isHost}
          onChoose={(cardNumber) => send({ type: "chooseCard", cardNumber })}
          onPlace={(row, replace) => send({ type: "placeCard", row, replace })}
          onRestart={() => send({ type: "restart" })}
        />
      ) : null}

      {screen === "room" && (status === "playing" || status === "ended") && !game ? (
        <p className="text-center text-emerald-100/70">Loading game…</p>
      ) : null}

      <footer
        className={`mt-auto text-center text-xs text-emerald-100/40 ${
          isPlaying ? "hidden pb-2 pt-4 sm:block sm:pt-6" : "pt-10"
        }`}
      >
        SFboardgames · 6 Nimmt! fan project · not affiliated with Amigo Spiele
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
