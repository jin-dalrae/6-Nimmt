/**
 * Durable analytics for nimmt6 — D1 event + game log.
 * Best-effort: failures never break gameplay.
 */

export type StatsEventName =
  | "room_visit"
  | "player_join"
  | "player_rejoin"
  | "spectator_join"
  | "player_leave"
  | "player_disconnect"
  | "game_start"
  | "game_end"
  | "game_abandon"
  | "bot_add"
  | "bot_remove"
  | "ai_style"
  | "tight_deck"
  | "row_take"
  | "card_swap";

export type LogEventInput = {
  event: StatsEventName;
  roomId: string;
  playerName?: string | null;
  playerId?: string | null;
  role?: "player" | "spectator" | "bot" | "system" | null;
  game?: string;
  gameId?: string | null;
  meta?: Record<string, unknown> | null;
};

export type GameStartInput = {
  gameId: string;
  roomId: string;
  humanCount: number;
  botCount: number;
  playerCount: number;
  tightDeck: boolean;
  aiStyle: string;
  hostName: string | null;
  playerNames: string[];
  meta?: Record<string, unknown>;
};

export type GameEndInput = {
  gameId: string;
  roomId: string;
  status: "ended" | "abandoned";
  winnerNames: string[];
  loserNames: string[];
  scores: Array<{ name: string; points: number; isBot?: boolean }>;
  deals: number;
  durationMs: number;
  meta?: Record<string, unknown>;
};

function safeJson(v: unknown): string | null {
  if (v == null) return null;
  try {
    return JSON.stringify(v);
  } catch {
    return null;
  }
}

export async function logEvent(
  db: D1Database | undefined,
  input: LogEventInput,
): Promise<void> {
  if (!db) return;
  try {
    await db
      .prepare(
        `INSERT INTO events (event, room_id, player_name, player_id, role, game, meta_json, game_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.event,
        input.roomId.toUpperCase().slice(0, 8),
        input.playerName?.slice(0, 40) ?? null,
        input.playerId?.slice(0, 64) ?? null,
        input.role ?? null,
        input.game ?? "6nimmt",
        safeJson(input.meta ?? null),
        input.gameId ?? null,
      )
      .run();
  } catch (e) {
    console.warn("stats logEvent failed", e);
  }
}

export async function logGameStart(
  db: D1Database | undefined,
  input: GameStartInput,
): Promise<void> {
  if (!db) return;
  try {
    await db
      .prepare(
        `INSERT INTO games (
          game_id, room_id, started_at, status, human_count, bot_count, player_count,
          tight_deck, ai_style, host_name, player_names_json, meta_json
        ) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'playing', ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(game_id) DO UPDATE SET
          started_at = excluded.started_at,
          status = 'playing',
          human_count = excluded.human_count,
          bot_count = excluded.bot_count,
          player_count = excluded.player_count,
          tight_deck = excluded.tight_deck,
          ai_style = excluded.ai_style,
          host_name = excluded.host_name,
          player_names_json = excluded.player_names_json,
          meta_json = excluded.meta_json`,
      )
      .bind(
        input.gameId,
        input.roomId.toUpperCase().slice(0, 8),
        input.humanCount,
        input.botCount,
        input.playerCount,
        input.tightDeck ? 1 : 0,
        input.aiStyle,
        input.hostName,
        safeJson(input.playerNames),
        safeJson(input.meta ?? null),
      )
      .run();

    await logEvent(db, {
      event: "game_start",
      roomId: input.roomId,
      playerName: input.hostName,
      role: "system",
      gameId: input.gameId,
      meta: {
        humanCount: input.humanCount,
        botCount: input.botCount,
        playerCount: input.playerCount,
        tightDeck: input.tightDeck,
        aiStyle: input.aiStyle,
        players: input.playerNames,
      },
    });
  } catch (e) {
    console.warn("stats logGameStart failed", e);
  }
}

export async function logGameEnd(
  db: D1Database | undefined,
  input: GameEndInput,
): Promise<void> {
  if (!db) return;
  try {
    await db
      .prepare(
        `UPDATE games SET
          ended_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
          status = ?,
          winner_names_json = ?,
          loser_names_json = ?,
          scores_json = ?,
          deals = ?,
          duration_ms = ?,
          meta_json = COALESCE(?, meta_json)
        WHERE game_id = ?`,
      )
      .bind(
        input.status,
        safeJson(input.winnerNames),
        safeJson(input.loserNames),
        safeJson(input.scores),
        input.deals,
        input.durationMs,
        safeJson(input.meta ?? null),
        input.gameId,
      )
      .run();

    await logEvent(db, {
      event: input.status === "abandoned" ? "game_abandon" : "game_end",
      roomId: input.roomId,
      role: "system",
      gameId: input.gameId,
      meta: {
        winners: input.winnerNames,
        losers: input.loserNames,
        scores: input.scores,
        deals: input.deals,
        durationMs: input.durationMs,
      },
    });
  } catch (e) {
    console.warn("stats logGameEnd failed", e);
  }
}

export type StatsPayload = {
  generatedAt: string;
  summary: {
    totalEvents: number;
    totalGames: number;
    gamesFinished: number;
    gamesAbandoned: number;
    gamesPlaying: number;
    uniquePlayers: number;
    uniqueRooms: number;
    totalJoins: number;
    totalSpectatorJoins: number;
    totalRowTakes: number;
    totalCardSwaps: number;
    avgGameDurationMs: number | null;
    avgHumansPerGame: number | null;
    avgBotsPerGame: number | null;
  };
  last24h: {
    events: number;
    joins: number;
    gamesStarted: number;
    gamesEnded: number;
    uniquePlayers: number;
  };
  last7d: {
    events: number;
    joins: number;
    gamesStarted: number;
    gamesEnded: number;
    uniquePlayers: number;
  };
  recentEvents: Array<{
    id: number;
    ts: string;
    event: string;
    roomId: string;
    playerName: string | null;
    role: string | null;
    gameId: string | null;
    meta: unknown;
  }>;
  recentGames: Array<{
    gameId: string;
    roomId: string;
    startedAt: string;
    endedAt: string | null;
    status: string;
    humanCount: number;
    botCount: number;
    playerCount: number;
    tightDeck: boolean;
    aiStyle: string | null;
    hostName: string | null;
    players: string[];
    winners: string[];
    losers: string[];
    scores: Array<{ name: string; points: number; isBot?: boolean }>;
    deals: number | null;
    durationMs: number | null;
  }>;
  topPlayers: Array<{
    name: string;
    joins: number;
    gamesPlayed: number;
    wins: number;
    lossesAsHighest: number;
    lastSeen: string | null;
  }>;
  busiestRooms: Array<{
    roomId: string;
    events: number;
    games: number;
    lastActivity: string | null;
  }>;
  activityByHourUtc: Array<{ hour: number; events: number }>;
  activityByDay: Array<{ day: string; events: number; games: number }>;
  eventBreakdown: Array<{ event: string; count: number }>;
  aiStyleUsage: Array<{ style: string; games: number }>;
  deckModeUsage: { tight: number; full: number };
};

function parseJsonArray(s: string | null): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function parseJsonScores(
  s: string | null,
): Array<{ name: string; points: number; isBot?: boolean }> {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    if (!Array.isArray(v)) return [];
    return v.map((x) => ({
      name: String((x as { name?: string }).name ?? "?"),
      points: Number((x as { points?: number }).points ?? 0),
      isBot: Boolean((x as { isBot?: boolean }).isBot),
    }));
  } catch {
    return [];
  }
}

export async function buildStatsPayload(
  db: D1Database | undefined,
): Promise<StatsPayload> {
  const empty: StatsPayload = {
    generatedAt: new Date().toISOString(),
    summary: {
      totalEvents: 0,
      totalGames: 0,
      gamesFinished: 0,
      gamesAbandoned: 0,
      gamesPlaying: 0,
      uniquePlayers: 0,
      uniqueRooms: 0,
      totalJoins: 0,
      totalSpectatorJoins: 0,
      totalRowTakes: 0,
      totalCardSwaps: 0,
      avgGameDurationMs: null,
      avgHumansPerGame: null,
      avgBotsPerGame: null,
    },
    last24h: {
      events: 0,
      joins: 0,
      gamesStarted: 0,
      gamesEnded: 0,
      uniquePlayers: 0,
    },
    last7d: {
      events: 0,
      joins: 0,
      gamesStarted: 0,
      gamesEnded: 0,
      uniquePlayers: 0,
    },
    recentEvents: [],
    recentGames: [],
    topPlayers: [],
    busiestRooms: [],
    activityByHourUtc: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      events: 0,
    })),
    activityByDay: [],
    eventBreakdown: [],
    aiStyleUsage: [],
    deckModeUsage: { tight: 0, full: 0 },
  };

  if (!db) return empty;

  try {
    const [
      summaryRow,
      last24,
      last7,
      recentEvents,
      recentGames,
      eventBreakdown,
      byHour,
      byDay,
      joinsByPlayer,
      wins,
      losses,
      rooms,
      aiStyles,
      deckModes,
      gamesPlayed,
    ] = await Promise.all([
      db
        .prepare(
          `SELECT
            (SELECT COUNT(*) FROM events) AS totalEvents,
            (SELECT COUNT(*) FROM games) AS totalGames,
            (SELECT COUNT(*) FROM games WHERE status = 'ended') AS gamesFinished,
            (SELECT COUNT(*) FROM games WHERE status = 'abandoned') AS gamesAbandoned,
            (SELECT COUNT(*) FROM games WHERE status = 'playing') AS gamesPlaying,
            (SELECT COUNT(DISTINCT lower(player_name)) FROM events WHERE player_name IS NOT NULL AND player_name != '') AS uniquePlayers,
            (SELECT COUNT(DISTINCT room_id) FROM events) AS uniqueRooms,
            (SELECT COUNT(*) FROM events WHERE event IN ('player_join','player_rejoin')) AS totalJoins,
            (SELECT COUNT(*) FROM events WHERE event = 'spectator_join') AS totalSpectatorJoins,
            (SELECT COUNT(*) FROM events WHERE event = 'row_take') AS totalRowTakes,
            (SELECT COUNT(*) FROM events WHERE event = 'card_swap') AS totalCardSwaps,
            (SELECT AVG(duration_ms) FROM games WHERE duration_ms IS NOT NULL AND status = 'ended') AS avgDuration,
            (SELECT AVG(human_count) FROM games) AS avgHumans,
            (SELECT AVG(bot_count) FROM games) AS avgBots`,
        )
        .first<{
          totalEvents: number;
          totalGames: number;
          gamesFinished: number;
          gamesAbandoned: number;
          gamesPlaying: number;
          uniquePlayers: number;
          uniqueRooms: number;
          totalJoins: number;
          totalSpectatorJoins: number;
          totalRowTakes: number;
          totalCardSwaps: number;
          avgDuration: number | null;
          avgHumans: number | null;
          avgBots: number | null;
        }>(),
      db
        .prepare(
          `SELECT
            (SELECT COUNT(*) FROM events WHERE ts >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')) AS events,
            (SELECT COUNT(*) FROM events WHERE event IN ('player_join','player_rejoin') AND ts >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')) AS joins,
            (SELECT COUNT(*) FROM events WHERE event = 'game_start' AND ts >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')) AS gamesStarted,
            (SELECT COUNT(*) FROM events WHERE event IN ('game_end','game_abandon') AND ts >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')) AS gamesEnded,
            (SELECT COUNT(DISTINCT lower(player_name)) FROM events WHERE player_name IS NOT NULL AND ts >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')) AS uniquePlayers`,
        )
        .first<{
          events: number;
          joins: number;
          gamesStarted: number;
          gamesEnded: number;
          uniquePlayers: number;
        }>(),
      db
        .prepare(
          `SELECT
            (SELECT COUNT(*) FROM events WHERE ts >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 day')) AS events,
            (SELECT COUNT(*) FROM events WHERE event IN ('player_join','player_rejoin') AND ts >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 day')) AS joins,
            (SELECT COUNT(*) FROM events WHERE event = 'game_start' AND ts >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 day')) AS gamesStarted,
            (SELECT COUNT(*) FROM events WHERE event IN ('game_end','game_abandon') AND ts >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 day')) AS gamesEnded,
            (SELECT COUNT(DISTINCT lower(player_name)) FROM events WHERE player_name IS NOT NULL AND ts >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 day')) AS uniquePlayers`,
        )
        .first<{
          events: number;
          joins: number;
          gamesStarted: number;
          gamesEnded: number;
          uniquePlayers: number;
        }>(),
      db
        .prepare(
          `SELECT id, ts, event, room_id AS roomId, player_name AS playerName, role, game_id AS gameId, meta_json AS metaJson
           FROM events ORDER BY id DESC LIMIT 80`,
        )
        .all<{
          id: number;
          ts: string;
          event: string;
          roomId: string;
          playerName: string | null;
          role: string | null;
          gameId: string | null;
          metaJson: string | null;
        }>(),
      db
        .prepare(
          `SELECT game_id, room_id, started_at, ended_at, status, human_count, bot_count, player_count,
                  tight_deck, ai_style, host_name, player_names_json, winner_names_json, loser_names_json,
                  scores_json, deals, duration_ms
           FROM games ORDER BY started_at DESC LIMIT 40`,
        )
        .all<{
          game_id: string;
          room_id: string;
          started_at: string;
          ended_at: string | null;
          status: string;
          human_count: number;
          bot_count: number;
          player_count: number;
          tight_deck: number;
          ai_style: string | null;
          host_name: string | null;
          player_names_json: string | null;
          winner_names_json: string | null;
          loser_names_json: string | null;
          scores_json: string | null;
          deals: number | null;
          duration_ms: number | null;
        }>(),
      db
        .prepare(
          `SELECT event, COUNT(*) AS count FROM events GROUP BY event ORDER BY count DESC`,
        )
        .all<{ event: string; count: number }>(),
      db
        .prepare(
          `SELECT CAST(strftime('%H', ts) AS INTEGER) AS hour, COUNT(*) AS events
           FROM events GROUP BY hour ORDER BY hour`,
        )
        .all<{ hour: number; events: number }>(),
      db
        .prepare(
          `SELECT substr(ts, 1, 10) AS day,
                  COUNT(*) AS events,
                  SUM(CASE WHEN event = 'game_start' THEN 1 ELSE 0 END) AS games
           FROM events
           WHERE ts >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 day')
           GROUP BY day ORDER BY day DESC`,
        )
        .all<{ day: string; events: number; games: number }>(),
      db
        .prepare(
          `SELECT player_name AS name, COUNT(*) AS joins, MAX(ts) AS lastSeen
           FROM events
           WHERE event IN ('player_join','player_rejoin','spectator_join')
             AND player_name IS NOT NULL AND player_name != ''
           GROUP BY lower(player_name)
           ORDER BY joins DESC
           LIMIT 40`,
        )
        .all<{ name: string; joins: number; lastSeen: string }>(),
      db
        .prepare(
          `SELECT j.value AS name, COUNT(*) AS wins
           FROM games g, json_each(g.winner_names_json) j
           WHERE g.status = 'ended' AND g.winner_names_json IS NOT NULL
           GROUP BY lower(j.value)
           ORDER BY wins DESC
           LIMIT 40`,
        )
        .all<{ name: string; wins: number }>()
        .catch(() => ({ results: [] as Array<{ name: string; wins: number }> })),
      db
        .prepare(
          `SELECT j.value AS name, COUNT(*) AS losses
           FROM games g, json_each(g.loser_names_json) j
           WHERE g.status = 'ended' AND g.loser_names_json IS NOT NULL
           GROUP BY lower(j.value)
           ORDER BY losses DESC
           LIMIT 40`,
        )
        .all<{ name: string; losses: number }>()
        .catch(() => ({ results: [] as Array<{ name: string; losses: number }> })),
      db
        .prepare(
          `SELECT room_id AS roomId, COUNT(*) AS events, MAX(ts) AS lastActivity,
                  (SELECT COUNT(*) FROM games g WHERE g.room_id = e.room_id) AS games
           FROM events e
           GROUP BY room_id
           ORDER BY events DESC
           LIMIT 25`,
        )
        .all<{
          roomId: string;
          events: number;
          lastActivity: string;
          games: number;
        }>(),
      db
        .prepare(
          `SELECT COALESCE(ai_style, 'unknown') AS style, COUNT(*) AS games
           FROM games GROUP BY ai_style ORDER BY games DESC`,
        )
        .all<{ style: string; games: number }>(),
      db
        .prepare(
          `SELECT
             SUM(CASE WHEN tight_deck = 1 THEN 1 ELSE 0 END) AS tight,
             SUM(CASE WHEN tight_deck = 0 THEN 1 ELSE 0 END) AS full
           FROM games`,
        )
        .first<{ tight: number | null; full: number | null }>(),
      db
        .prepare(
          `SELECT j.value AS name, COUNT(*) AS gamesPlayed
           FROM games g, json_each(g.player_names_json) j
           WHERE g.player_names_json IS NOT NULL
           GROUP BY lower(j.value)
           ORDER BY gamesPlayed DESC
           LIMIT 40`,
        )
        .all<{ name: string; gamesPlayed: number }>()
        .catch(() => ({
          results: [] as Array<{ name: string; gamesPlayed: number }>,
        })),
    ]);

    const hourMap = new Map(
      (byHour.results ?? []).map((r) => [Number(r.hour), Number(r.events)]),
    );
    const winMap = new Map(
      (wins.results ?? []).map((r) => [r.name.toLowerCase(), Number(r.wins)]),
    );
    const lossMap = new Map(
      (losses.results ?? []).map((r) => [r.name.toLowerCase(), Number(r.losses)]),
    );
    const playedMap = new Map(
      (gamesPlayed.results ?? []).map((r) => [
        r.name.toLowerCase(),
        Number(r.gamesPlayed),
      ]),
    );

    const topPlayers = (joinsByPlayer.results ?? []).map((p) => {
      const key = p.name.toLowerCase();
      return {
        name: p.name,
        joins: Number(p.joins),
        gamesPlayed: playedMap.get(key) ?? 0,
        wins: winMap.get(key) ?? 0,
        lossesAsHighest: lossMap.get(key) ?? 0,
        lastSeen: p.lastSeen ?? null,
      };
    });

    return {
      generatedAt: new Date().toISOString(),
      summary: {
        totalEvents: Number(summaryRow?.totalEvents ?? 0),
        totalGames: Number(summaryRow?.totalGames ?? 0),
        gamesFinished: Number(summaryRow?.gamesFinished ?? 0),
        gamesAbandoned: Number(summaryRow?.gamesAbandoned ?? 0),
        gamesPlaying: Number(summaryRow?.gamesPlaying ?? 0),
        uniquePlayers: Number(summaryRow?.uniquePlayers ?? 0),
        uniqueRooms: Number(summaryRow?.uniqueRooms ?? 0),
        totalJoins: Number(summaryRow?.totalJoins ?? 0),
        totalSpectatorJoins: Number(summaryRow?.totalSpectatorJoins ?? 0),
        totalRowTakes: Number(summaryRow?.totalRowTakes ?? 0),
        totalCardSwaps: Number(summaryRow?.totalCardSwaps ?? 0),
        avgGameDurationMs:
          summaryRow?.avgDuration != null
            ? Math.round(Number(summaryRow.avgDuration))
            : null,
        avgHumansPerGame:
          summaryRow?.avgHumans != null
            ? Math.round(Number(summaryRow.avgHumans) * 10) / 10
            : null,
        avgBotsPerGame:
          summaryRow?.avgBots != null
            ? Math.round(Number(summaryRow.avgBots) * 10) / 10
            : null,
      },
      last24h: {
        events: Number(last24?.events ?? 0),
        joins: Number(last24?.joins ?? 0),
        gamesStarted: Number(last24?.gamesStarted ?? 0),
        gamesEnded: Number(last24?.gamesEnded ?? 0),
        uniquePlayers: Number(last24?.uniquePlayers ?? 0),
      },
      last7d: {
        events: Number(last7?.events ?? 0),
        joins: Number(last7?.joins ?? 0),
        gamesStarted: Number(last7?.gamesStarted ?? 0),
        gamesEnded: Number(last7?.gamesEnded ?? 0),
        uniquePlayers: Number(last7?.uniquePlayers ?? 0),
      },
      recentEvents: (recentEvents.results ?? []).map((e) => ({
        id: e.id,
        ts: e.ts,
        event: e.event,
        roomId: e.roomId,
        playerName: e.playerName,
        role: e.role,
        gameId: e.gameId,
        meta: e.metaJson
          ? (() => {
              try {
                return JSON.parse(e.metaJson);
              } catch {
                return e.metaJson;
              }
            })()
          : null,
      })),
      recentGames: (recentGames.results ?? []).map((g) => ({
        gameId: g.game_id,
        roomId: g.room_id,
        startedAt: g.started_at,
        endedAt: g.ended_at,
        status: g.status,
        humanCount: g.human_count,
        botCount: g.bot_count,
        playerCount: g.player_count,
        tightDeck: Boolean(g.tight_deck),
        aiStyle: g.ai_style,
        hostName: g.host_name,
        players: parseJsonArray(g.player_names_json),
        winners: parseJsonArray(g.winner_names_json),
        losers: parseJsonArray(g.loser_names_json),
        scores: parseJsonScores(g.scores_json),
        deals: g.deals,
        durationMs: g.duration_ms,
      })),
      topPlayers,
      busiestRooms: (rooms.results ?? []).map((r) => ({
        roomId: r.roomId,
        events: Number(r.events),
        games: Number(r.games),
        lastActivity: r.lastActivity,
      })),
      activityByHourUtc: Array.from({ length: 24 }, (_, hour) => ({
        hour,
        events: hourMap.get(hour) ?? 0,
      })),
      activityByDay: (byDay.results ?? []).map((d) => ({
        day: d.day,
        events: Number(d.events),
        games: Number(d.games),
      })),
      eventBreakdown: (eventBreakdown.results ?? []).map((e) => ({
        event: e.event,
        count: Number(e.count),
      })),
      aiStyleUsage: (aiStyles.results ?? []).map((a) => ({
        style: a.style,
        games: Number(a.games),
      })),
      deckModeUsage: {
        tight: Number(deckModes?.tight ?? 0),
        full: Number(deckModes?.full ?? 0),
      },
    };
  } catch (e) {
    console.warn("buildStatsPayload failed", e);
    return empty;
  }
}
