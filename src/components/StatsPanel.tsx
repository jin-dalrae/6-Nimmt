import { useCallback, useEffect, useState } from "react";
import type { StatsPayload } from "../game/stats";

function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return `${m}m ${r}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function eventLabel(e: string): string {
  return e.replace(/_/g, " ");
}

const emptyHour = Array.from({ length: 24 }, (_, hour) => ({ hour, events: 0 }));

export function StatsPanel() {
  const [data, setData] = useState<StatsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/stats", { cache: "no-store" });
      if (!res.ok) throw new Error(`Stats HTTP ${res.status}`);
      const json = (await res.json()) as StatsPayload;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load stats");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void load();
    const t = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(t);
  }, [open, load]);

  const s = data?.summary;
  const maxHour = Math.max(
    1,
    ...(data?.activityByHourUtc ?? emptyHour).map((h) => h.events),
  );

  return (
    <div className="mt-6 border-t border-white/10 pt-5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-emerald-100/80">
          Site statistics
        </h2>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-white/15 hover:bg-white/10"
        >
          {open ? "Hide" : "Show"}
        </button>
      </div>

      {!open ? (
        <p className="text-xs text-emerald-100/50">
          Who joined, games played, rooms, takes — tap Show.
        </p>
      ) : loading && !data ? (
        <p className="text-xs text-emerald-100/50">Loading stats…</p>
      ) : error && !data ? (
        <p className="text-xs text-red-300">{error}</p>
      ) : data ? (
        <div className="space-y-4 text-xs sm:text-sm">
          <div className="flex flex-wrap items-center gap-2 text-[0.65rem] text-emerald-100/45">
            <span>Updated {fmtWhen(data.generatedAt)}</span>
            <button
              type="button"
              onClick={() => void load()}
              className="underline decoration-white/20 hover:text-emerald-100/70"
            >
              Refresh
            </button>
          </div>

          {/* Summary chips */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[
              ["Games finished", s?.gamesFinished ?? 0],
              ["Games started", s?.totalGames ?? 0],
              ["Unique players", s?.uniquePlayers ?? 0],
              ["Rooms seen", s?.uniqueRooms ?? 0],
              ["Joins", s?.totalJoins ?? 0],
              ["Spectators", s?.totalSpectatorJoins ?? 0],
              ["Row takes", s?.totalRowTakes ?? 0],
              ["Card swaps", s?.totalCardSwaps ?? 0],
              ["Events logged", s?.totalEvents ?? 0],
            ].map(([label, val]) => (
              <div
                key={String(label)}
                className="rounded-lg border border-white/10 bg-black/25 px-2.5 py-2"
              >
                <p className="text-[0.65rem] text-emerald-100/50">{label}</p>
                <p className="text-lg font-semibold tabular-nums text-amber-200">{val}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-2">
              <p className="font-semibold text-emerald-100/80">Last 24 hours</p>
              <p className="mt-1 text-emerald-100/70">
                {data.last24h.joins} joins · {data.last24h.gamesStarted} games ·{" "}
                {data.last24h.uniquePlayers} players · {data.last24h.events} events
              </p>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-2">
              <p className="font-semibold text-emerald-100/80">Last 7 days</p>
              <p className="mt-1 text-emerald-100/70">
                {data.last7d.joins} joins · {data.last7d.gamesStarted} games ·{" "}
                {data.last7d.uniquePlayers} players · {data.last7d.events} events
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-2">
            <p className="font-semibold text-emerald-100/80">Averages</p>
            <p className="mt-1 text-emerald-100/70">
              Game length {fmtDuration(s?.avgGameDurationMs)} ·{" "}
              {s?.avgHumansPerGame ?? "—"} humans / {s?.avgBotsPerGame ?? "—"} bots per
              game · abandoned {s?.gamesAbandoned ?? 0} · still open{" "}
              {s?.gamesPlaying ?? 0}
            </p>
            <p className="mt-1 text-emerald-100/70">
              Deck: tight {data.deckModeUsage.tight} · full {data.deckModeUsage.full}
              {data.aiStyleUsage.length > 0
                ? ` · AI: ${data.aiStyleUsage.map((a) => `${a.style}×${a.games}`).join(", ")}`
                : null}
            </p>
          </div>

          {/* Hourly activity */}
          <div className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-2">
            <p className="mb-2 font-semibold text-emerald-100/80">
              Activity by hour (UTC)
            </p>
            <div className="flex h-16 items-end gap-0.5">
              {(data.activityByHourUtc ?? emptyHour).map((h) => (
                <div
                  key={h.hour}
                  className="min-w-0 flex-1 rounded-t bg-amber-400/70"
                  style={{
                    height: `${Math.max(4, (h.events / maxHour) * 100)}%`,
                    opacity: h.events ? 0.9 : 0.15,
                  }}
                  title={`${h.hour}:00 UTC — ${h.events} events`}
                />
              ))}
            </div>
            <p className="mt-1 text-[0.65rem] text-emerald-100/40">0 → 23 UTC</p>
          </div>

          {/* Top players */}
          <div className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-2">
            <p className="mb-2 font-semibold text-emerald-100/80">Players</p>
            {data.topPlayers.length === 0 ? (
              <p className="text-emerald-100/45">No joins logged yet.</p>
            ) : (
              <ul className="max-h-48 space-y-1.5 overflow-y-auto">
                {data.topPlayers.map((p) => (
                  <li
                    key={p.name}
                    className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 border-b border-white/5 pb-1"
                  >
                    <span className="font-medium text-amber-100">{p.name}</span>
                    <span className="tabular-nums text-emerald-100/65">
                      {p.joins} join{p.joins === 1 ? "" : "s"} · {p.gamesPlayed} game
                      {p.gamesPlayed === 1 ? "" : "s"} · {p.wins} win
                      {p.wins === 1 ? "" : "s"}
                      {p.lossesAsHighest
                        ? ` · ${p.lossesAsHighest} highest`
                        : ""}
                    </span>
                    <span className="w-full text-[0.65rem] text-emerald-100/40">
                      last {fmtWhen(p.lastSeen)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Busiest rooms */}
          <div className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-2">
            <p className="mb-2 font-semibold text-emerald-100/80">Rooms</p>
            {data.busiestRooms.length === 0 ? (
              <p className="text-emerald-100/45">No room activity yet.</p>
            ) : (
              <ul className="max-h-40 space-y-1 overflow-y-auto">
                {data.busiestRooms.map((r) => (
                  <li
                    key={r.roomId}
                    className="flex justify-between gap-2 font-mono text-emerald-100/80"
                  >
                    <span className="text-amber-300">{r.roomId}</span>
                    <span className="tabular-nums text-emerald-100/60">
                      {r.games}g · {r.events}e · {fmtWhen(r.lastActivity)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Recent games */}
          <div className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-2">
            <p className="mb-2 font-semibold text-emerald-100/80">Recent games</p>
            {data.recentGames.length === 0 ? (
              <p className="text-emerald-100/45">No games started since stats went live.</p>
            ) : (
              <ul className="max-h-56 space-y-2 overflow-y-auto">
                {data.recentGames.map((g) => (
                  <li
                    key={g.gameId}
                    className="rounded-md border border-white/5 bg-black/20 px-2 py-1.5"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-mono font-semibold text-amber-300">
                        {g.roomId}
                      </span>
                      <span className="text-emerald-100/50">{g.status}</span>
                      <span className="text-emerald-100/45">{fmtWhen(g.startedAt)}</span>
                    </div>
                    <p className="mt-0.5 text-emerald-100/75">
                      {g.players.join(", ") || "—"} · {g.humanCount}H+{g.botCount}B ·{" "}
                      {g.tightDeck ? "tight" : "full"}
                      {g.aiStyle ? ` · ${g.aiStyle}` : ""} · {fmtDuration(g.durationMs)}
                    </p>
                    {g.scores.length > 0 ? (
                      <p className="mt-0.5 tabular-nums text-emerald-100/60">
                        Scores:{" "}
                        {g.scores
                          .slice()
                          .sort((a, b) => a.points - b.points)
                          .map((sc) => `${sc.name} ${sc.points}`)
                          .join(" · ")}
                      </p>
                    ) : null}
                    {g.winners.length > 0 ? (
                      <p className="text-amber-200/90">
                        Winner{g.winners.length > 1 ? "s" : ""}: {g.winners.join(", ")}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Live event feed */}
          <div className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-2">
            <p className="mb-2 font-semibold text-emerald-100/80">Event log</p>
            {data.recentEvents.length === 0 ? (
              <p className="text-emerald-100/45">Waiting for the first join…</p>
            ) : (
              <ul className="max-h-64 space-y-1 overflow-y-auto font-mono text-[0.7rem] leading-snug">
                {data.recentEvents.map((e) => (
                  <li key={e.id} className="border-b border-white/5 pb-1 text-emerald-100/70">
                    <span className="text-emerald-100/40">{fmtWhen(e.ts)}</span>{" "}
                    <span className="text-amber-200/90">{e.roomId}</span>{" "}
                    <span className="text-sky-200/90">{eventLabel(e.event)}</span>
                    {e.playerName ? (
                      <span className="text-emerald-50"> · {e.playerName}</span>
                    ) : null}
                    {e.role ? (
                      <span className="text-emerald-100/40"> ({e.role})</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Event breakdown */}
          {data.eventBreakdown.length > 0 ? (
            <div className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-2">
              <p className="mb-2 font-semibold text-emerald-100/80">Event counts</p>
              <ul className="flex flex-wrap gap-1.5">
                {data.eventBreakdown.map((e) => (
                  <li
                    key={e.event}
                    className="rounded-full bg-white/5 px-2 py-0.5 text-[0.7rem] text-emerald-100/75"
                  >
                    {eventLabel(e.event)}{" "}
                    <span className="tabular-nums text-amber-200">{e.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="text-[0.65rem] text-emerald-100/35">
            Stats start from deploy of this feature. Display names only (no emails/IPs).
            Game: 6 Nimmt.
          </p>
        </div>
      ) : null}
    </div>
  );
}
