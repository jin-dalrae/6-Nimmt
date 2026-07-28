import { useCallback, useEffect, useState } from "react";
import { CardView } from "../components/CardView";
import { BOT_NAMES, runBotActionIfNeeded } from "./ai";
import {
  chooseCard,
  chooseRowToTake,
  pickPersonalCard,
  setupGame,
  startNextRound,
} from "./engine";
import type { GameState } from "./types";
import { Phase } from "./types";

export function TakeANumberApp() {
  const [name, setName] = useState(() => localStorage.getItem("sfbg-name") || "Player 1");
  const [botCount, setBotCount] = useState(3);
  const [G, setG] = useState<GameState | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [humanPlayerId] = useState("human-1");

  // Save name on change
  useEffect(() => {
    if (name) localStorage.setItem("sfbg-name", name);
  }, [name]);

  const handleStartGame = () => {
    const players: { id: string; name: string; isBot?: boolean; botStyle?: string }[] = [
      { id: humanPlayerId, name: name || "Player 1" },
    ];

    for (let i = 0; i < botCount; i++) {
      players.push({
        id: `bot-${i + 1}`,
        name: BOT_NAMES[i % BOT_NAMES.length] || `Bot ${i + 1}`,
        isBot: true,
      });
    }

    const newG = setupGame(players);
    setG(newG);
  };

  const handleChooseCard = useCallback((pIdx: number, cardNum: number) => {
    setG((prev) => (prev ? chooseCard(prev, pIdx, cardNum) : prev));
  }, []);

  const handleChooseRow = useCallback((pIdx: number, rowIdx: number) => {
    setG((prev) => (prev ? chooseRowToTake(prev, pIdx, rowIdx) : prev));
  }, []);

  const handlePickPersonal = useCallback((pIdx: number, cardNum: number) => {
    setG((prev) => (prev ? pickPersonalCard(prev, pIdx, cardNum) : prev));
  }, []);

  // Bot automation loop
  useEffect(() => {
    if (!G) return;
    if (G.phase === Phase.Ended || G.phase === Phase.BetweenRounds) return;

    const timer = setTimeout(() => {
      let current = G;
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

      if (acted) {
        setG({ ...current });
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [G]);

  if (!G) {
    return (
      <div className="mx-auto max-w-xl px-4 py-8">
        <header className="mb-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-amber-300">
            SFboardgames
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Take a Number <span className="text-amber-300">🔢</span>
          </h1>
          <p className="mt-2 text-sm text-emerald-100/70">
            Official <i>X nimmt!</i> variant — 3 rows (3, 4, 5 max) + Personal # Row!
          </p>
        </header>

        <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-6 shadow-xl backdrop-blur-md">
          <h2 className="text-lg font-bold text-amber-200">Start Solo Game vs AI</h2>
          <div className="mt-4 space-y-4">
            <div>
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

            <div>
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
              onClick={handleStartGame}
              className="mt-2 w-full rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 px-4 py-3 font-bold text-slate-950 shadow-lg hover:brightness-110 active:scale-[0.99]"
            >
              Start Playing
            </button>
          </div>

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
              href="/mrjack"
              className="flex items-center justify-center gap-1.5 rounded-xl border border-violet-400/50 bg-violet-500/15 px-3 py-2.5 text-xs font-semibold text-violet-100 hover:bg-violet-500/25"
            >
              Mr. Jack 🕵️
            </a>
          </div>
        </div>

        {showRules && <RulesModal onClose={() => setShowRules(false)} />}
      </div>
    );
  }

  const humanIdx = G.players.findIndex((p) => p.id === humanPlayerId);
  const humanPlayer = humanIdx !== -1 ? G.players[humanIdx] : null;

  return (
    <div className="mx-auto max-w-6xl px-3 py-4 sm:px-4 sm:py-6">
      {/* Top Header */}
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
        <div>
          <h1 className="text-xl font-bold text-white sm:text-2xl">
            Take a Number <span className="text-amber-300">🔢</span>
          </h1>
          <p className="text-xs text-emerald-100/70">
            Round {G.currentRound}/{G.options.totalRounds} ·{" "}
            {G.phase === Phase.ChooseCard && "Choose a card from your hand"}
            {G.phase === Phase.PlaceCard && "Select a row to take"}
            {G.phase === Phase.PickPersonalCard && "Pick 1 card for your personal # Row"}
            {G.phase === Phase.BetweenRounds && "Round Finished!"}
            {G.phase === Phase.Ended && "Game Over!"}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowRules(true)}
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
            onClick={() => setG(null)}
            className="rounded-full border border-white/15 px-3 py-1 text-xs hover:bg-white/5"
          >
            Quit
          </button>
        </div>
      </header>

      <div className="mb-4 rounded-2xl border border-amber-300/30 bg-slate-900/80 p-3 shadow-lg backdrop-blur-md">
        <div className="mb-1.5 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-amber-300/90">
          <span>🏆 Scoreboard & Round {G.currentRound} Standings</span>
          <span className="text-[0.65rem] text-emerald-100/60 font-normal normal-case">
            (Goal: Fewest Penalty Points)
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {G.players.map((p) => {
            const handBulls = p.hand.reduce((sum, c) => sum + c.points, 0);
            const pileBulls = p.personalPile.reduce((sum, c) => sum + c.points, 0);
            const liveRoundPenalty = handBulls * 1 + pileBulls * 2;
            const totalScore = p.score + liveRoundPenalty;

            return (
              <div
                key={p.id}
                className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs transition ${
                  p.id === humanPlayerId
                    ? "border-amber-400 bg-amber-400/20 text-amber-100 font-bold ring-2 ring-amber-400/40"
                    : "border-white/10 bg-black/40 text-emerald-100/90 font-medium"
                }`}
              >
                <span>{p.isBot ? "🤖 " : ""}{p.name}{p.id === humanPlayerId ? " (You)" : ""}:</span>
                <span className="rounded bg-amber-400/20 px-1.5 py-0.5 font-extrabold text-amber-300 tabular-nums border border-amber-400/30">
                  {totalScore} pts
                </span>
                <span className="text-[0.65rem] text-emerald-100/60">
                  (R{G.currentRound}: +{liveRoundPenalty}pts)
                </span>
                {p.faceDownCard ? (
                  <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[0.65rem] font-bold text-emerald-300">
                    Ready ✓
                  </span>
                ) : (
                  <span className="text-[0.65rem] text-emerald-200/40 italic">
                    thinking…
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-6">
        <section className="rounded-2xl border border-white/10 bg-slate-900/60 p-4 backdrop-blur-md">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-amber-300/90">
              Center Rows
            </h2>
            <div className="space-y-3">
              {G.centerRows.map((row, rIdx) => {
                const isTargetChoice =
                  G.phase === Phase.PlaceCard &&
                  G.activePlayerIndex === humanIdx &&
                  humanPlayer?.faceDownCard !== null;

                return (
                  <div
                    key={rIdx}
                    className={`flex flex-wrap items-center gap-2 rounded-xl border p-2.5 transition ${
                      isTargetChoice
                        ? "border-amber-400 bg-amber-400/10 cursor-pointer hover:bg-amber-400/20"
                        : "border-white/10 bg-black/20"
                    }`}
                    onClick={isTargetChoice ? () => handleChooseRow(humanIdx, rIdx) : undefined}
                  >
                    <div className="w-28 shrink-0">
                      <span className="text-xs font-bold text-amber-200">
                        {row.capacity}-Cards Row
                      </span>
                      <div className="text-[0.65rem] text-emerald-100/60">
                        {row.cards.length} / {row.capacity} cards max
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {row.cards.map((card, cIdx) => (
                        <CardView key={cIdx} card={card} size="sm" />
                      ))}
                    </div>

                    {isTargetChoice && (
                      <button
                        type="button"
                        className="ml-auto rounded-lg bg-amber-400 px-3 py-1 text-xs font-bold text-slate-950 shadow"
                      >
                        Take Row
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Personal # Row Choice Overlay Modal */}
          {G.phase === Phase.PickPersonalCard &&
            G.activePlayerIndex === humanIdx &&
            humanPlayer?.pendingTakenCards && (
              <div className="rounded-2xl border border-amber-400/50 bg-amber-950/80 p-4 shadow-2xl backdrop-blur-md">
                <h3 className="text-base font-bold text-amber-200">
                  Pick 1 Card for your Personal # Row (X Row)
                </h3>
                <p className="mt-1 text-xs text-amber-100/80">
                  The card you pick will go into your personal # Row (must be higher than last card).
                  The remaining cards will go into your hand!
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {humanPlayer.pendingTakenCards.map((card) => (
                    <CardView
                      key={card.number}
                      card={card}
                      selectable
                      onClick={() => handlePickPersonal(humanIdx, card.number)}
                    />
                  ))}
                </div>
              </div>
            )}

          {/* Round End / Game Over Overlay */}
          {G.phase === Phase.BetweenRounds && (
            <div className="rounded-2xl border border-amber-300/40 bg-amber-950/70 p-6 text-center shadow-xl">
              <h3 className="text-xl font-bold text-amber-200">
                Round {G.currentRound} Complete!
              </h3>
              <p className="mt-2 text-sm text-emerald-100/80">
                Scores tallied! Ready for Round {G.currentRound + 1}?
              </p>
              <button
                type="button"
                onClick={() => setG((prev) => (prev ? startNextRound(prev) : prev))}
                className="mt-4 rounded-xl bg-amber-400 px-6 py-2.5 font-bold text-slate-950 shadow hover:bg-amber-300"
              >
                Start Round {G.currentRound + 1}
              </button>
            </div>
          )}

          {G.phase === Phase.Ended && (
            <div className="rounded-2xl border border-emerald-400/40 bg-emerald-950/80 p-6 text-center shadow-xl">
              <h3 className="text-2xl font-bold text-emerald-200">🏆 Game Finished!</h3>
              <p className="mt-2 text-sm text-emerald-100/90">
                Final Winner:{" "}
                <span className="font-bold text-amber-300">
                  {[...G.players].sort((a, b) => a.score - b.score)[0]?.name}
                </span>{" "}
                with fewest penalty points!
              </p>
              <button
                type="button"
                onClick={handleStartGame}
                className="mt-4 rounded-xl bg-amber-400 px-6 py-2.5 font-bold text-slate-950 shadow hover:bg-amber-300"
              >
                Play Again
              </button>
            </div>
          )}

          {/* Players status & Personal Rows / Piles */}
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {G.players.map((p, idx) => {
              const handBulls = p.hand.reduce((sum, c) => sum + c.points, 0);
              const pileBulls = p.personalPile.reduce((sum, c) => sum + c.points, 0);
              const handPts = handBulls * 1;
              const pilePts = pileBulls * 2;
              const liveRoundPts = handPts + pilePts;

              return (
                <div
                  key={p.id}
                  className={`rounded-xl border p-3 ${
                    idx === G.activePlayerIndex
                      ? "border-amber-300/80 bg-amber-400/10"
                      : "border-white/10 bg-slate-900/40"
                  }`}
                >
                  <div className="flex items-center justify-between border-b border-white/10 pb-2">
                    <span className="font-bold text-white text-sm">
                      {p.name} {p.id === humanPlayerId ? "(You)" : ""}
                    </span>
                    <div className="text-right">
                      <div className="text-xs font-bold text-amber-300">
                        Total: {p.score + liveRoundPts} pts
                      </div>
                      <div className="text-[0.65rem] text-emerald-100/60">
                        Round {G.currentRound}: +{liveRoundPts} pts ({handBulls + pileBulls} 🐂)
                      </div>
                    </div>
                  </div>

                  <div className="mt-2 flex items-center justify-between text-[0.7rem] text-emerald-100/70">
                    <span>Hand Cards: {p.hand.length} (+{handPts} pts)</span>
                    <span>Status: {p.faceDownCard ? "✓ Card Selected" : "Choosing..."}</span>
                  </div>

                  <div className="mt-2 border-t border-white/10 pt-2">
                    <div className="text-[0.65rem] font-semibold text-amber-200/90 mb-1">
                      Personal # Row (0pt Safe):
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      {p.personalRow.length > 0 ? (
                        p.personalRow.map((c) => (
                          <CardView key={c.number} card={c} size="sm" />
                        ))
                      ) : (
                        <span className="text-[0.65rem] text-emerald-100/40">Empty</span>
                      )}
                    </div>
                  </div>

                  <div className="mt-2 border-t border-rose-500/20 pt-2">
                    <div className="flex items-center justify-between text-[0.65rem] font-semibold text-rose-300 mb-1">
                      <span># Pile (2x Penalty):</span>
                      <span className="font-bold text-rose-300">
                        +{pilePts} pts ({pileBulls} 🐂 × 2)
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      {p.personalPile.length > 0 ? (
                        p.personalPile.map((c, i) => (
                          <CardView key={`${c.number}-${i}`} card={c} size="sm" hot />
                        ))
                      ) : (
                        <span className="text-[0.65rem] text-emerald-100/40">None (0 penalty)</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </section>

          {humanPlayer && (
            <section className="rounded-2xl border border-white/10 bg-slate-900/80 p-3 sm:p-4 backdrop-blur-md shadow-2xl">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-xs sm:text-sm font-semibold uppercase tracking-wider text-amber-300/90 flex items-center gap-2">
                  <span>Your Hand</span>
                  <span className="text-xs font-normal normal-case text-emerald-100/60">
                    ({humanPlayer.hand.length} cards)
                  </span>
                </h2>
                {G.phase === Phase.ChooseCard && !humanPlayer.faceDownCard && (
                  <span className="text-xs font-semibold text-amber-200">
                    Tap a card to play
                  </span>
                )}
                {humanPlayer.faceDownCard && (
                  <span className="text-xs font-semibold text-emerald-300">
                    Selected Card: #{humanPlayer.faceDownCard.number} ({humanPlayer.faceDownCard.points} 🐂)
                  </span>
                )}
              </div>

              <div className="hand-scroll flex items-end gap-2 overflow-x-auto pb-1 pt-2">
                {humanPlayer.hand.map((card) => {
                  const isChosen = humanPlayer.faceDownCard?.number === card.number;
                  return (
                    <CardView
                      key={card.number}
                      card={card}
                      selected={isChosen}
                      selectable={G.phase === Phase.ChooseCard && !humanPlayer.faceDownCard}
                      onClick={() => handleChooseCard(humanIdx, card.number)}
                    />
                  );
                })}
              </div>
            </section>
          )}

          <section className="rounded-2xl border border-white/10 bg-black/40 p-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-emerald-100/50">
              Game Log
            </h3>
            <div className="max-h-32 overflow-y-auto space-y-1 font-mono text-[0.7rem] text-emerald-100/70">
              {G.log.slice(-10).map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          </section>
        </div>

      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
    </div>
  );
}

function RulesModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-amber-300/30 bg-slate-900 p-6 shadow-2xl text-white">
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
            <strong className="text-amber-200">Objective:</strong> Score the fewest penalty points over 2 rounds!
          </p>

          <p>
            <strong className="text-amber-200">1. Center Rows:</strong> There are 3 center rows with limits of <strong>3, 4, and 5 cards</strong>. Cards must be placed in ascending order with least difference.
          </p>

          <p>
            <strong className="text-amber-200">2. Taking a Row:</strong> When your card reaches a row's limit (e.g. 3rd card in a row of limit 3) or your card is lower than all rows, you must take all cards in that row!
          </p>

          <p>
            <strong className="text-amber-200">3. Personal # Row (X Row):</strong> When you take cards, you pick <strong>1 card to place in your personal # Row</strong>. The remaining taken cards go into your hand!
          </p>

          <p>
            <strong className="text-amber-200">4. Ascending # Row & Overflow:</strong> Your personal # Row MUST be kept in ascending order. If your picked card fits, it is safe (0 penalty points!). If it breaks order, your entire personal # Row dumps into your face-down <strong># Pile (where penalty points are DOUBLED!)</strong>.
          </p>

          <p>
            <strong className="text-amber-200">5. Round End & Scoring:</strong> The round ends as soon as any player runs out of cards in hand. Hand cards = 1pt/bullhead. # Pile cards = 2pt/bullhead. Personal # Row = 0pt (Safe!).
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
