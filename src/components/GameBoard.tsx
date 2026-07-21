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

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      {/* Scoreboard */}
      <div className="felt-panel flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex flex-wrap gap-2">
          {game.players.map((p, i) => (
            <div
              key={i}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                p.isYou ? "bg-amber-400/20 ring-1 ring-amber-300/50" : "bg-black/25"
              }`}
            >
              <span className="font-semibold">
                {p.isBot ? "🤖 " : ""}
                {p.name}
              </span>
              <span className="ml-2 tabular-nums text-amber-200">{p.points} 🐂</span>
              {game.phase === Phase.ChooseCard && !game.ended ? (
                <span className="ml-2 text-xs text-emerald-200/70">
                  {p.hasChosen ? "✓" : "…"}
                </span>
              ) : null}
            </div>
          ))}
        </div>
        <div className="text-sm text-emerald-100/80">
          Round {game.round} · first to {game.pointsToEnd} loses race
        </div>
      </div>

      {game.ended ? (
        <div className="felt-panel p-6 text-center">
          <h2 className="text-2xl font-bold text-amber-300">Game over</h2>
          <p className="mt-2 text-emerald-50">
            Winner
            {game.winnerIndexes.length > 1 ? "s" : ""}:{" "}
            {game.winnerIndexes.map((i) => game.players[i].name).join(", ")}
            {" "}
            with the fewest bull heads.
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

      {/* Rows */}
      <div className="felt-panel space-y-3 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-emerald-100/80">
            Table rows
          </h2>
          {mustPickRow ? (
            <p className="text-sm font-medium text-amber-300">
              Your card is too low — pick a row to take!
            </p>
          ) : null}
        </div>
        {game.rows.map((row, rowIndex) => {
          const isTarget = mustPickRow && placeMoves.some((m) => m.row === rowIndex);
          const placeOpt = placeMoves.find((m) => m.row === rowIndex);
          return (
            <div key={rowIndex} className="flex items-center gap-2">
              <span className="w-6 shrink-0 text-center text-xs text-emerald-200/60">
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
                    className="h-[4.4rem] w-[3.1rem] rounded-lg border border-dashed border-white/10"
                  />
                ))}
              </button>
              <span className="w-10 shrink-0 text-right text-xs text-emerald-200/50">
                {row.length}/5
              </span>
            </div>
          );
        })}
      </div>

      {/* Played / face-down area */}
      <div className="felt-panel p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-emerald-100/80">
          {game.phase === Phase.PlaceCard ? "Cards this trick (low → high)" : "Played"}
        </h2>
        <div className="flex flex-wrap gap-3">
          {game.players.map((p, i) => (
            <div key={i} className="flex flex-col items-center gap-1">
              <CardView
                card={p.faceDownCard}
                hidden={!!p.faceDownCard && p.faceDownCard.number === 0}
                size="sm"
              />
              <span className="max-w-[4rem] truncate text-xs text-emerald-100/70">{p.name}</span>
            </div>
          ))}
        </div>
        {waitingChoose ? (
          <p className="mt-3 text-sm text-emerald-100/70">Waiting for others to pick a card…</p>
        ) : null}
        {game.phase === Phase.PlaceCard && !mustPickRow && !game.ended ? (
          <p className="mt-3 text-sm text-emerald-100/70">Placing cards on the table…</p>
        ) : null}
      </div>

      {/* Hand */}
      {!game.ended ? (
        <div className="felt-panel p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-emerald-100/80">
            Your hand {canChoose ? "— tap a card to play" : ""}
          </h2>
          <div className="flex flex-wrap justify-center gap-2 pb-2">
            {(you?.hand ?? [])
              .slice()
              .sort((a, b) => a.number - b.number)
              .map((card) => (
                <CardView
                  key={card.number}
                  card={card}
                  selectable={canChoose}
                  onClick={() => onChoose(card.number)}
                />
              ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
