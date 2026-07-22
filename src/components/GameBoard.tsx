import { getPointsRule } from "../game/card";
import { MoveName, Phase, type PublicGameState } from "../game/types";
import { CardView } from "./CardView";

type Props = {
  game: PublicGameState;
  isHost: boolean;
  onChoose: (cardNumber: number) => void;
  onPlace: (row: number, replace: boolean) => void;
  onRestart: () => void;
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

  // Red-border cards (5+ bull heads) currently visible — for rule hints
  const hotCards = [
    ...game.rows.flat(),
    ...(you?.hand ?? []),
    ...game.players
      .map((p) => p.faceDownCard)
      .filter((c): c is NonNullable<typeof c> => !!c && c.number > 0),
  ].filter((c) => c.points >= 5);

  const uniqueHot = Array.from(new Map(hotCards.map((c) => [c.number, c])).values()).sort(
    (a, b) => a.number - b.number,
  );

  const sortedHand = (you?.hand ?? []).slice().sort((a, b) => a.number - b.number);

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
                <span className="ml-1.5 text-xs text-emerald-200/70 sm:ml-2">
                  {p.hasChosen ? "✓" : "…"}
                </span>
              ) : null}
            </div>
          ))}
        </div>
        <div className="shrink-0 text-xs text-emerald-100/80 sm:text-sm">
          Round {game.round} · first to {game.pointsToEnd} loses race
        </div>
      </div>

      {game.ended ? (
        <div className="felt-panel p-5 text-center sm:p-6">
          <h2 className="text-2xl font-bold text-amber-300">Game over</h2>
          <p className="mt-2 text-emerald-50">
            Winner
            {game.winnerIndexes.length > 1 ? "s" : ""}:{" "}
            {game.winnerIndexes.map((i) => game.players[i].name).join(", ")} with the fewest bull
            heads.
          </p>
          {isHost ? (
            <button
              type="button"
              onClick={onRestart}
              className="mt-4 rounded-xl bg-amber-400 px-5 py-2.5 font-semibold text-slate-900 hover:bg-amber-300"
            >
              Back to lobby
            </button>
          ) : (
            <p className="mt-3 text-sm text-emerald-100/70">Waiting for host to return to lobby…</p>
          )}
        </div>
      ) : null}

      {/* Collapsible bull-head rules — closed by default to free mobile space */}
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

      {uniqueHot.length > 0 && !game.ended ? (
        <div className="rounded-xl border border-red-400/40 bg-red-950/40 px-3 py-2 text-xs text-red-100 sm:px-4 sm:py-2.5 sm:text-sm">
          <p className="font-semibold text-red-200">
            Red on board:{" "}
            <span className="font-normal">
              {uniqueHot.map((card, i) => {
                const info = getPointsRule(card.number);
                return (
                  <span key={card.number}>
                    {i > 0 ? " · " : ""}
                    <strong className="tabular-nums">#{card.number}</strong> = {info.points}pt (
                    {info.rule})
                  </span>
                );
              })}
            </span>
          </p>
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
                  <span>
                    {row.length}/5
                  </span>
                  {row.length > 0 ? <span className="tabular-nums">{rowPoints}🐂</span> : null}
                </div>
              </div>
            );
          })}
        </div>

        {/* Right: played cards + your hand */}
        <div className="flex flex-col gap-3 sm:gap-4 lg:sticky lg:top-4">
          <div className="felt-panel p-3 sm:p-4">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-emerald-100/80 sm:mb-3">
              {game.phase === Phase.PlaceCard ? "This trick (low → high)" : "Played"}
            </h2>
            <div className="flex flex-wrap gap-2 sm:gap-3">
              {game.players.map((p, i) => (
                <div key={i} className="flex flex-col items-center gap-1">
                  <CardView
                    card={p.faceDownCard}
                    hidden={!!p.faceDownCard && p.faceDownCard.number === 0}
                    size="sm"
                  />
                  <span className="max-w-[3.5rem] truncate text-[0.65rem] text-emerald-100/70 sm:max-w-[4rem] sm:text-xs">
                    {p.name}
                  </span>
                </div>
              ))}
            </div>
            {waitingChoose ? (
              <p className="mt-2 text-xs text-emerald-100/70 sm:mt-3 sm:text-sm">
                Waiting for others to pick a card…
              </p>
            ) : null}
            {game.phase === Phase.PlaceCard && !mustPickRow && !game.ended ? (
              <p className="mt-2 text-xs text-emerald-100/70 sm:mt-3 sm:text-sm">
                Placing cards on the table…
              </p>
            ) : null}
          </div>

          {/* Hand — sticky dock on mobile */}
          {!game.ended ? (
            <div className="hand-dock">
              <div className="hand-dock-inner felt-panel p-3 sm:p-4 lg:shadow-none">
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
          ) : null}
        </div>
      </div>
    </div>
  );
}
