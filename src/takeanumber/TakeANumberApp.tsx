import { useCallback, useEffect, useState } from "react";
import { usePartySocket } from "partysocket/react";
import { CardView } from "../components/CardView";
import {
  clearSessionToken,
  loadSessionToken,
  saveSessionToken,
} from "../game/sessionToken";
import { BOT_NAMES, runBotActionIfNeeded } from "./ai";
import {
  chooseCard,
  chooseRowToTake,
  pickPersonalCard,
  setupGame,
  startNextRound,
} from "./engine";
import type {
  PublicGameState,
  PublicPlayer,
  TanClientMessage,
  TanLobbyPlayer,
  TanServerMessage,
} from "./protocol";
import { roomCode } from "./protocol";
import type { Card, CenterRow, GameState } from "./types";
import { Phase } from "./types";

type Mode = "menu" | "solo" | "online";

function tanSessionKey(room: string) {
  return `tan-${room.toUpperCase()}`;
}

function randomCode() {
  return roomCode();
}

export function TakeANumberApp() {
  const [mode, setMode] = useState<Mode>("menu");
  const [name, setName] = useState(
    () => localStorage.getItem("sfbg-name") || "Player 1",
  );
  const [botCount, setBotCount] = useState(3);
  const [showRules, setShowRules] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Solo
  const [soloG, setSoloG] = useState<GameState | null>(null);
  const [humanPlayerId] = useState("human-1");

  // Online
  const [activeRoom, setActiveRoom] = useState<string | null>(() => {
    try {
      const q = new URLSearchParams(window.location.search).get("room");
      if (q && q.length >= 4) return q.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
    } catch {
      /* ignore */
    }
    return null;
  });
  const [joinCode, setJoinCode] = useState("");
  const [connected, setConnected] = useState(false);
  const [onlineJoined, setOnlineJoined] = useState(false);
  const [youId, setYouId] = useState("");
  const [hostId, setHostId] = useState<string | null>(null);
  const [lobbyPlayers, setLobbyPlayers] = useState<TanLobbyPlayer[]>([]);
  const [onlineStatus, setOnlineStatus] = useState<"lobby" | "playing" | "ended">(
    "lobby",
  );
  const [onlineGame, setOnlineGame] = useState<PublicGameState | null>(null);
  const [pendingSoloBots, setPendingSoloBots] = useState(0);

  useEffect(() => {
    if (name) localStorage.setItem("sfbg-name", name);
  }, [name]);

  // Open ?room= on load as multiplayer
  useEffect(() => {
    if (activeRoom && mode === "menu") {
      setMode("online");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  const onOnlineMessage = useCallback(
    (event: MessageEvent) => {
      let msg: TanServerMessage;
      try {
        msg = JSON.parse(String(event.data)) as TanServerMessage;
      } catch {
        return;
      }
      switch (msg.type) {
        case "room":
          setOnlineStatus(msg.status);
          setLobbyPlayers(msg.players);
          setHostId(msg.hostId);
          if (msg.youId) {
            setYouId(msg.youId);
            setOnlineJoined(true);
          }
          if (msg.sessionToken && activeRoom) {
            saveSessionToken(tanSessionKey(activeRoom), msg.sessionToken);
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
    party: "take-a-number-room",
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
    (msg: TanClientMessage) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(msg));
      }
    },
    [socket],
  );

  const sendJoin = useCallback(() => {
    if (!activeRoom || !name.trim()) return;
    const sessionToken = loadSessionToken(tanSessionKey(activeRoom));
    send({
      type: "join",
      name: name.trim(),
      ...(sessionToken ? { sessionToken } : {}),
    });
  }, [activeRoom, name, send]);

  useEffect(() => {
    if (mode !== "online" || !activeRoom || !connected || !name.trim()) return;
    sendJoin();
  }, [mode, activeRoom, connected, name, sendJoin]);

  useEffect(() => {
    if (mode !== "online" || !activeRoom || !name.trim()) return;
    const rejoin = () => {
      if (document.visibilityState !== "visible") return;
      if (socket.readyState === WebSocket.OPEN) sendJoin();
    };
    document.addEventListener("visibilitychange", rejoin);
    window.addEventListener("online", rejoin);
    return () => {
      document.removeEventListener("visibilitychange", rejoin);
      window.removeEventListener("online", rejoin);
    };
  }, [mode, activeRoom, name, sendJoin, socket]);

  // After create-with-bots: host fills remaining seats with AI
  useEffect(() => {
    if (!onlineJoined || !youId || youId !== hostId) return;
    if (pendingSoloBots <= 0) return;
    if (onlineStatus !== "lobby") return;
    send({ type: "addBots", count: pendingSoloBots });
    setPendingSoloBots(0);
  }, [onlineJoined, youId, hostId, pendingSoloBots, onlineStatus, send]);

  // Sync URL room param
  useEffect(() => {
    if (mode !== "online" || !activeRoom) return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("room", activeRoom);
      window.history.replaceState({}, "", url.toString());
    } catch {
      /* ignore */
    }
  }, [mode, activeRoom]);

  const enterOnlineRoom = (code: string, bots = 0) => {
    const room = code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
    if (room.length < 4) {
      setError("Room code must be at least 4 characters");
      return;
    }
    setError(null);
    setOnlineJoined(false);
    setYouId("");
    setOnlineGame(null);
    setOnlineStatus("lobby");
    setLobbyPlayers([]);
    setPendingSoloBots(bots);
    setActiveRoom(room);
    setMode("online");
  };

  const leaveOnline = () => {
    send({ type: "leave" });
    if (activeRoom) clearSessionToken(tanSessionKey(activeRoom));
    setActiveRoom(null);
    setOnlineJoined(false);
    setOnlineGame(null);
    setMode("menu");
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("room");
      window.history.replaceState({}, "", url.toString());
    } catch {
      /* ignore */
    }
  };

  const handleStartSolo = () => {
    const players: { id: string; name: string; isBot?: boolean }[] = [
      { id: humanPlayerId, name: name || "Player 1" },
    ];
    for (let i = 0; i < botCount; i++) {
      players.push({
        id: `bot-${i + 1}`,
        name: BOT_NAMES[i % BOT_NAMES.length] || `Bot ${i + 1}`,
        isBot: true,
      });
    }
    setSoloG(setupGame(players));
    setMode("solo");
  };

  const handleChooseCardSolo = useCallback((pIdx: number, cardNum: number) => {
    setSoloG((prev) => (prev ? chooseCard(prev, pIdx, cardNum) : prev));
  }, []);

  const handleChooseRowSolo = useCallback((pIdx: number, rowIdx: number) => {
    setSoloG((prev) => (prev ? chooseRowToTake(prev, pIdx, rowIdx) : prev));
  }, []);

  const handlePickPersonalSolo = useCallback((pIdx: number, cardNum: number) => {
    setSoloG((prev) => (prev ? pickPersonalCard(prev, pIdx, cardNum) : prev));
  }, []);

  // Solo bot loop
  useEffect(() => {
    if (mode !== "solo" || !soloG) return;
    if (soloG.phase === Phase.Ended || soloG.phase === Phase.BetweenRounds) return;

    const timer = setTimeout(() => {
      let current = soloG;
      const acted = runBotActionIfNeeded(current, {
        chooseCard: (pIdx, cardNum) => {
          current = chooseCard(current, pIdx, cardNum);
        },
        chooseRow: (pIdx, rowIdx) => {
          current = chooseRowToTake(current, pIdx, rowIdx);
        },
        pickPersonal: (pIdx, cardNum) => {
          current = pickPersonalCard(current, pIdx, cardNum);
        },
      });
      if (acted) setSoloG({ ...current });
    }, 600);
    return () => clearTimeout(timer);
  }, [mode, soloG]);

  // ─── MENU ───────────────────────────────────────────────
  if (mode === "menu") {
    return (
      <div className="mx-auto max-w-xl px-4 py-8">
        <Header />
        <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-6 shadow-xl backdrop-blur-md">
          <div className="mb-4">
            <label className="mb-1 block text-sm font-medium text-emerald-100/80">
              Your Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={20}
              className="w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-white outline-none focus:ring-2 focus:ring-amber-300"
            />
          </div>

          <h2 className="text-lg font-bold text-amber-200">Multiplayer</h2>
          <p className="mt-1 text-xs text-emerald-100/60">
            Create a room and share the code — up to 4 players, with optional AI bots.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => enterOnlineRoom(randomCode())}
              className="flex-1 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 px-4 py-3 font-bold text-slate-950 shadow-lg hover:brightness-110"
            >
              Create Room
            </button>
            <button
              type="button"
              onClick={() => enterOnlineRoom(randomCode(), 3)}
              className="flex-1 rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm font-semibold text-amber-100 hover:bg-amber-400/20"
            >
              Solo room + 3 bots
            </button>
          </div>

          <div className="mt-3 flex gap-2">
            <input
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="ROOM CODE"
              maxLength={5}
              className="min-w-0 flex-1 rounded-xl border border-white/15 bg-black/40 px-3 py-2 font-mono uppercase tracking-widest text-white outline-none focus:ring-2 focus:ring-amber-300"
            />
            <button
              type="button"
              onClick={() => enterOnlineRoom(joinCode)}
              disabled={joinCode.trim().length < 4}
              className="rounded-xl bg-emerald-500/90 px-4 py-2 font-bold text-slate-950 disabled:opacity-40"
            >
              Join
            </button>
          </div>

          <div className="my-6 border-t border-white/10" />

          <h2 className="text-lg font-bold text-amber-200">Local solo vs AI</h2>
          <p className="mt-1 text-xs text-emerald-100/60">
            No room code — plays entirely in this browser.
          </p>
          <div className="mt-3">
            <label className="mb-1 block text-sm font-medium text-emerald-100/80">
              AI Opponents
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[1, 2, 3].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => setBotCount(num)}
                  className={`rounded-xl border py-2.5 text-sm font-semibold transition ${
                    botCount === num
                      ? "border-amber-300/80 bg-amber-400/20 text-amber-200"
                      : "border-white/10 bg-black/30 text-emerald-100/60 hover:border-white/20"
                  }`}
                >
                  {num} Bot{num > 1 ? "s" : ""}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={handleStartSolo}
            className="mt-4 w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 font-semibold text-white hover:bg-white/10"
          >
            Start Local Game
          </button>

          <div className="mt-6 border-t border-white/10 pt-4 text-center">
            <button
              type="button"
              onClick={() => setShowRules(true)}
              className="text-xs font-semibold text-amber-300 hover:underline"
            >
              📖 How to Play (Rules)
            </button>
          </div>
        </div>

        <OtherGames />
        {error && (
          <p className="mt-3 text-center text-sm text-rose-300">{error}</p>
        )}
        {showRules && <RulesModal onClose={() => setShowRules(false)} />}
        {toast && <Toast message={toast} />}
      </div>
    );
  }

  // ─── ONLINE LOBBY ───────────────────────────────────────
  if (mode === "online" && onlineStatus === "lobby") {
    const isHost = youId && youId === hostId;
    const inviteUrl =
      typeof window !== "undefined" && activeRoom
        ? `${window.location.origin}/take-a-number?room=${activeRoom}`
        : "";

    return (
      <div className="mx-auto max-w-lg px-4 py-8">
        <Header />
        <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-6 shadow-xl">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs uppercase tracking-wider text-emerald-100/50">
                Room code
              </p>
              <p className="font-mono text-3xl font-bold tracking-widest text-amber-300">
                {activeRoom}
              </p>
            </div>
            <div className="text-right text-xs text-emerald-100/60">
              {connected ? (
                <span className="text-emerald-300">● Connected</span>
              ) : (
                <span className="text-rose-300">○ Connecting…</span>
              )}
              <div className="mt-1">
                {lobbyPlayers.length}/4 players
              </div>
            </div>
          </div>

          {inviteUrl && (
            <button
              type="button"
              className="mt-3 w-full truncate rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-left text-xs text-emerald-100/70 hover:bg-black/50"
              onClick={() => {
                void navigator.clipboard?.writeText(inviteUrl);
                showToast("Invite link copied");
              }}
            >
              📋 {inviteUrl}
            </button>
          )}

          <ul className="mt-4 space-y-2">
            {lobbyPlayers.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm"
              >
                <span>
                  {p.isBot ? "🤖 " : ""}
                  {p.name}
                  {p.id === youId ? " (You)" : ""}
                  {p.isHost ? " · Host" : ""}
                </span>
                <span className="text-xs text-emerald-100/50">
                  {p.isBot ? "AI" : p.connected ? "Online" : "Away"}
                </span>
              </li>
            ))}
            {lobbyPlayers.length === 0 && (
              <li className="text-sm text-emerald-100/50">Waiting to join…</li>
            )}
          </ul>

          {isHost && (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => send({ type: "addBots", count: 1 })}
                className="rounded-xl border border-white/15 px-3 py-2 text-xs font-semibold hover:bg-white/5"
              >
                + AI bot
              </button>
              <button
                type="button"
                onClick={() => send({ type: "removeBot" })}
                className="rounded-xl border border-white/15 px-3 py-2 text-xs font-semibold hover:bg-white/5"
              >
                − Remove bot
              </button>
              <button
                type="button"
                onClick={() => send({ type: "start" })}
                disabled={lobbyPlayers.length < 2}
                className="ml-auto rounded-xl bg-amber-400 px-4 py-2 text-sm font-bold text-slate-950 disabled:opacity-40"
              >
                Start game
              </button>
            </div>
          )}
          {!isHost && onlineJoined && (
            <p className="mt-4 text-center text-sm text-emerald-100/60">
              Waiting for host to start…
            </p>
          )}

          <button
            type="button"
            onClick={leaveOnline}
            className="mt-4 w-full rounded-xl border border-white/15 py-2 text-xs hover:bg-white/5"
          >
            Leave room
          </button>
        </div>
        {error && (
          <p className="mt-3 text-center text-sm text-rose-300">{error}</p>
        )}
        {toast && <Toast message={toast} />}
      </div>
    );
  }

  // ─── ONLINE PLAYING ─────────────────────────────────────
  if (mode === "online" && onlineGame) {
    const g = onlineGame;
    const humanIdx = g.yourIndex ?? -1;
    const isHost = youId && youId === hostId;

    return (
      <>
        <GameTable
          centerRows={g.centerRows}
          phase={g.phase}
          currentRound={g.currentRound}
          totalRounds={g.totalRounds}
          players={g.players}
          yourIndex={humanIdx}
          yourHand={g.yourHand}
          activePlayerIndex={g.activePlayerIndex}
          log={g.log}
          roomLabel={activeRoom ?? undefined}
          connected={connected}
          onChooseCard={(n) => send({ type: "chooseCard", cardNumber: n })}
          onChooseRow={(r) => send({ type: "chooseRow", rowIndex: r })}
          onPickPersonal={(n) => send({ type: "pickPersonal", cardNumber: n })}
          onStartNextRound={
            isHost ? () => send({ type: "startNextRound" }) : undefined
          }
          onPlayAgain={isHost ? () => send({ type: "playAgain" }) : undefined}
          onQuit={leaveOnline}
          onShowRules={() => setShowRules(true)}
          canAct
        />
        {showRules && <RulesModal onClose={() => setShowRules(false)} />}
        {toast && <Toast message={toast} />}
      </>
    );
  }

  // Online connecting / no state yet
  if (mode === "online") {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="text-emerald-100/70">
          {connected ? "Joining room…" : "Connecting…"}
        </p>
        <button
          type="button"
          onClick={leaveOnline}
          className="mt-4 text-sm text-amber-300 hover:underline"
        >
          Cancel
        </button>
        {toast && <Toast message={toast} />}
      </div>
    );
  }

  // ─── SOLO PLAYING ───────────────────────────────────────
  if (mode === "solo" && !soloG) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center text-emerald-100/70">
        Loading…
      </div>
    );
  }

  if (mode !== "solo" || !soloG) {
    return null;
  }

  const humanIdx = soloG.players.findIndex((p) => p.id === humanPlayerId);
  const soloPlayers: PublicPlayer[] = soloG.players.map((p) => ({
    id: p.id,
    name: p.name,
    isBot: p.isBot,
    handCount: p.hand.length,
    hasChosenCard: p.faceDownCard !== null,
    faceDownCard: p.faceDownCard,
    personalRow: p.personalRow,
    personalPileCount: p.personalPile.length,
    personalPileBulls: p.personalPile.reduce((s, c) => s + c.points, 0),
    score: p.score,
    pendingTakenCards: p.id === humanPlayerId ? p.pendingTakenCards : null,
  }));

  return (
    <>
      <GameTable
        centerRows={soloG.centerRows}
        phase={soloG.phase}
        currentRound={soloG.currentRound}
        totalRounds={soloG.options.totalRounds}
        players={soloPlayers}
        yourIndex={humanIdx}
        yourHand={soloG.players[humanIdx]?.hand ?? []}
        activePlayerIndex={soloG.activePlayerIndex}
        log={soloG.log}
        onChooseCard={(n) => handleChooseCardSolo(humanIdx, n)}
        onChooseRow={(r) => handleChooseRowSolo(humanIdx, r)}
        onPickPersonal={(n) => handlePickPersonalSolo(humanIdx, n)}
        onStartNextRound={() =>
          setSoloG((prev) => (prev ? startNextRound(prev) : prev))
        }
        onPlayAgain={handleStartSolo}
        onQuit={() => {
          setSoloG(null);
          setMode("menu");
        }}
        onShowRules={() => setShowRules(true)}
        canAct
      />
      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
      {toast && <Toast message={toast} />}
    </>
  );
}

// ─── Shared game table ────────────────────────────────────

function GameTable({
  centerRows,
  phase,
  currentRound,
  totalRounds,
  players,
  yourIndex,
  yourHand,
  activePlayerIndex,
  log,
  roomLabel,
  connected,
  onChooseCard,
  onChooseRow,
  onPickPersonal,
  onStartNextRound,
  onPlayAgain,
  onQuit,
  onShowRules,
  canAct,
}: {
  centerRows: CenterRow[];
  phase: Phase;
  currentRound: number;
  totalRounds: number;
  players: PublicPlayer[];
  yourIndex: number;
  yourHand: Card[];
  activePlayerIndex: number | null;
  log: string[];
  roomLabel?: string;
  connected?: boolean;
  onChooseCard: (n: number) => void;
  onChooseRow: (r: number) => void;
  onPickPersonal: (n: number) => void;
  onStartNextRound?: () => void;
  onPlayAgain?: () => void;
  onQuit: () => void;
  onShowRules: () => void;
  canAct: boolean;
}) {
  const you = yourIndex >= 0 ? players[yourIndex] : null;
  const isYourPlace =
    canAct &&
    phase === Phase.PlaceCard &&
    activePlayerIndex === yourIndex &&
    you?.faceDownCard != null;
  const isYourPick =
    canAct &&
    phase === Phase.PickPersonalCard &&
    activePlayerIndex === yourIndex &&
    you?.pendingTakenCards != null;

  return (
    <div className="mx-auto max-w-6xl px-3 py-4 sm:px-4 sm:py-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
        <div>
          <h1 className="text-xl font-bold text-white sm:text-2xl">
            Take a Number <span className="text-amber-300">🔢</span>
            {roomLabel ? (
              <span className="ml-2 font-mono text-sm text-emerald-200/70">
                {roomLabel}
              </span>
            ) : null}
          </h1>
          <p className="text-xs text-emerald-100/70">
            Round {currentRound}/{totalRounds} ·{" "}
            {phase === Phase.ChooseCard && "Choose a card from your hand"}
            {phase === Phase.PlaceCard && "Select a row to take"}
            {phase === Phase.PickPersonalCard && "Pick 1 card for your personal # Row"}
            {phase === Phase.BetweenRounds && "Round Finished!"}
            {phase === Phase.Ended && "Game Over!"}
            {connected === false ? " · Reconnecting…" : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onShowRules}
            className="rounded-full border border-white/15 px-3 py-1 text-xs text-amber-200 hover:bg-white/5"
          >
            Rules
          </button>
          <a
            href="/"
            className="rounded-full border border-white/15 px-3 py-1 text-xs hover:bg-white/5"
          >
            ← Take 5!
          </a>
          <button
            type="button"
            onClick={onQuit}
            className="rounded-full border border-white/15 px-3 py-1 text-xs hover:bg-white/5"
          >
            Quit
          </button>
        </div>
      </header>

      <div className="mb-4 rounded-2xl border border-amber-300/30 bg-slate-900/80 p-3 shadow-lg backdrop-blur-md">
        <div className="mb-1.5 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-amber-300/90">
          <span>🏆 Scoreboard · Round {currentRound}</span>
          <span className="text-[0.65rem] font-normal normal-case text-emerald-100/60">
            Fewest points wins
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {players.map((p, idx) => {
            const pilePenalty = p.personalPileBulls * 2;
            const totalScore = p.score + pilePenalty;
            return (
              <div
                key={p.id}
                className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs transition ${
                  idx === yourIndex
                    ? "border-amber-400 bg-amber-400/20 font-bold text-amber-100 ring-2 ring-amber-400/40"
                    : "border-white/10 bg-black/40 font-medium text-emerald-100/90"
                }`}
              >
                <span>
                  {p.isBot ? "🤖 " : ""}
                  {p.name}
                  {idx === yourIndex ? " (You)" : ""}:
                </span>
                <span className="rounded border border-amber-400/30 bg-amber-400/20 px-2 py-0.5 text-xs font-extrabold tabular-nums text-amber-300">
                  {totalScore} pts
                </span>
                {p.hasChosenCard ? (
                  <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[0.65rem] font-bold text-emerald-300">
                    Ready ✓
                  </span>
                ) : phase === Phase.ChooseCard ? (
                  <span className="text-[0.65rem] italic text-emerald-200/40">
                    thinking…
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          <section className="rounded-2xl border border-white/10 bg-slate-900/60 p-4 backdrop-blur-md">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-amber-300/90">
              Center Rows
            </h2>
            <div className="space-y-3">
              {centerRows.map((row, rIdx) => (
                <div
                  key={rIdx}
                  className={`flex flex-wrap items-center gap-2 rounded-xl border p-2.5 transition ${
                    isYourPlace
                      ? "cursor-pointer border-amber-400 bg-amber-400/10 hover:bg-amber-400/20"
                      : "border-white/10 bg-black/20"
                  }`}
                  onClick={isYourPlace ? () => onChooseRow(rIdx) : undefined}
                >
                  <div className="w-28 shrink-0">
                    <span className="text-xs font-bold text-amber-200">
                      {row.capacity}-Cards Row
                    </span>
                    <div className="text-[0.65rem] text-emerald-100/60">
                      {row.cards.length} / {row.capacity}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {row.cards.map((card, cIdx) => (
                      <CardView key={cIdx} card={card} size="sm" />
                    ))}
                  </div>
                  {isYourPlace && (
                    <button
                      type="button"
                      className="ml-auto rounded-lg bg-amber-400 px-3 py-1 text-xs font-bold text-slate-950 shadow"
                    >
                      Take Row
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>

          {isYourPick && you?.pendingTakenCards && (
            <div className="rounded-2xl border border-amber-400/50 bg-amber-950/80 p-4 shadow-2xl backdrop-blur-md">
              <h3 className="text-base font-bold text-amber-200">
                Pick 1 Card for your Personal # Row (X Row)
              </h3>
              <p className="mt-1 text-xs text-amber-100/80">
                Remaining cards go into your hand.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {you.pendingTakenCards.map((card) => (
                  <CardView
                    key={card.number}
                    card={card}
                    selectable
                    onClick={() => onPickPersonal(card.number)}
                  />
                ))}
              </div>
            </div>
          )}

          {phase === Phase.BetweenRounds && (
            <div className="rounded-2xl border border-amber-300/40 bg-amber-950/70 p-6 text-center shadow-xl">
              <h3 className="text-xl font-bold text-amber-200">
                Round {currentRound} Complete!
              </h3>
              {onStartNextRound ? (
                <button
                  type="button"
                  onClick={onStartNextRound}
                  className="mt-4 rounded-xl bg-amber-400 px-6 py-2.5 font-bold text-slate-950 shadow hover:bg-amber-300"
                >
                  Start Round {currentRound + 1}
                </button>
              ) : (
                <p className="mt-2 text-sm text-emerald-100/80">
                  Waiting for host to start the next round…
                </p>
              )}
            </div>
          )}

          {phase === Phase.Ended && (
            <div className="rounded-2xl border border-emerald-400/40 bg-emerald-950/80 p-6 text-center shadow-xl">
              <h3 className="text-2xl font-bold text-emerald-200">🏆 Game Finished!</h3>
              <p className="mt-2 text-sm text-emerald-100/90">
                Winner:{" "}
                <span className="font-bold text-amber-300">
                  {[...players].sort((a, b) => {
                    const sa = a.score + a.personalPileBulls * 2;
                    const sb = b.score + b.personalPileBulls * 2;
                    return sa - sb;
                  })[0]?.name}
                </span>
              </p>
              {onPlayAgain && (
                <button
                  type="button"
                  onClick={onPlayAgain}
                  className="mt-4 rounded-xl bg-amber-400 px-6 py-2.5 font-bold text-slate-950 shadow hover:bg-amber-300"
                >
                  Play Again
                </button>
              )}
            </div>
          )}

          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {players.map((p, idx) => {
              const pilePts = p.personalPileBulls * 2;
              return (
                <div
                  key={p.id}
                  className={`rounded-xl border p-3 ${
                    idx === activePlayerIndex
                      ? "border-amber-300/80 bg-amber-400/10"
                      : "border-white/10 bg-slate-900/40"
                  }`}
                >
                  <div className="flex items-center justify-between border-b border-white/10 pb-2">
                    <span className="text-sm font-bold text-white">
                      {p.name} {idx === yourIndex ? "(You)" : ""}
                    </span>
                    <div className="text-xs font-bold text-amber-300">
                      {p.score + pilePts} pts
                    </div>
                  </div>
                  <div className="mt-2 flex justify-between text-[0.7rem] text-emerald-100/70">
                    <span>Hand: {p.handCount}</span>
                    <span>
                      {p.hasChosenCard ? "✓ Selected" : "Choosing…"}
                    </span>
                  </div>
                  <div className="mt-2 border-t border-white/10 pt-2">
                    <div className="mb-1 text-[0.65rem] font-semibold text-amber-200/90">
                      # Row (safe):
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {p.personalRow.length > 0 ? (
                        p.personalRow.map((c) => (
                          <CardView key={c.number} card={c} size="sm" />
                        ))
                      ) : (
                        <span className="text-[0.65rem] text-emerald-100/40">Empty</span>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 border-t border-rose-500/20 pt-2 text-[0.65rem] text-rose-300">
                    # Pile: {p.personalPileCount} cards · +{pilePts} pts
                  </div>
                </div>
              );
            })}
          </section>

          <section className="rounded-2xl border border-white/10 bg-black/40 p-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-emerald-100/50">
              Game Log
            </h3>
            <div className="max-h-32 space-y-1 overflow-y-auto font-mono text-[0.7rem] text-emerald-100/70">
              {log.slice(-12).map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          </section>
        </div>

        <div className="shrink-0 lg:w-80">
          {you && (
            <section className="sticky top-4 rounded-2xl border border-white/10 bg-slate-900/80 p-3 shadow-2xl backdrop-blur-md sm:p-4">
              <div className="mb-2.5 flex items-center justify-between border-b border-white/10 pb-2">
                <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-300/90 sm:text-sm">
                  <span>Your Hand</span>
                  <span className="text-xs font-normal normal-case text-emerald-100/60">
                    ({yourHand.length})
                  </span>
                </h2>
                {phase === Phase.ChooseCard && !you.hasChosenCard && (
                  <span className="text-xs font-semibold text-amber-200">Tap card</span>
                )}
                {you.faceDownCard && (
                  <span className="text-xs font-semibold text-emerald-300">
                    Selected #{you.faceDownCard.number}
                  </span>
                )}
              </div>
              <div className="flex max-h-[75vh] flex-wrap justify-center gap-2 overflow-y-auto p-1">
                {yourHand.map((card) => {
                  const isChosen = you.faceDownCard?.number === card.number;
                  return (
                    <CardView
                      key={card.number}
                      card={card}
                      selected={isChosen}
                      selectable={
                        canAct &&
                        phase === Phase.ChooseCard &&
                        !you.hasChosenCard
                      }
                      onClick={() => onChooseCard(card.number)}
                    />
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function Header() {
  return (
    <header className="mb-6 text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.35em] text-amber-300">
        SFboardgames
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">
        Take a Number <span className="text-amber-300">🔢</span>
      </h1>
      <p className="mt-2 text-sm text-emerald-100/70">
        <i>X nimmt!</i> — multiplayer rooms or solo vs AI
      </p>
    </header>
  );
}

function OtherGames() {
  return (
    <div className="mt-8 rounded-2xl border border-white/10 bg-slate-900/60 p-4 text-center backdrop-blur-md">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-emerald-100/60">
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
          href="/mrjack"
          className="flex items-center justify-center gap-1.5 rounded-xl border border-violet-400/50 bg-violet-500/15 px-3 py-2.5 text-xs font-semibold text-violet-100 hover:bg-violet-500/25"
        >
          Mr. Jack 🕵️
        </a>
      </div>
    </div>
  );
}

function Toast({ message }: { message: string }) {
  return (
    <div className="fixed bottom-6 left-1/2 z-50 max-w-[90vw] -translate-x-1/2 rounded-full bg-slate-900/95 px-4 py-2 text-center text-sm text-amber-100 shadow-xl ring-1 ring-white/10">
      {message}
    </div>
  );
}

function RulesModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-amber-300/30 bg-slate-900 p-6 text-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <h2 className="text-xl font-bold text-amber-300">
            Take a Number (X nimmt!) Rules
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-white/10 px-3 py-1 text-xs hover:bg-white/20"
          >
            ✕
          </button>
        </div>
        <div className="mt-4 space-y-3 text-xs leading-relaxed text-emerald-100/80">
          <p>
            <strong className="text-amber-200">Objective:</strong> Score the fewest
            penalty points over 2 rounds!
          </p>
          <p>
            <strong className="text-amber-200">1. Center Rows:</strong> Limits of{" "}
            <strong>3, 4, and 5 cards</strong>. Place ascending with least difference.
          </p>
          <p>
            <strong className="text-amber-200">2. Taking a Row:</strong> A row holds up
            to its limit. The next card past a full row (or a card too low for all rows)
            takes the cards already there.
          </p>
          <p>
            <strong className="text-amber-200">3. Personal # Row:</strong> Pick 1 taken
            card for your # Row; the rest go to your hand.
          </p>
          <p>
            <strong className="text-amber-200">4. Overflow:</strong> # Row must stay
            ascending or it dumps into the # Pile (2× penalty).
          </p>
          <p>
            <strong className="text-amber-200">Multiplayer:</strong> Create a room, share
            the code/link, host starts when ready. Reconnect with the same device to keep
            your seat.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-6 w-full rounded-xl bg-amber-400 py-2.5 text-xs font-bold text-slate-950 shadow"
        >
          Got it!
        </button>
      </div>
    </div>
  );
}
