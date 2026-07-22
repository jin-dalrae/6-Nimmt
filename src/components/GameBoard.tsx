import { useEffect, useRef, useState } from "react";
import {
  dealLabel,
  diffActivity,
  phaseStatus,
  trickLabel,
  type ActivityItem,
} from "../game/activity";
import { MoveName, Phase, type PublicGameState } from "../game/types";
import { CardView } from "./CardView";

type Props = {
  game: PublicGameState;
  isHost: boolean;
  onChoose: (cardNumber: number) => void;
  onPlace: (row: number, replace: boolean) => void;
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

export function GameBoard({ game, isHost, onChoose, onPlace, onRestart }: Props) {
  const you = game.players[game.yourIndex];
  const placeMoves = you?.availableMoves?.[MoveName.PlaceCard] ?? [];
  const mustPickRow = placeMoves.length > 1;
  const canChoose =
    game.phase === Phase.ChooseCard &&
    !game.ended &&
    !you?.hasChosen &&
    (you?.availableMoves?.[MoveName.ChooseCard]?.length ?? 0) > 0;

  const waitingChoose =
    game.phase === Phase.ChooseCard &&
    !game.ended &&
    you?.hasChosen &&
    game.players.some((p) => !p.hasChosen);

  const readyCount = game.players.filter((p) => p.hasChosen).length;
  const status = phaseStatus(game);
  const turnLine = `${dealLabel(game)} · ${trickLabel(game)}`;

  const sortedHand = (you?.hand ?? []).slice().sort((a, b) => a.number - b.number);

  const prevGame = useRef<PublicGameState | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);

  useEffect(() => {
    const events = diffActivity(prevGame.current, game);
    prevGame.current = game;
    if (events.length === 0) return;
    setActivity((log) => [...events.reverse(), ...log].slice(0, 14));
  }, [game]);

  return (
    <div
      className={`play-shell mx-auto flex w-full max-w-7xl flex-col gap-3 sm:gap-4 ${
        !game.ended ? "play-shell--with-hand" : ""
      }`}
    >
      {/* Scoreboard — full width */}
      <div className="felt-panel flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3 sm:px-4 sm:py-3">
        <div className="score-scroll min-w-0">
          {game.players.map((p, i) => (
            <div
              key={i}
              className={`shrink-0 rounded-lg px-2.5 py-1 text-xs sm:px-3 sm:py-1.5 sm:text-sm ${
                p.isYou ? "bg-amber-400/20 ring-1 ring-amber-300/50" : "bg-black/25"
              }`}
            >
              <span className="font-semibold">
                {p.isBot ? "🤖 " : ""}
                {p.name}
              </span>
              <span className="ml-1.5 tabular-nums text-amber-200 sm:ml-2">{p.points} 🐂</span>
              {game.phase === Phase.ChooseCard && !game.ended ? (
                <span
                  className={`ml-1.5 text-xs sm:ml-2 ${
                    p.hasChosen ? "text-emerald-300" : "text-emerald-200/50"
                  }`}
                  title={p.hasChosen ? "Locked in" : "Still choosing"}
                >
                  {p.hasChosen ? "✓" : "…"}
                </span>
              ) : null}
            </div>
          ))}
        </div>
        <div className="shrink-0 text-xs font-medium text-amber-200/95 sm:text-sm">
          {turnLine}
          <span className="ml-2 font-normal text-emerald-100/60">
            · first to {game.pointsToEnd} loses race
          </span>
        </div>
      </div>

      {/* Live turn / ready status — always visible at top */}
      {!game.ended ? (
        <div
          className={`rounded-xl border px-3 py-2.5 sm:px-4 ${bannerTone[status.tone]}`}
        >
          <p className="text-sm font-semibold text-emerald-50 sm:text-base">{status.headline}</p>
          {status.detail ? (
            <p className="mt-0.5 text-xs text-emerald-50/80 sm:text-sm">{status.detail}</p>
          ) : null}
          {game.phase === Phase.ChooseCard ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {game.players.map((p, i) => (
                <span
                  key={i}
                  className={`rounded-full px-2 py-0.5 text-[0.65rem] sm:text-xs ${
                    p.hasChosen
                      ? "bg-emerald-500/25 text-emerald-100 ring-1 ring-emerald-400/40"
                      : "bg-black/30 text-emerald-100/50"
                  }`}
                >
                  {p.hasChosen ? "✓" : "…"} {p.isYou ? "You" : p.name}
                </span>
              ))}
              <span className="self-center text-[0.65rem] text-emerald-100/45 sm:text-xs">
                {readyCount}/{game.players.length} ready
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Threshold hit mid-deal — finish all cards, then score */}
      {game.thresholdReached && !game.ended ? (
        <div className="rounded-xl border border-amber-400/50 bg-amber-950/50 px-3 py-2.5 text-sm text-amber-50 sm:px-4">
          <p className="font-semibold text-amber-200">
            {game.players
              .filter((p) => p.points >= game.pointsToEnd)
              .map((p) => p.name)
              .join(", ")}{" "}
            reached {game.pointsToEnd}+ 🐂
          </p>
          <p className="mt-0.5 text-xs text-amber-100/80 sm:text-sm">
            Official rule: finish this deal (play out remaining cards), then lowest score wins —
            highest loses.
          </p>
        </div>
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
            </div>
          ) : (
            <p className="mt-3 text-center text-sm text-emerald-100/70">
              Waiting for host to return to lobby…
            </p>
          )}
        </div>
      ) : null}

      {/* What happened — activity feed */}
      {activity.length > 0 ? (
        <div className="felt-panel px-3 py-2.5 sm:px-4 sm:py-3">
          <h2 className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-emerald-100/80">
            What happened
          </h2>
          <ul className="max-h-28 space-y-1 overflow-y-auto text-xs sm:max-h-36 sm:text-sm">
            {activity.map((item) => (
              <li
                key={item.id}
                className={`leading-snug ${toneClass[item.tone ?? "info"]}`}
              >
                · {item.text}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Two-column play area: rows left, played + hand right (desktop) */}
      <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(16rem,1fr)] lg:items-start">
        {/* Left: table rows */}
        <div className="felt-panel space-y-2 p-3 sm:space-y-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-emerald-100/80">
              Table rows
            </h2>
            {mustPickRow ? (
              <p className="text-xs font-medium text-amber-300 sm:text-sm">
                Card too low — tap a row to take!
              </p>
            ) : null}
          </div>
          {game.rows.map((row, rowIndex) => {
            const isTarget = mustPickRow && placeMoves.some((m) => m.row === rowIndex);
            const placeOpt = placeMoves.find((m) => m.row === rowIndex);
            const rowPoints = row.reduce((s, c) => s + c.points, 0);
            return (
              <div key={rowIndex} className="flex items-center gap-1.5 sm:gap-2">
                <span className="w-4 shrink-0 text-center text-xs text-emerald-200/60 sm:w-6">
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
                <div className="flex w-11 shrink-0 flex-col items-end text-[0.65rem] leading-tight text-emerald-200/50 sm:w-12 sm:text-xs">
                  <span>{row.length}/5</span>
                  {row.length > 0 ? <span className="tabular-nums">{rowPoints}🐂</span> : null}
                </div>
              </div>
            );
          })}
        </div>

        {/* Right: played cards + your hand */}
        <div className="flex flex-col gap-3 sm:gap-4 lg:sticky lg:top-4">
          <div className="felt-panel p-3 sm:p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 sm:mb-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-emerald-100/80">
                {game.phase === Phase.PlaceCard ? "This trick (low → high)" : "Played"}
              </h2>
              {game.phase === Phase.ChooseCard && !game.ended ? (
                <span className="text-xs text-emerald-100/60">
                  {readyCount}/{game.players.length} locked in
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2 sm:gap-3">
              {game.players.map((p, i) => (
                <div key={i} className="flex flex-col items-center gap-1">
                  <div className="relative">
                    <CardView
                      card={p.faceDownCard}
                      hidden={!!p.faceDownCard && p.faceDownCard.number === 0}
                      size="sm"
                    />
                    {game.phase === Phase.ChooseCard && p.hasChosen ? (
                      <span className="absolute -right-1 -top-1 rounded-full bg-emerald-500 px-1 text-[0.55rem] font-bold text-slate-900">
                        ✓
                      </span>
                    ) : null}
                  </div>
                  <span className="max-w-[3.5rem] truncate text-[0.65rem] text-emerald-100/70 sm:max-w-[4rem] sm:text-xs">
                    {p.name}
                  </span>
                </div>
              ))}
            </div>
            {waitingChoose ? (
              <p className="mt-2 text-xs text-amber-200/90 sm:mt-3 sm:text-sm">
                Waiting for others to pick a card…
              </p>
            ) : null}
            {game.phase === Phase.PlaceCard && !mustPickRow && !game.ended ? (
              <p className="mt-2 text-xs text-emerald-100/70 sm:mt-3 sm:text-sm">
                Placing cards on the table…
              </p>
            ) : null}
          </div>

          {/* Hand — fixed dock on mobile; includes ready nudge so it isn't covered */}
          {!game.ended ? (
            <div className="hand-dock">
              <div className="hand-dock-inner">
                {/* Compact status above cards — always visible above the dock */}
                <div
                  className={`mb-2 rounded-xl border px-3 py-1.5 text-xs sm:text-sm lg:hidden ${bannerTone[status.tone]}`}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                    <span className="font-semibold text-amber-100">{turnLine}</span>
                    <span className="text-emerald-50/90">{status.headline}</span>
                  </div>
                  {game.phase === Phase.ChooseCard ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {game.players.map((p, i) => (
                        <span
                          key={i}
                          className={`rounded px-1.5 py-0.5 text-[0.6rem] ${
                            p.hasChosen
                              ? "bg-emerald-500/30 text-emerald-50"
                              : "bg-black/25 text-emerald-100/45"
                          }`}
                        >
                          {p.hasChosen ? "✓" : "…"}
                          {p.isYou ? "You" : p.name.split(" ")[0]}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="felt-panel p-3 sm:p-4 lg:shadow-none">
                  <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-emerald-100/80">
                    Your hand{" "}
                    {canChoose ? (
                      <span className="font-normal normal-case tracking-normal text-amber-200/90">
                        — tap to play
                      </span>
                    ) : null}
                  </h2>
                  <div className="hand-scroll justify-center sm:justify-start lg:flex-wrap lg:justify-start lg:gap-2">
                    {sortedHand.map((card) => (
                      <CardView
                        key={card.number}
                        card={card}
                        selectable={canChoose}
                        onClick={() => onChoose(card.number)}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Bull-head rules — bottom of page (scroll past hand dock) */}
      <details className="felt-panel group px-3 py-2 sm:px-4 sm:py-3">
        <summary className="cursor-pointer list-none text-sm font-semibold text-emerald-100/90 marker:content-none [&::-webkit-details-marker]:hidden">
          <span className="inline-flex items-center gap-2">
            <span className="text-emerald-200/50 transition group-open:rotate-90">▸</span>
            Bull-head scoring
            <span className="font-normal text-emerald-100/45">(tap to expand)</span>
          </span>
        </summary>
        <div className="mt-2 border-t border-white/10 pt-2 text-sm text-emerald-50/90">
          <ul className="grid gap-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
            <li>
              <span className="text-emerald-100/60">Normal cards</span> → <strong>1</strong> 🐂
            </li>
            <li>
              <span className="text-emerald-100/60">Ends in 5</span> (5, 15, 25…) →{" "}
              <strong>2</strong> 🐂
            </li>
            <li>
              <span className="text-emerald-100/60">Multiple of 10</span> (10, 20…) →{" "}
              <strong>3</strong> 🐂
            </li>
            <li className="text-red-200">
              <span className="opacity-80">Multiple of 11</span> (11, 22…) → <strong>5</strong> 🐂{" "}
              <span className="rounded border border-red-400/50 px-1 text-[0.65rem]">red</span>
            </li>
            <li className="text-red-200">
              <span className="opacity-80">Card 55 only</span> → <strong>7</strong> 🐂{" "}
              <span className="rounded border border-red-400/50 px-1 text-[0.65rem]">red</span>
            </li>
          </ul>
          <p className="mt-2 text-xs text-emerald-100/55">
            Red border = expensive (5+). Taking a row adds every card’s bull heads.
          </p>
        </div>
      </details>
    </div>
  );
}
