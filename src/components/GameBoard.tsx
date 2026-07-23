import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  dealLabel,
  diffActivity,
  phaseStatus,
  trickLabel,
  type ActivityItem,
} from "../game/activity";
import { AI_STYLES } from "../game/ai";
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
  onRestart: () => void;
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
}: Props) {
  const you = isSpectator || game.yourIndex < 0 ? undefined : game.players[game.yourIndex];
  const placeMoves = you?.availableMoves?.[MoveName.PlaceCard] ?? [];
  const mustPickRow =
    !isSpectator &&
    placeMoves.length > 1 &&
    placeMoves.every((m) => m.replace);
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
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  /** Shown in the top-right status pill (same slot as “your turn”) */
  const [statusAlert, setStatusAlert] = useState<ActivityItem | null>(null);
  const alertTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setHeaderSlot(document.getElementById("game-header-actions"));
  }, []);

  useEffect(() => {
    const events = diffActivity(prevGame.current, game);
    prevGame.current = game;
    if (events.length === 0) return;

    setActivity((log) => [...events.reverse(), ...log].slice(0, 12));

    // Status pill: row-takes first, then new-deal / game-over news
    const alert =
      events.find((e) => e.tone === "hot") ??
      events.find((e) => e.tone === "good") ??
      events.find((e) => e.text.includes("got ") || e.text.includes("🐂")) ??
      null;
    if (alert) {
      setStatusAlert(alert);
      if (alertTimer.current) clearTimeout(alertTimer.current);
      // New deals stay a bit longer so you notice the 10 cards
      const ms = alert.tone === "good" ? 9000 : 7000;
      alertTimer.current = setTimeout(() => setStatusAlert(null), ms);
    }
  }, [game]);

  useEffect(() => {
    return () => {
      if (alertTimer.current) clearTimeout(alertTimer.current);
    };
  }, []);

  // History of taking table rows (bulls) — shown when alert / Hits is opened
  const collectLog = activity.filter(
    (a) =>
      a.tone === "hot" ||
      /got |full row|too low|bull|🐂|took \d/i.test(a.text),
  );
  const logItems = collectLog.length > 0 ? collectLog : activity;

  const statusPill = statusAlert
    ? { text: statusAlert.text, tone: statusAlert.tone ?? "hot" }
    : !game.ended
      ? { text: status.headline, tone: status.tone }
      : null;

  return (
    <div
      className={`play-shell mx-auto flex w-full max-w-7xl flex-col gap-2 sm:gap-3 ${
        !game.ended && !isSpectator ? "play-shell--with-hand" : ""
      }`}
    >
      {/* Top: scores · turn · single-line status (no wrap) */}
      <div className="felt-panel space-y-1 px-2.5 py-1.5 sm:px-3 sm:py-2">
        <div className="flex items-center gap-2">
          <div className="score-scroll min-w-0 flex-1">
            {game.players.map((p, i) => (
              <div
                key={i}
                className={`shrink-0 rounded-md px-2 py-0.5 text-xs sm:text-sm ${
                  p.isYou ? "bg-amber-400/20 ring-1 ring-amber-300/50" : "bg-black/25"
                }`}
              >
                <span className="font-semibold">
                  {p.isBot ? "🤖 " : ""}
                  {p.name}
                </span>
                {p.isBot && p.aiStyle ? (
                  <span className="ml-1 text-[0.65rem] font-medium text-sky-300/90">
                    {AI_STYLES.find((s) => s.id === p.aiStyle)?.label ?? p.aiStyle}
                  </span>
                ) : null}
                <span className="ml-1 tabular-nums text-amber-200">{p.points}🐂</span>
                {game.phase === Phase.ChooseCard && !game.ended ? (
                  <span
                    className={`ml-1 ${
                      p.hasChosen ? "text-emerald-300" : "text-emerald-200/45"
                    }`}
                    title={p.hasChosen ? "Locked in" : "Still choosing"}
                  >
                    {p.hasChosen ? "✓" : "…"}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
          <span className="shrink-0 text-[0.65rem] font-medium text-amber-200/90 sm:text-xs">
            {turnLine}
            {game.tightDeck ? (
              <span className="ml-1 font-normal text-sky-300/80">· tight</span>
            ) : null}
          </span>
          {watchers.length > 0 ? (
            <span className="hidden shrink-0 text-[0.6rem] text-sky-200/75 sm:inline">
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
            className={`status-alert block w-full cursor-pointer overflow-x-auto whitespace-nowrap rounded-md border px-2 py-1.5 text-left text-[0.7rem] font-semibold leading-none sm:text-xs ${bannerTone[statusPill.tone]} ${
              statusAlert ? "status-alert--hit" : ""
            } ${logOpen ? "ring-2 ring-amber-300/50" : "hover:brightness-110"}`}
            title="Tap for table collect history"
          >
            {statusPill.text}
            <span className="ml-2 font-normal text-emerald-100/35">▾</span>
          </button>
        ) : null}
      </div>

      {/* Hits / Rules — next to logo in page header */}
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
              <ul className="max-h-[min(50vh,16rem)] space-y-1.5 overflow-y-auto text-xs sm:text-sm">
                {logItems.map((item) => (
                  <li key={item.id} className={`leading-snug ${toneClass[item.tone ?? "info"]}`}>
                    · {item.text}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-emerald-100/55">
                No rows collected yet this game. Full-row takes and “too low” picks show up here.
              </p>
            )}
            <p className="mt-2 text-[0.65rem] text-emerald-100/40">
              Who took a row · why · bull heads
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
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={onRestart}
                className="rounded-xl bg-amber-400 px-5 py-2.5 font-semibold text-slate-900 hover:bg-amber-300"
              >
                Back to lobby
              </button>
              {watchers.length > 0 ? (
                <p className="mt-2 text-xs text-sky-200/80">
                  {watchers.length} watcher{watchers.length === 1 ? "" : "s"} will join the next
                  lobby
                </p>
              ) : null}
            </div>
          ) : (
            <p className="mt-3 text-center text-sm text-emerald-100/70">
              {isSpectator
                ? "Waiting for host to open the lobby — you'll join the table for the next game."
                : "Waiting for host to return to lobby…"}
            </p>
          )}
        </div>
      ) : null}

      {/* Two-column: table rows first (main focus), played + hand right */}
      <div className="grid grid-cols-1 gap-2 sm:gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(14rem,0.9fr)] lg:items-start">
        {/* Left: table rows — primary surface */}
        <div className="felt-panel space-y-1.5 p-2.5 sm:space-y-2 sm:p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-emerald-100/80 sm:text-sm">
              Table rows
            </h2>
            {mustPickRow ? (
              <p className="text-xs font-medium text-amber-300">
                Rule: #{yourPlayed?.number ?? "?"} &lt; every row end — pick any
                row to take (fewest 🐂)
                {canSwapCard ? ", or switch card" : ""}
              </p>
            ) : null}
          </div>
          {game.rows.map((row, rowIndex) => {
            const isTarget = mustPickRow && placeMoves.some((m) => m.row === rowIndex);
            const placeOpt = placeMoves.find((m) => m.row === rowIndex);
            const rowPoints = row.reduce((s, c) => s + c.points, 0);
            return (
              <div key={rowIndex} className="flex items-center gap-1 sm:gap-1.5">
                <span className="w-4 shrink-0 text-center text-[0.65rem] text-emerald-200/60 sm:w-5 sm:text-xs">
                  {rowIndex + 1}
                </span>
                <button
                  type="button"
                  disabled={!isTarget}
                  onClick={() => {
                    if (placeOpt) onPlace(placeOpt.row, placeOpt.replace);
                  }}
                  className={`row-slot min-w-0 flex-1 text-left ${isTarget ? "row-slot--target cursor-pointer" : ""}`}
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
                <div className="flex w-10 shrink-0 flex-col items-end text-[0.6rem] leading-tight text-emerald-200/50 sm:w-11 sm:text-[0.65rem]">
                  <span>{row.length}/5</span>
                  {row.length > 0 ? <span className="tabular-nums">{rowPoints}🐂</span> : null}
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
                {game.players.map((p, i) => (
                  <div key={i} className="flex flex-col items-center gap-0.5">
                    <CardView
                      card={p.faceDownCard}
                      hidden={!!p.faceDownCard && p.faceDownCard.number === 0}
                      size="sm"
                    />
                    <span className="max-w-[3.2rem] truncate text-[0.6rem] text-emerald-100/70 sm:text-[0.65rem]">
                      {p.name}
                    </span>
                  </div>
                ))}
              </div>
              {game.phase === Phase.PlaceCard && !mustPickRow && !game.ended ? (
                <p className="mt-1.5 text-[0.7rem] text-emerald-100/70">Placing…</p>
              ) : null}
            </div>
          )}

          {/* Hand — fixed dock on mobile (cards only, no status repeat) */}
          {!game.ended && !isSpectator ? (
            <div className="hand-dock">
              <div className="hand-dock-inner">
                <div className="felt-panel p-2.5 sm:p-3 lg:shadow-none">
                  {canSwapCard && yourPlayed ? (
                    <div className="mb-2 rounded-lg border border-amber-400/40 bg-amber-950/40 px-2 py-1.5 text-xs text-amber-50">
                      <p className="font-semibold text-amber-200">
                        Official rule — lowest card
                      </p>
                      <p className="mt-0.5 text-amber-100/90">
                        #{yourPlayed.number} is smaller than every row’s last card, so it
                        can’t go on the table. You must take{" "}
                        <strong>one whole row</strong> (choose the fewest bull heads). Your
                        #{yourPlayed.number} becomes the new start of that row. Or tap another
                        hand card to play that instead (house rule).
                      </p>
                    </div>
                  ) : null}
                  <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-100/80 sm:text-sm">
                    Your hand
                    {canChoose ? (
                      <span className="font-normal normal-case tracking-normal text-amber-200/90">
                        {" "}
                        — tap a card
                      </span>
                    ) : canSwapCard ? (
                      <span className="font-normal normal-case tracking-normal text-amber-200/90">
                        {" "}
                        — tap to switch
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
