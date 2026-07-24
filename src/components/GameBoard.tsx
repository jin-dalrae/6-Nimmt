import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  dealLabel,
  diffActivity,
  lockStatusLine,
  phaseStatus,
  trickLabel,
  type ActivityItem,
} from "../game/activity";
import { AI_STYLES } from "../game/ai";
import { getCard } from "../game/card";
import type { SpectatorInfo } from "../game/protocol";
import { MoveName, Phase, type PublicGameState } from "../game/types";
import { CardView } from "./CardView";

type Props = {
  game: PublicGameState;
  isHost: boolean;
  isSpectator?: boolean;
  spectators?: SpectatorInfo[];
  onChoose: (cardNumber: number) => void;
  onPlace: (row: number, replace: boolean) => void;
  /** When forced to take a row: play a different hand card instead */
  onSwapCard: (cardNumber: number) => void;
  /** Host: end game / results → lobby only */
  onRestart: () => void;
  /** Host: lobby reset then start a new deal immediately */
  onPlayAgain: () => void;
  onPauseBetweenDeals: () => void;
  onResumeBetweenDeals: () => void;
  onContinueBetweenDeals: () => void;
};

const toneClass: Record<NonNullable<ActivityItem["tone"]>, string> = {
  info: "text-emerald-100/80",
  warn: "text-amber-200",
  good: "text-sky-200",
  hot: "text-red-200",
};

const bannerTone: Record<NonNullable<ActivityItem["tone"]>, string> = {
  info: "border-emerald-400/30 bg-emerald-950/50",
  warn: "border-amber-400/40 bg-amber-950/45",
  good: "border-sky-400/35 bg-sky-950/40",
  hot: "border-red-400/50 bg-red-950/50",
};

export function GameBoard({
  game,
  isHost,
  isSpectator = false,
  spectators = [],
  onChoose,
  onPlace,
  onSwapCard,
  onRestart,
  onPlayAgain,
  onPauseBetweenDeals,
  onResumeBetweenDeals,
  onContinueBetweenDeals,
}: Props) {
  const you = isSpectator || game.yourIndex < 0 ? undefined : game.players[game.yourIndex];
  const placeMoves = you?.availableMoves?.[MoveName.PlaceCard] ?? [];
  const mustPickRow =
    !isSpectator &&
    placeMoves.length > 1 &&
    placeMoves.every((m) => m.replace);
  const betweenDeals = game.phase === Phase.BetweenDeals && !game.ended;
  const canChoose =
    !isSpectator &&
    game.phase === Phase.ChooseCard &&
    !game.ended &&
    !you?.hasChosen &&
    (you?.availableMoves?.[MoveName.ChooseCard]?.length ?? 0) > 0;
  /** Forced row-take: may put card back and pick another from hand */
  const canSwapCard =
    mustPickRow && !game.ended && (you?.hand?.length ?? 0) > 0;
  const yourPlayed = you?.faceDownCard && you.faceDownCard.number > 0 ? you.faceDownCard : null;

  const waitingChoose =
    !isSpectator &&
    game.phase === Phase.ChooseCard &&
    !game.ended &&
    !!you?.hasChosen &&
    game.players.some((p) => !p.hasChosen);

  const status = phaseStatus(game);
  const turnLine = `${dealLabel(game)} · ${trickLabel(game)}`;

  const sortedHand = (you?.hand ?? []).slice().sort((a, b) => a.number - b.number);
  const watchers = spectators.filter((s) => s.connected);

  const prevGame = useRef<PublicGameState | null>(null);
  /** Card numbers revealed this trick (kept after a card is placed so order stays low→high). */
  const trickCardNumbers = useRef<Map<number, number>>(new Map());
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  /** Sticky take / news shown in the status pill (not wiped by “your turn”) */
  const [statusAlert, setStatusAlert] = useState<ActivityItem | null>(null);
  const alertTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevHasChosen = useRef(false);
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
  const [betweenCountdown, setBetweenCountdown] = useState<number | null>(null);

  // Live countdown during the between-deals break
  useEffect(() => {
    if (!betweenDeals) {
      setBetweenCountdown(null);
      return;
    }
    if (game.betweenDealsPaused) {
      setBetweenCountdown(null);
      return;
    }
    const endsAt = game.betweenDealsEndsAt;
    if (endsAt == null) {
      setBetweenCountdown(null);
      return;
    }
    const tick = () => {
      setBetweenCountdown(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)));
    };
    tick();
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [betweenDeals, game.betweenDealsPaused, game.betweenDealsEndsAt]);

  const clearAlertTimer = () => {
    if (alertTimer.current) {
      clearTimeout(alertTimer.current);
      alertTimer.current = null;
    }
  };

  useEffect(() => {
    setHeaderSlot(document.getElementById("game-header-actions"));
  }, []);

  // Track each player's card number for this trick so the strip can stay sorted low→high
  // even after lower cards have already been placed (faceDownCard cleared).
  if (game.phase === Phase.ChooseCard && !game.ended) {
    trickCardNumbers.current = new Map();
  } else {
    for (let i = 0; i < game.players.length; i++) {
      const n = game.players[i]?.faceDownCard?.number ?? 0;
      if (n > 0) trickCardNumbers.current.set(i, n);
    }
  }

  const trickOrder = game.players
    .map((p, i) => ({
      p,
      i,
      n: trickCardNumbers.current.get(i) ?? p.faceDownCard?.number ?? 0,
    }))
    .sort((a, b) => {
      // Known card numbers: low → high (placement order)
      if (a.n > 0 && b.n > 0) return a.n - b.n;
      if (a.n > 0) return -1;
      if (b.n > 0) return 1;
      return a.i - b.i;
    });

  useEffect(() => {
    const events = diffActivity(prevGame.current, game);
    prevGame.current = game;
    if (events.length === 0) return;

    setActivity((log) => [...events.reverse(), ...log].slice(0, 12));

    // Prefer *your* row-take (with why). Don't let soft news steal a sticky “why” take.
    const yourTake = events.find(
      (e) =>
        e.tone === "hot" &&
        e.detail &&
        (e.text.startsWith("You ") || e.text.startsWith("Your ")),
    );
    const anyTake = events.find((e) => e.tone === "hot");
    const news = events.find((e) => e.tone === "good");
    const alert = yourTake ?? anyTake ?? news ?? null;

    if (!alert) return;

    // Sticky take explanations stay until the next take, you lock a card, or a long safety timeout.
    // Short-lived: deal news / simple toasts only.
    const stickyWhy = Boolean(alert.detail && alert.tone === "hot");
    setStatusAlert(alert);
    clearAlertTimer();
    const ms = stickyWhy ? 90_000 : alert.tone === "good" ? 9_000 : 7_000;
    alertTimer.current = setTimeout(() => setStatusAlert(null), ms);
  }, [game]);

  // After you lock in a card, release sticky take so “waiting on others” can show
  useEffect(() => {
    const locked = Boolean(you?.hasChosen);
    if (
      locked &&
      !prevHasChosen.current &&
      game.phase === Phase.ChooseCard &&
      statusAlert?.detail
    ) {
      clearAlertTimer();
      alertTimer.current = setTimeout(() => setStatusAlert(null), 2_000);
    }
    prevHasChosen.current = locked;
  }, [you?.hasChosen, game.phase, statusAlert?.detail]);

  useEffect(() => {
    return () => clearAlertTimer();
  }, []);

  // History of taking table rows (bulls) — shown when alert / Hits is opened
  const collectLog = activity.filter(
    (a) =>
      a.tone === "hot" ||
      /got |full row|too low|bull|🐂|took \d/i.test(a.text),
  );
  const logItems = collectLog.length > 0 ? collectLog : activity;

  // Footer under the alert: who locked / still placing (not mixed into the “why” text)
  const lockFooter = !game.ended ? lockStatusLine(game) : null;

  // While choosing a row, keep the top pill short — long rules sat on/under the
  // table and blocked taps. The compact banner lives with the rows instead.
  const statusPill = mustPickRow
    ? {
        text: status.headline,
        detail: status.detail || undefined,
        tone: status.tone,
      }
    : statusAlert
      ? {
          text: statusAlert.text,
          detail: statusAlert.detail,
          tone: statusAlert.tone ?? "hot",
        }
      : !game.ended
        ? {
            text: status.headline,
            detail: status.detail || undefined,
            tone: status.tone,
          }
        : null;

  return (
    <div
      className={`play-shell mx-auto flex w-full max-w-7xl flex-col gap-2 sm:gap-3 ${
        !game.ended && !isSpectator && !betweenDeals ? "play-shell--with-hand" : ""
      } ${mustPickRow ? "play-shell--pick-row" : ""}`}
    >
      {/* Top: all scores visible (wrap, no horizontal scroll) · turn · compact status */}
      <div className="felt-panel space-y-1 px-2 py-1.5 sm:px-2.5 sm:py-1.5">
        <div className="score-scroll">
          {game.players.map((p, i) => (
            <div
              key={i}
              className={`score-chip ${
                p.isYou ? "score-chip--you" : ""
              }`}
              title={
                p.isBot && p.aiStyle
                  ? `${p.name} (${AI_STYLES.find((s) => s.id === p.aiStyle)?.label ?? p.aiStyle}) · ${p.points}🐂`
                  : `${p.name} · ${p.points}🐂`
              }
            >
              <span className="score-chip-name">
                {p.isBot ? "🤖" : ""}
                {p.name}
              </span>
              <span className="score-chip-pts tabular-nums">{p.points}🐂</span>
              {game.phase === Phase.ChooseCard && !game.ended ? (
                <span
                  className={
                    p.hasChosen ? "text-emerald-300" : "text-emerald-200/40"
                  }
                  aria-hidden
                >
                  {p.hasChosen ? "✓" : "…"}
                </span>
              ) : null}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-[0.65rem] font-medium text-amber-200/90 sm:text-[0.7rem]">
            {turnLine}
            {game.tightDeck ? (
              <span className="ml-1 font-normal text-sky-300/80">· tight</span>
            ) : null}
          </span>
          {watchers.length > 0 ? (
            <span className="shrink-0 text-[0.65rem] text-sky-200/75 sm:text-[0.7rem]">
              👁 {watchers.map((s) => s.name).join(", ")}
            </span>
          ) : null}
        </div>

        {statusPill ? (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setRulesOpen(false);
              setLogOpen(true);
            }}
            className={`status-alert block w-full cursor-pointer rounded border text-left ${bannerTone[statusPill.tone]} ${
              statusAlert ? "status-alert--hit" : ""
            } ${
              statusPill.tone === "hot" ? "status-alert--hot" : ""
            } ${logOpen ? "ring-1 ring-amber-300/50" : "hover:brightness-110"}`}
            title="Tap to open full Hits history"
          >
            <span className="status-alert-text">
              <span className="status-alert-title">{statusPill.text}</span>
              {statusPill.detail ? (
                <span className="status-alert-detail">{statusPill.detail}</span>
              ) : null}
            </span>
            {lockFooter ? (
              <span className="status-alert-footer">{lockFooter}</span>
            ) : null}
          </button>
        ) : null}
      </div>

      {/* Hits / Rules / Lobby — next to logo in page header */}
      {headerSlot
        ? createPortal(
            <>
              <button
                type="button"
                onClick={() => {
                  setLogOpen((o) => !o);
                  setRulesOpen(false);
                }}
                className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${
                  logOpen
                    ? "bg-amber-400/20 text-amber-100 ring-amber-300/50"
                    : "bg-black/30 text-emerald-100/80 ring-white/15 hover:bg-white/10"
                }`}
              >
                Hits{logItems.length ? ` ${logItems.length}` : ""}
              </button>
              <button
                type="button"
                onClick={() => {
                  setRulesOpen((o) => !o);
                  setLogOpen(false);
                }}
                className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${
                  rulesOpen
                    ? "bg-amber-400/20 text-amber-100 ring-amber-300/50"
                    : "bg-black/30 text-emerald-100/80 ring-white/15 hover:bg-white/10"
                }`}
              >
                Rules
              </button>
              {isHost && game.ended ? (
                <button
                  type="button"
                  onClick={onPlayAgain}
                  className="rounded-full bg-amber-400/90 px-2.5 py-1 text-xs font-semibold text-slate-900 ring-1 ring-amber-300/60 hover:bg-amber-300"
                  title="Start another deal right away"
                >
                  Play again
                </button>
              ) : null}
              {isHost ? (
                <button
                  type="button"
                  onClick={() => {
                    if (
                      game.ended ||
                      window.confirm(
                        "End this game and return everyone to the lobby?",
                      )
                    ) {
                      onRestart();
                    }
                  }}
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${
                    game.ended
                      ? "bg-black/30 text-emerald-100/90 ring-white/20 hover:bg-white/10"
                      : "bg-amber-400/90 text-slate-900 ring-amber-300/60 hover:bg-amber-300"
                  }`}
                  title={
                    game.ended
                      ? "Open lobby (change bots / settings)"
                      : "Host only — stop game and return to lobby"
                  }
                >
                  Lobby
                </button>
              ) : null}
            </>,
            headerSlot,
          )
        : null}

      {/* Centered overlays — open from status alert or header Hits/Rules */}
      {logOpen ? (
        <>
          <button
            type="button"
            className="score-overlay-backdrop"
            aria-label="Close history"
            onClick={() => setLogOpen(false)}
          />
          <div className="score-overlay" role="dialog" aria-label="Row collect history">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-200/90">
                Table card collecting
              </p>
              <button
                type="button"
                className="text-xs text-emerald-100/50 hover:text-emerald-100"
                onClick={() => setLogOpen(false)}
              >
                Close
              </button>
            </div>
            {logItems.length > 0 ? (
              <ul className="max-h-[min(50vh,18rem)] space-y-2.5 overflow-y-auto text-[0.8rem] leading-snug sm:text-[0.85rem]">
                {logItems.map((item) => (
                  <li key={item.id} className={toneClass[item.tone ?? "info"]}>
                    <div className="font-semibold">· {item.text}</div>
                    {item.detail ? (
                      <p className="mt-0.5 pl-2.5 text-[0.92em] font-normal leading-snug text-emerald-100/70">
                        {item.detail}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[0.8rem] text-emerald-100/55">
                No rows collected yet this game. Full-row takes and “too low” picks show up here —
                each entry explains why those cards went to someone’s pile.
              </p>
            )}
            <p className="mt-2 text-[0.75rem] text-emerald-100/40">
              Who took a row · why (6th card vs too low) · bull heads
            </p>
          </div>
        </>
      ) : null}

      {rulesOpen ? (
        <>
          <button
            type="button"
            className="score-overlay-backdrop"
            aria-label="Close rules"
            onClick={() => setRulesOpen(false)}
          />
          <div className="score-overlay" role="dialog" aria-label="Bull-head scoring">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-100/90">
                Bull-head scoring
              </p>
              <button
                type="button"
                className="text-xs text-emerald-100/50 hover:text-emerald-100"
                onClick={() => setRulesOpen(false)}
              >
                Close
              </button>
            </div>
            <ul className="mb-3 grid gap-1 text-xs text-emerald-50/90 sm:grid-cols-2">
              <li>
                <span className="text-emerald-100/60">Normal</span> → <strong>1</strong> 🐂
              </li>
              <li>
                <span className="text-emerald-100/60">Ends in 5</span> → <strong>2</strong> 🐂
              </li>
              <li>
                <span className="text-emerald-100/60">×10</span> → <strong>3</strong> 🐂
              </li>
              <li className="text-red-200">
                <span className="opacity-80">×11</span> → <strong>5</strong> 🐂
              </li>
              <li className="text-red-200">
                <span className="opacity-80">55</span> → <strong>7</strong> 🐂
              </li>
            </ul>
            <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-emerald-100/70">
              Taking a row (official)
            </p>
            <ul className="mt-1 space-y-1 text-xs text-emerald-50/85">
              <li>
                <strong className="text-amber-200">Full row:</strong> your card fits the closest
                lower end, but that row already has 5 cards → you take those 5 (6th card rule).
              </li>
              <li>
                <strong className="text-amber-200">Too low:</strong> your card is lower than every
                row’s last card → you choose any row to take (usually fewest 🐂); your card starts
                it.
              </li>
            </ul>
          </div>
        </>
      ) : null}

      {game.ended ? (
        <div className="felt-panel p-5 sm:p-6">
          <h2 className="text-center text-2xl font-bold text-amber-300">Game over</h2>
          <p className="mt-2 text-center text-sm text-emerald-100/80">
            Deal finished after someone hit {game.pointsToEnd}+. Fewest bull heads wins.
          </p>

          <ul className="mx-auto mt-4 max-w-md space-y-2">
            {[...game.players]
              .map((p, i) => ({ p, i }))
              .sort((a, b) => a.p.points - b.p.points)
              .map(({ p, i }, rank) => {
                const isWinner = game.winnerIndexes.includes(i);
                const isLoser = (game.loserIndexes ?? []).includes(i);
                return (
                  <li
                    key={i}
                    className={`flex items-center justify-between rounded-xl px-3 py-2 text-sm ${
                      isWinner
                        ? "bg-amber-400/20 ring-1 ring-amber-300/50"
                        : isLoser
                          ? "bg-red-950/40 ring-1 ring-red-400/40"
                          : "bg-black/25"
                    }`}
                  >
                    <span className="font-semibold">
                      <span className="mr-2 tabular-nums text-emerald-100/50">#{rank + 1}</span>
                      {p.isBot ? "🤖 " : ""}
                      {p.name}
                      {p.isYou ? " (you)" : ""}
                      {isWinner ? (
                        <span className="ml-2 text-xs font-normal text-amber-200">winner</span>
                      ) : null}
                      {isLoser && !isWinner ? (
                        <span className="ml-2 text-xs font-normal text-red-200">highest</span>
                      ) : null}
                    </span>
                    <span className="tabular-nums text-amber-200">{p.points} 🐂</span>
                  </li>
                );
              })}
          </ul>

          <p className="mt-3 text-center text-sm text-emerald-50">
            <span className="text-amber-200">
              Winner{game.winnerIndexes.length > 1 ? "s" : ""}:{" "}
              {game.winnerIndexes.map((i) => game.players[i].name).join(", ")}
            </span>
            {(game.loserIndexes ?? []).length > 0 ? (
              <>
                {" · "}
                <span className="text-red-200">
                  Highest:{" "}
                  {(game.loserIndexes ?? []).map((i) => game.players[i].name).join(", ")}
                </span>
              </>
            ) : null}
          </p>

          {isHost ? (
            <div className="mt-4 flex flex-col items-center gap-2">
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={onPlayAgain}
                  className="rounded-xl bg-amber-400 px-5 py-2.5 font-semibold text-slate-900 hover:bg-amber-300"
                >
                  Play again
                </button>
                <button
                  type="button"
                  onClick={onRestart}
                  className="rounded-xl border border-white/25 bg-black/25 px-5 py-2.5 font-semibold text-emerald-50 hover:bg-white/10"
                >
                  Back to lobby
                </button>
              </div>
              <p className="text-center text-xs text-emerald-100/55">
                Play again deals a new hand with the same table
                {watchers.length > 0
                  ? ` · ${watchers.length} watcher${watchers.length === 1 ? "" : "s"} join if there’s room`
                  : ""}
              </p>
            </div>
          ) : (
            <p className="mt-3 text-center text-sm text-emerald-100/70">
              {isSpectator
                ? "Waiting for host — you’ll join the next game if they play again or open the lobby."
                : "Waiting for host to play again or return to lobby…"}
            </p>
          )}
        </div>
      ) : isHost && !betweenDeals ? (
        /* Mid-game: host can end early from the board (header Lobby is primary) */
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => {
              if (
                window.confirm("End this game and return everyone to the lobby?")
              ) {
                onRestart();
              }
            }}
            className="rounded-lg border border-amber-400/40 bg-amber-950/30 px-3 py-1.5 text-xs font-medium text-amber-100 hover:bg-amber-900/40"
          >
            Back to lobby
          </button>
        </div>
      ) : null}

      {/* Between deals: standings + 3s countdown / pause */}
      {betweenDeals ? (
        <div className="felt-panel border border-sky-400/30 bg-sky-950/35 p-4 sm:p-5">
          <h2 className="text-center text-lg font-bold text-sky-100 sm:text-xl">
            Deal {game.round} complete
          </h2>
          <p className="mt-1 text-center text-sm text-emerald-100/75">
            {game.thresholdReached
              ? `Someone is at ${game.pointsToEnd}+ — if this was the last deal, game ends after scores.`
              : "Scores so far · next hand coming up"}
          </p>

          <ul className="mx-auto mt-3 max-w-md space-y-1.5">
            {[...game.players]
              .map((p, i) => ({ p, i }))
              .sort((a, b) => a.p.points - b.p.points)
              .map(({ p }, rank) => (
                <li
                  key={rank}
                  className={`flex items-center justify-between rounded-lg px-3 py-1.5 text-sm ${
                    p.isYou
                      ? "bg-amber-400/15 ring-1 ring-amber-300/40"
                      : "bg-black/25"
                  }`}
                >
                  <span className="font-medium">
                    <span className="mr-2 tabular-nums text-emerald-100/45">
                      #{rank + 1}
                    </span>
                    {p.isBot ? "🤖 " : ""}
                    {p.name}
                    {p.isYou ? " (you)" : ""}
                  </span>
                  <span className="tabular-nums text-amber-200">{p.points} 🐂</span>
                </li>
              ))}
          </ul>

          <div className="mt-4 flex flex-col items-center gap-2">
            <p className="text-center text-sm font-semibold text-sky-100">
              {game.betweenDealsPaused
                ? "Paused — take your time"
                : betweenCountdown != null
                  ? `Next deal in ${betweenCountdown}s…`
                  : "Next deal soon…"}
            </p>
            {!isSpectator ? (
              <div className="flex flex-wrap items-center justify-center gap-2">
                {game.betweenDealsPaused ? (
                  <button
                    type="button"
                    onClick={onResumeBetweenDeals}
                    className="rounded-xl bg-sky-400 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-sky-300"
                  >
                    Resume
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onPauseBetweenDeals}
                    className="rounded-xl border border-sky-300/50 bg-sky-950/50 px-4 py-2 text-sm font-medium text-sky-50 hover:bg-sky-900/50"
                  >
                    Pause
                  </button>
                )}
                <button
                  type="button"
                  onClick={onContinueBetweenDeals}
                  className="rounded-xl bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-300"
                >
                  Continue now
                </button>
              </div>
            ) : (
              <p className="text-xs text-emerald-100/55">Watching the break…</p>
            )}
          </div>
        </div>
      ) : null}

      {/* Two-column: table rows first (main focus), played + hand right */}
      <div
        className={`grid grid-cols-1 gap-2 sm:gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(14rem,0.9fr)] lg:items-start ${
          mustPickRow ? "pick-row-mode" : ""
        }`}
      >
        {/* Left: table rows — primary surface (must stay above hand dock when picking) */}
        <div
          className={`felt-panel space-y-1.5 p-2.5 sm:space-y-2 sm:p-3 ${
            mustPickRow ? "table-rows--pick" : ""
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-emerald-100/80 sm:text-sm">
              Table rows
            </h2>
          </div>
          {mustPickRow ? (
            <div className="pick-row-banner" role="status">
              <p className="font-semibold text-amber-100">
                Tap a row to take
                {yourPlayed ? (
                  <span className="font-normal text-amber-100/85">
                    {" "}
                    — #{yourPlayed.number} fits nowhere
                  </span>
                ) : null}
              </p>
              <p className="text-[0.7rem] text-amber-50/80">
                Choose fewest 🐂
                {canSwapCard ? " · or tap a hand card to switch" : ""}
              </p>
            </div>
          ) : null}
          {game.rows.map((row, rowIndex) => {
            const isTarget = mustPickRow && placeMoves.some((m) => m.row === rowIndex);
            const placeOpt = placeMoves.find((m) => m.row === rowIndex);
            const rowPoints = row.reduce((s, c) => s + c.points, 0);
            return (
              <div
                key={rowIndex}
                className={`flex items-center gap-1 sm:gap-1.5 ${
                  isTarget ? "relative z-10" : ""
                }`}
              >
                <span className="w-4 shrink-0 text-center text-[0.65rem] text-emerald-200/60 sm:w-5 sm:text-xs">
                  {rowIndex + 1}
                </span>
                <button
                  type="button"
                  disabled={!isTarget}
                  onClick={() => {
                    if (placeOpt) onPlace(placeOpt.row, placeOpt.replace);
                  }}
                  className={`row-slot min-w-0 flex-1 text-left ${
                    isTarget ? "row-slot--target cursor-pointer" : ""
                  }`}
                >
                  {row.map((card) => (
                    <CardView key={card.number} card={card} size="sm" />
                  ))}
                  {Array.from({ length: Math.max(0, 5 - row.length) }).map((_, i) => (
                    <div
                      key={`empty-${i}`}
                      className="row-empty h-[4.4rem] w-[3.1rem] shrink-0 rounded-lg border border-dashed border-white/10 max-sm:h-[3.5rem] max-sm:w-[2.45rem]"
                    />
                  ))}
                </button>
                <div
                  className={`flex w-10 shrink-0 flex-col items-end text-[0.6rem] leading-tight sm:w-11 sm:text-[0.65rem] ${
                    isTarget ? "text-amber-200/90" : "text-emerald-200/50"
                  }`}
                >
                  <span>{row.length}/5</span>
                  {row.length > 0 ? (
                    <span className="tabular-nums">{rowPoints}🐂</span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        {/* Right: played (only when cards are revealed) + hand */}
        <div className="flex flex-col gap-2 sm:gap-3 lg:sticky lg:top-2">
          {/* Hide empty face-down "Played" during choose — scores already show ✓/… */}
          {(game.phase === Phase.PlaceCard || game.ended) && (
            <div className="felt-panel p-2.5 sm:p-3">
              <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-100/80 sm:text-sm">
                {game.phase === Phase.PlaceCard ? "This trick (low → high)" : "Last cards"}
              </h2>
              <div className="flex flex-wrap gap-1.5 sm:gap-2">
                {trickOrder.map(({ p, i, n }) => {
                  // After a card is placed, faceDownCard is cleared — show the remembered card
                  // so the low→high strip still makes sense through the rest of the trick.
                  const shown =
                    p.faceDownCard && p.faceDownCard.number > 0
                      ? p.faceDownCard
                      : n > 0
                        ? getCard(n)
                        : p.faceDownCard;
                  const placedAway = !p.faceDownCard && n > 0;
                  return (
                    <div
                      key={i}
                      className={`flex flex-col items-center gap-0.5 ${
                        placedAway ? "opacity-45" : ""
                      }`}
                      title={
                        placedAway
                          ? `${p.name}: #${n} already placed`
                          : undefined
                      }
                    >
                      <CardView
                        card={shown}
                        hidden={!!shown && shown.number === 0}
                        size="sm"
                      />
                      <span className="max-w-[3.2rem] truncate text-[0.6rem] text-emerald-100/70 sm:text-[0.65rem]">
                        {p.name}
                      </span>
                    </div>
                  );
                })}
              </div>
              {game.phase === Phase.PlaceCard && !mustPickRow && !game.ended ? (
                <p className="mt-1.5 text-[0.7rem] text-emerald-100/70">Placing…</p>
              ) : null}
            </div>
          )}

          {/* Hand — fixed dock on mobile; hide during between-deals break */}
          {!game.ended && !isSpectator && !betweenDeals ? (
            <div className={`hand-dock ${mustPickRow ? "hand-dock--pick-row" : ""}`}>
              <div className="hand-dock-inner">
                <div className="felt-panel p-2 sm:p-2.5 lg:p-3 lg:shadow-none">
                  <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-emerald-100/80 sm:mb-1.5 sm:text-sm">
                    Your hand
                    {canChoose ? (
                      <span className="font-normal normal-case tracking-normal text-amber-200/90">
                        {" "}
                        — tap a card
                      </span>
                    ) : canSwapCard ? (
                      <span className="font-normal normal-case tracking-normal text-amber-200/90">
                        {" "}
                        — switch card (optional)
                      </span>
                    ) : waitingChoose ? (
                      <span className="font-normal normal-case tracking-normal text-emerald-100/50">
                        {" "}
                        — waiting
                      </span>
                    ) : null}
                  </h2>
                  <div className="hand-scroll lg:gap-2">
                    {sortedHand.map((card) => (
                      <CardView
                        key={card.number}
                        card={card}
                        selectable={canChoose || canSwapCard}
                        onClick={() => {
                          if (canChoose) onChoose(card.number);
                          else if (canSwapCard) onSwapCard(card.number);
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {isSpectator && !game.ended ? (
            <div className="felt-panel p-2 text-center text-xs text-sky-100/80">
              Watching — no hand this round
            </div>
          ) : null}
        </div>
      </div>

    </div>
  );
}
