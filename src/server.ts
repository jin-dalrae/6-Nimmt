/**
 * SFboardgames game room — PartyServer (Durable Object) on Cloudflare Workers.
 * Real-time multiplayer rooms via WebSockets + optional Gemini bots.
 */

import { Connection, Server, routePartykitRequest } from "partyserver";
import {
  type AiStyle,
  BOT_NAMES,
  botPaceMs,
  chooseCardForBot,
  isAiStyle,
  placeRowForBot,
} from "./game/ai";
import {
  advanceAfterBetweenDeals,
  autoPlaceIfPossible,
  cloneGame,
  ended,
  isBetweenDeals,
  loserIndexes,
  move,
  setup,
  swapForcedCard,
  toPublicState,
  winnerIndexes,
} from "./game/engine";
import type { GameState } from "./game/types";
import { MoveName, Phase } from "./game/types";
import type {
  ClientMessage,
  LobbyPlayer,
  ServerMessage,
  SpectatorInfo,
} from "./game/protocol";
import {
  buildStatsPayload,
  logEvent,
  logGameEnd,
  logGameStart,
  type StatsEventName,
} from "./game/stats";

// Online Mr. Jack (2-player) — separate PartyServer DO
export { MrJackRoom } from "./mrjack/room";

export type RoomPresence = {
  roomId: string;
  status: "lobby" | "playing" | "ended";
  /** Connected humans only (AI excluded) — players + watchers */
  humans: Array<{ name: string; watching?: boolean }>;
  humanCount: number;
};

type Env = {
  GameRoom: DurableObjectNamespace<GameRoom>;
  MrJackRoom: DurableObjectNamespace;
  ASSETS?: Fetcher;
  GEMINI_API_KEY?: string;
  /** Analytics D1 — optional so local/dev without binding still runs */
  DB?: D1Database;
};

type ConnState = {
  playerId: string;
  name: string;
  role: "player" | "spectator";
};

type RoomPlayer = {
  id: string;
  name: string;
  connectionId: string | null;
  isBot: boolean;
  /** Per-bot level; falls back to room.aiStyle */
  aiStyle?: AiStyle;
  /** Opaque client secret — reclaim this seat after reconnect (humans only) */
  sessionToken?: string;
};

type Spectator = {
  id: string;
  name: string;
  connectionId: string | null;
  sessionToken?: string;
};

type RoomData = {
  status: "lobby" | "playing" | "ended";
  players: RoomPlayer[];
  /** Watching mid-game; promoted into players when back to lobby */
  spectators: Spectator[];
  hostId: string | null;
  game: GameState | null;
  seats: string[];
  aiStyle: AiStyle;
  /** Use cards 1…(10×players+4) instead of full 1–104 */
  tightDeck: boolean;
  /**
   * When the last human's socket dropped mid-game. Game is kept for a grace
   * period so idle tab / brief network drops can reconnect without wiping.
   */
  abandonedAt: number | null;
  /** Analytics id for the active/last game in this room */
  currentGameId: string | null;
  /** Wall-clock when currentGameId started */
  gameStartedAt: number | null;
  /** Between-deals break: when the next deal auto-starts */
  betweenDealsEndsAt: number | null;
  betweenDealsPaused: boolean;
  /** Remaining ms when paused (so resume continues the countdown) */
  betweenDealsRemainingMs: number | null;
};

/** Keep in-progress games alive after a disconnect (phones idle, WS blips). */
const ABANDON_GRACE_MS = 10 * 60 * 1000;
/** Standings pause after each deal before the next hand */
const BETWEEN_DEALS_MS = 3000;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const MAX_PLAYERS = 10;
const MIN_PLAYERS = 2;
const MAX_SPECTATORS = 20;

export class GameRoom extends Server<Env> {
  static options = { hibernate: true };

  room: RoomData = {
    status: "lobby",
    players: [],
    spectators: [],
    hostId: null,
    game: null,
    seats: [],
    aiStyle: "solid",
    tightDeck: true,
    abandonedAt: null,
    currentGameId: null,
    gameStartedAt: null,
    betweenDealsEndsAt: null,
    betweenDealsPaused: false,
    betweenDealsRemainingMs: null,
  };

  private botsBusy = false;
  /** Set when a human acts while bots are mid-async; triggers another runBots pass */
  private botsNeedRerun = false;

  async onStart() {
    const saved = await this.ctx.storage.get<RoomData>("room");
    if (saved) {
      // Migrate older rooms missing isBot / aiStyle / spectators / abandonedAt / game ids
      this.room = {
        ...saved,
        aiStyle: isAiStyle(saved.aiStyle) ? saved.aiStyle : "solid",
        tightDeck: typeof saved.tightDeck === "boolean" ? saved.tightDeck : true,
        spectators: Array.isArray(saved.spectators) ? saved.spectators : [],
        abandonedAt:
          typeof saved.abandonedAt === "number" ? saved.abandonedAt : null,
        currentGameId:
          typeof saved.currentGameId === "string" ? saved.currentGameId : null,
        gameStartedAt:
          typeof saved.gameStartedAt === "number" ? saved.gameStartedAt : null,
        betweenDealsEndsAt:
          typeof saved.betweenDealsEndsAt === "number"
            ? saved.betweenDealsEndsAt
            : null,
        betweenDealsPaused: Boolean(saved.betweenDealsPaused),
        betweenDealsRemainingMs:
          typeof saved.betweenDealsRemainingMs === "number"
            ? saved.betweenDealsRemainingMs
            : null,
        players: saved.players.map((p) => ({
          ...p,
          isBot: "isBot" in p ? Boolean((p as RoomPlayer).isBot) : false,
        })),
      };
    }
  }

  private db(): D1Database | undefined {
    return this.env.DB;
  }

  private async track(
    event: StatsEventName,
    opts: {
      playerName?: string | null;
      playerId?: string | null;
      role?: "player" | "spectator" | "bot" | "system" | null;
      meta?: Record<string, unknown> | null;
      gameId?: string | null;
    } = {},
  ) {
    await logEvent(this.db(), {
      event,
      roomId: this.name,
      playerName: opts.playerName,
      playerId: opts.playerId,
      role: opts.role,
      gameId: opts.gameId ?? this.room.currentGameId,
      meta: opts.meta,
    });
  }

  private async recordGameFinished(
    G: GameState,
    status: "ended" | "abandoned",
  ) {
    const gameId = this.room.currentGameId;
    if (!gameId) return;
    const winners = winnerIndexes(G).map((i) => G.players[i]?.name ?? `P${i}`);
    const losers = loserIndexes(G).map((i) => G.players[i]?.name ?? `P${i}`);
    const scores = G.players.map((p, i) => ({
      name: p.name ?? `P${i}`,
      points: p.points,
      isBot: this.isBotSeat(i),
    }));
    const started = this.room.gameStartedAt ?? Date.now();
    await logGameEnd(this.db(), {
      gameId,
      roomId: this.name,
      status,
      winnerNames: status === "ended" ? winners : [],
      loserNames: status === "ended" ? losers : [],
      scores,
      deals: G.round,
      durationMs: Math.max(0, Date.now() - started),
      meta: {
        pointsToEnd: G.options.points,
        tightDeck: G.options.tightDeck,
      },
    });
  }

  /** Diff player scores for row-take analytics */
  private async trackRowTakes(prev: GameState | null, next: GameState) {
    if (!prev) return;
    for (let i = 0; i < next.players.length; i++) {
      const a = prev.players[i];
      const b = next.players[i];
      if (!a || !b) continue;
      const bulls = b.points - a.points;
      const cards =
        (b.discard?.length ?? 0) - (a.discard?.length ?? 0);
      if (bulls <= 0 && cards <= 0) continue;
      const seatId = this.room.seats[i];
      const roomPlayer = this.room.players.find((p) => p.id === seatId);
      await this.track("row_take", {
        playerName: b.name ?? roomPlayer?.name,
        playerId: seatId,
        role: roomPlayer?.isBot ? "bot" : "player",
        meta: {
          bulls,
          cardsTaken: Math.max(0, cards),
          pointsAfter: b.points,
          deal: next.round,
          isBot: Boolean(roomPlayer?.isBot),
        },
      });
    }
  }

  /** Alarm: between-deals timer and/or abandon grace. */
  async onAlarm() {
    // Prefer finishing a deal break if one is due
    if (
      this.room.game &&
      isBetweenDeals(this.room.game) &&
      !this.room.betweenDealsPaused &&
      this.room.betweenDealsEndsAt != null &&
      Date.now() >= this.room.betweenDealsEndsAt - 50
    ) {
      await this.finishBetweenDeals();
      return;
    }

    // Reschedule between-deals if still waiting
    if (
      this.room.game &&
      isBetweenDeals(this.room.game) &&
      !this.room.betweenDealsPaused &&
      this.room.betweenDealsEndsAt != null &&
      this.room.betweenDealsEndsAt > Date.now()
    ) {
      await this.ctx.storage.setAlarm(this.room.betweenDealsEndsAt);
      return;
    }

    const wiped = await this.resetAbandonedGame("alarm");
    if (wiped) {
      this.broadcastRoom();
    }
  }

  private async scheduleAbandonCheck() {
    // Don't clobber an imminent between-deals alarm
    if (
      this.room.game &&
      isBetweenDeals(this.room.game) &&
      this.room.betweenDealsEndsAt != null &&
      !this.room.betweenDealsPaused
    ) {
      const next = Math.min(
        this.room.betweenDealsEndsAt,
        Date.now() + ABANDON_GRACE_MS,
      );
      await this.ctx.storage.setAlarm(next);
      return;
    }
    await this.ctx.storage.setAlarm(Date.now() + ABANDON_GRACE_MS);
  }

  private clearBetweenDealsTimers() {
    this.room.betweenDealsEndsAt = null;
    this.room.betweenDealsPaused = false;
    this.room.betweenDealsRemainingMs = null;
  }

  private async beginBetweenDealsBreak() {
    this.room.betweenDealsPaused = false;
    this.room.betweenDealsRemainingMs = null;
    this.room.betweenDealsEndsAt = Date.now() + BETWEEN_DEALS_MS;
    await this.persist();
    this.pushGameState();
    try {
      await this.ctx.storage.setAlarm(this.room.betweenDealsEndsAt);
    } catch {
      // fall through — client can still press Continue
    }
  }

  private async finishBetweenDeals() {
    if (!this.room.game || !isBetweenDeals(this.room.game)) return;
    this.clearBetweenDealsTimers();
    let next = advanceAfterBetweenDeals(cloneGame(this.room.game));
    this.room.game = next;
    if (ended(next)) {
      this.room.status = "ended";
      await this.recordGameFinished(next, "ended");
      await this.persist();
      this.pushGameState();
      this.broadcastRoom();
      this.broadcastJson({ type: "toast", message: "Game over!" });
      return;
    }
    await this.persist();
    this.pushGameState();
    this.broadcastJson({
      type: "toast",
      message: `Deal ${next.round} — new cards`,
    });
    await this.runBots();
  }

  private async clearAbandonTracking() {
    this.room.abandonedAt = null;
    try {
      await this.ctx.storage.deleteAlarm();
    } catch {
      // no alarm set
    }
  }

  private apiKey(): string | undefined {
    const key = this.env.GEMINI_API_KEY?.trim();
    return key || undefined;
  }

  private async persist() {
    await this.ctx.storage.put("room", this.room);
  }

  /** Connected humans only — used by home “recent rooms” list */
  private presence(): RoomPresence {
    const humans = [
      ...this.room.players
        .filter((p) => !p.isBot && p.connectionId !== null)
        .map((p) => ({ name: p.name, watching: false as boolean })),
      ...this.room.spectators
        .filter((s) => s.connectionId !== null)
        .map((s) => ({ name: s.name, watching: true as boolean })),
    ];
    return {
      roomId: this.name,
      status: this.room.status,
      humans,
      humanCount: humans.length,
    };
  }

  /**
   * HTTP: GET any path on this party returns live presence
   * (no WebSocket join required).
   */
  async onRequest(_request: Request): Promise<Response> {
    // Soft only — presence polls must not kill a game during reconnect grace
    await this.resetAbandonedGame("soft");
    return Response.json(this.presence(), {
      headers: {
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  private send(conn: Connection, msg: ServerMessage) {
    conn.send(JSON.stringify(msg));
  }

  private broadcastJson(msg: ServerMessage, exclude: string[] = []) {
    this.broadcast(JSON.stringify(msg), exclude);
  }

  private lobbyPlayers(): LobbyPlayer[] {
    return this.room.players.map((p) => ({
      id: p.id,
      name: p.name,
      connected: p.isBot || p.connectionId !== null,
      isBot: p.isBot,
      aiStyle: p.isBot ? p.aiStyle ?? this.room.aiStyle : undefined,
    }));
  }

  private botStyleAtSeat(index: number): AiStyle {
    const id = this.room.seats[index];
    const p = this.room.players.find((x) => x.id === id);
    if (p?.isBot && isAiStyle(p.aiStyle)) return p.aiStyle;
    return this.room.aiStyle;
  }

  private spectatorInfos(): SpectatorInfo[] {
    return this.room.spectators.map((s) => ({
      id: s.id,
      name: s.name,
      connected: s.connectionId !== null,
    }));
  }

  private connectedHumansCount(): number {
    const players = this.room.players.filter((p) => !p.isBot && p.connectionId !== null)
      .length;
    const watchers = this.room.spectators.filter((s) => s.connectionId !== null).length;
    return players + watchers;
  }

  private nameTaken(name: string, exceptId?: string): boolean {
    const n = name.toLowerCase();
    if (
      this.room.players.some(
        (p) => p.name.toLowerCase() === n && p.id !== exceptId,
      )
    ) {
      return true;
    }
    if (
      this.room.spectators.some(
        (s) => s.name.toLowerCase() === n && s.id !== exceptId,
      )
    ) {
      return true;
    }
    return false;
  }

  /** True if this connection id is gone / no longer live */
  private connectionDead(connectionId: string | null): boolean {
    if (!connectionId) return true;
    return !this.getConnection(connectionId);
  }

  /** Detach an old socket that still holds a seat/spectator slot */
  private detachConnection(connectionId: string | null) {
    if (!connectionId) return;
    const old = this.getConnection<ConnState>(connectionId);
    if (old) {
      try {
        old.setState(null);
      } catch {
        // ignore
      }
    }
  }

  /**
   * Clear a game with no humans online so the room is joinable again.
   * Bots alone do not keep a game "locked".
   *
   * - "soft" (default): only wipe after ABANDON_GRACE_MS (reconnect window).
   * - "force": wipe now (explicit Leave as last human).
   * - "alarm": wipe if still empty after grace.
   */
  private async resetAbandonedGame(
    mode: "soft" | "force" | "alarm" = "soft",
  ): Promise<boolean> {
    if (this.room.status === "lobby") {
      await this.clearAbandonTracking();
      return false;
    }
    if (this.connectedHumansCount() > 0) {
      await this.clearAbandonTracking();
      return false;
    }

    if (mode !== "force") {
      const now = Date.now();
      if (this.room.abandonedAt == null) {
        this.room.abandonedAt = now;
        await this.persist();
        await this.scheduleAbandonCheck();
        return false;
      }
      if (now - this.room.abandonedAt < ABANDON_GRACE_MS) {
        // Ensure an alarm will finish the job
        await this.scheduleAbandonCheck();
        return false;
      }
    }

    // Log abandon before wiping board
    if (this.room.game && this.room.currentGameId) {
      await this.recordGameFinished(this.room.game, "abandoned");
    }

    this.room.status = "lobby";
    this.room.game = null;
    this.room.seats = [];
    this.room.spectators = [];
    this.room.abandonedAt = null;
    this.room.currentGameId = null;
    this.room.gameStartedAt = null;
    this.clearBetweenDealsTimers();
    // Drop ghost humans; keep bots for a quick rematch if desired
    this.room.players = this.room.players.filter((p) => p.isBot);
    this.room.hostId =
      this.room.players.find((p) => !p.isBot)?.id ??
      this.room.players[0]?.id ??
      null;
    try {
      await this.ctx.storage.deleteAlarm();
    } catch {
      // ignore
    }
    await this.persist();
    return true;
  }

  private ensureSessionToken(seat: {
    sessionToken?: string;
    isBot?: boolean;
  }): string {
    if (!seat.sessionToken) seat.sessionToken = crypto.randomUUID();
    return seat.sessionToken;
  }

  private sessionTokenFor(
    youId: string,
    youRole: "player" | "spectator",
  ): string | undefined {
    if (youRole === "player") {
      return this.room.players.find((x) => x.id === youId)?.sessionToken;
    }
    return this.room.spectators.find((x) => x.id === youId)?.sessionToken;
  }

  private sendRoom(
    conn: Connection,
    youId: string,
    youRole: "player" | "spectator",
  ) {
    this.send(conn, {
      type: "room",
      roomId: this.name,
      status: this.room.status,
      players: this.lobbyPlayers(),
      spectators: this.spectatorInfos(),
      hostId: this.room.hostId,
      youId,
      youRole,
      maxPlayers: MAX_PLAYERS,
      hasAiKey: Boolean(this.apiKey()),
      aiStyle: this.room.aiStyle,
      tightDeck: this.room.tightDeck,
      sessionToken: this.sessionTokenFor(youId, youRole),
    });
  }

  private broadcastRoom() {
    for (const conn of this.getConnections<ConnState>()) {
      const st = conn.state;
      if (!st?.playerId) continue;
      this.sendRoom(conn, st.playerId, st.role);
    }
  }

  private seatIndex(playerId: string): number {
    return this.room.seats.indexOf(playerId);
  }

  private isBotSeat(index: number): boolean {
    const id = this.room.seats[index];
    return this.room.players.find((p) => p.id === id)?.isBot ?? false;
  }

  private pushGameState() {
    if (!this.room.game) return;

    const specs = this.spectatorInfos().filter((s) => s.connected);

    for (const conn of this.getConnections<ConnState>()) {
      const st = conn.state;
      if (!st?.playerId) continue;

      const isSpectator = st.role === "spectator";
      const idx = isSpectator ? -1 : this.seatIndex(st.playerId);
      if (!isSpectator && idx < 0) continue;

      const publicState = toPublicState(this.room.game, idx, {
        betweenDealsEndsAt: this.room.betweenDealsEndsAt,
        betweenDealsPaused: this.room.betweenDealsPaused,
      });
      publicState.players.forEach((p, i) => {
        p.isBot = this.isBotSeat(i);
        if (p.isBot) p.aiStyle = this.botStyleAtSeat(i);
      });
      const status = publicState.ended ? "ended" : "playing";
      if (publicState.ended) this.room.status = "ended";

      this.send(conn, {
        type: "state",
        game: publicState,
        status,
        spectators: specs,
        youAreSpectator: isSpectator,
      });
    }
  }

  private async applyAndContinue(next: GameState) {
    const prev = this.room.game ? cloneGame(this.room.game) : null;
    await this.trackRowTakes(prev, next);
    this.room.game = next;
    if (ended(next)) this.room.status = "ended";
    await this.persist();
    this.pushGameState();
    if (this.room.status === "ended") {
      this.clearBetweenDealsTimers();
      await this.recordGameFinished(next, "ended");
      this.broadcastRoom();
      this.broadcastJson({ type: "toast", message: "Game over!" });
      return;
    }
    if (isBetweenDeals(next)) {
      await this.beginBetweenDealsBreak();
      return;
    }
    await this.runBots();
  }

  /**
   * Let Gemini/heuristic bots act until humans must move.
   *
   * Important: after any `await` (sleep / Gemini), re-read `this.room.game`.
   * Humans may have chosen/placed during the wait — applying bot moves on a
   * stale clone would wipe their card selection.
   */
  private async runBots() {
    if (this.botsBusy || !this.room.game || this.room.status !== "playing") {
      // Someone else is mid-bot-turn; mark that we need another pass when free
      if (this.botsBusy) this.botsNeedRerun = true;
      return;
    }
    this.botsBusy = true;
    this.botsNeedRerun = false;

    try {
      let guard = 0;
      while (this.room.game && this.room.status === "playing" && guard++ < 40) {
        let G = this.room.game;
        if (ended(G)) break;
        if (isBetweenDeals(G)) break;

        if (G.phase === Phase.ChooseCard) {
          const botIndexes = G.players
            .map((pl, i) => ({ pl, i }))
            .filter(
              ({ pl, i }) =>
                this.isBotSeat(i) &&
                !pl.faceDownCard &&
                pl.availableMoves?.[MoveName.ChooseCard]?.length,
            )
            .map(({ i }) => i);

          if (botIndexes.length === 0) break;

          // Snapshot only for AI thinking (may be slightly stale; apply uses latest)
          const thinkSnap = cloneGame(G);
          const pace = Math.max(...botIndexes.map((i) => botPaceMs(this.botStyleAtSeat(i))));
          await sleep(pace);

          const picks = await Promise.all(
            botIndexes.map(async (i) => ({
              i,
              card: await chooseCardForBot(
                cloneGame(thinkSnap),
                i,
                this.apiKey(),
                this.botStyleAtSeat(i),
              ),
            })),
          );

          // Re-read after async — humans may have locked in while bots thought
          if (!this.room.game || this.room.status !== "playing") break;
          if (this.room.game.phase !== Phase.ChooseCard) continue;

          let next = cloneGame(this.room.game);
          for (const { i, card } of picks) {
            // Skip if this bot already has a card (or seat changed)
            if (next.players[i]?.faceDownCard) continue;
            if (!this.isBotSeat(i)) continue;
            const still = next.players[i].hand.find((c) => c.number === card.number);
            if (!still) continue;
            next = move(next, { name: MoveName.ChooseCard, data: still }, i);
          }

          if (next.phase === Phase.PlaceCard) {
            next = autoPlaceIfPossible(next);
          }

          const prevChoose = this.room.game ? cloneGame(this.room.game) : null;
          await this.trackRowTakes(prevChoose, next);
          this.room.game = next;
          if (ended(next)) {
            this.room.status = "ended";
            this.clearBetweenDealsTimers();
            await this.recordGameFinished(next, "ended");
            await this.persist();
            this.pushGameState();
            this.broadcastRoom();
            this.broadcastJson({ type: "toast", message: "Game over!" });
            return;
          }
          if (isBetweenDeals(next)) {
            await this.persist();
            await this.beginBetweenDealsBreak();
            return;
          }
          await this.persist();
          this.pushGameState();
          continue;
        }

        // Place phase: one actor at a time
        const actor = G.players.findIndex(
          (pl, i) =>
            this.isBotSeat(i) &&
            (pl.availableMoves?.[MoveName.PlaceCard]?.length ?? 0) > 0,
        );
        if (actor < 0) break;

        const placeSnap = cloneGame(G);
        const actorStyle = this.botStyleAtSeat(actor);
        await sleep(Math.round(botPaceMs(actorStyle) * 0.7));

        const choice = await placeRowForBot(
          cloneGame(placeSnap),
          actor,
          this.apiKey(),
          actorStyle,
        );

        // Re-read after async — don't overwrite human place/choose
        if (!this.room.game || this.room.status !== "playing") break;
        if (this.room.game.phase !== Phase.PlaceCard) continue;

        const live = this.room.game;
        // Bot may no longer be the actor (human swap / place changed order)
        if (
          !this.isBotSeat(actor) ||
          !live.players[actor]?.faceDownCard ||
          !(live.players[actor].availableMoves?.[MoveName.PlaceCard]?.length)
        ) {
          continue;
        }

        const legal = live.players[actor].availableMoves![MoveName.PlaceCard]!;
        const pick =
          legal.find((m) => m.row === choice.row && m.replace === choice.replace) ??
          legal[0];
        if (!pick) continue;

        let next = move(
          cloneGame(live),
          { name: MoveName.PlaceCard, data: pick },
          actor,
        );
        next = autoPlaceIfPossible(next);

        const prevPlace = this.room.game ? cloneGame(this.room.game) : null;
        await this.trackRowTakes(prevPlace, next);
        this.room.game = next;
        if (ended(next)) {
          this.room.status = "ended";
          this.clearBetweenDealsTimers();
          await this.recordGameFinished(next, "ended");
          await this.persist();
          this.pushGameState();
          this.broadcastRoom();
          this.broadcastJson({ type: "toast", message: "Game over!" });
          return;
        }
        if (isBetweenDeals(next)) {
          await this.persist();
          await this.beginBetweenDealsBreak();
          return;
        }
        await this.persist();
        this.pushGameState();
      }
    } finally {
      this.botsBusy = false;
    }

    // Human acted while bots were busy — run again so bots catch up
    if (this.botsNeedRerun) {
      this.botsNeedRerun = false;
      await this.runBots();
    }
  }

  async onConnect(connection: Connection) {
    // Only free rooms abandoned past the reconnect grace (never wipe live seats)
    await this.resetAbandonedGame("soft");

    this.send(connection, {
      type: "room",
      roomId: this.name,
      status: this.room.status,
      players: this.lobbyPlayers(),
      spectators: this.spectatorInfos(),
      hostId: this.room.hostId,
      // Empty youId = not joined yet (client must not treat this as in-game)
      youId: "",
      youRole: "player",
      maxPlayers: MAX_PLAYERS,
      hasAiKey: Boolean(this.apiKey()),
      aiStyle: this.room.aiStyle,
      tightDeck: this.room.tightDeck,
    });
  }

  async onMessage(connection: Connection, raw: string | ArrayBuffer) {
    if (typeof raw !== "string") return;

    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      this.send(connection, { type: "error", message: "Invalid message" });
      return;
    }

    try {
      switch (msg.type) {
        case "join":
          await this.handleJoin(connection, msg.name, msg.sessionToken);
          break;
        case "start":
          await this.handleStart(connection, msg.tightDeck);
          break;
        case "setTightDeck":
          await this.handleSetTightDeck(connection, msg.tightDeck);
          break;
        case "addBots":
          await this.handleAddBots(connection, msg.count ?? 1);
          break;
        case "removeBot":
          await this.handleRemoveBot(connection);
          break;
        case "setAiStyle":
          await this.handleSetAiStyle(connection, msg.style);
          break;
        case "setBotAiStyle":
          await this.handleSetBotAiStyle(connection, msg.botId, msg.style);
          break;
        case "chooseCard":
          await this.handleChoose(connection, msg.cardNumber);
          break;
        case "placeCard":
          await this.handlePlace(connection, msg.row, msg.replace);
          break;
        case "swapCard":
          await this.handleSwapCard(connection, msg.cardNumber);
          break;
        case "restart":
          await this.handleRestart(connection);
          break;
        case "playAgain":
          await this.handlePlayAgain(connection, msg.tightDeck);
          break;
        case "pauseBetweenDeals":
          await this.handlePauseBetweenDeals(connection);
          break;
        case "resumeBetweenDeals":
          await this.handleResumeBetweenDeals(connection);
          break;
        case "continueBetweenDeals":
          await this.handleContinueBetweenDeals(connection);
          break;
        case "leave":
          await this.handleLeave(connection);
          break;
        default:
          this.send(connection, { type: "error", message: "Unknown action" });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      this.send(connection, { type: "error", message });
    }
  }

  async onClose(connection: Connection) {
    const st = connection.state as ConnState | undefined;
    const playerId = st?.playerId;
    if (!playerId) return;

    if (st.role === "spectator") {
      const spec = this.room.spectators.find((s) => s.id === playerId);
      if (spec && spec.connectionId === connection.id) {
        // Keep spectator slot briefly so refresh/reconnect can reclaim by name;
        // only clear the live socket (drop fully if still gone after grace via soft reset path)
        spec.connectionId = null;
      }
    } else {
      const player = this.room.players.find((p) => p.id === playerId);
      if (player && player.connectionId === connection.id) {
        player.connectionId = null;
      }
    }

    await this.track("player_disconnect", {
      playerName: st.name,
      playerId,
      role: st.role,
      meta: { status: this.room.status },
    });

    if (this.room.status === "lobby") {
      // Keep bots; drop only disconnected humans
      this.room.players = this.room.players.filter(
        (p) => p.isBot || p.connectionId !== null,
      );
      this.room.spectators = this.room.spectators.filter((s) => s.connectionId !== null);
      if (this.room.hostId === playerId) {
        this.room.hostId =
          this.room.players.find((p) => !p.isBot)?.id ??
          this.room.players[0]?.id ??
          null;
      }
    } else if (this.connectedHumansCount() === 0) {
      // Idle / network drop — keep the game for ABANDON_GRACE_MS so they can rejoin
      this.room.abandonedAt = Date.now();
      await this.scheduleAbandonCheck();
    }

    await this.persist();
    this.broadcastRoom();
  }

  private async bindSeat(
    connection: Connection,
    seat: { id: string; name: string; connectionId: string | null; sessionToken?: string },
    role: "player" | "spectator",
    toast?: string,
  ) {
    this.detachConnection(seat.connectionId);
    seat.connectionId = connection.id;
    this.ensureSessionToken(seat);
    if (role === "player") {
      this.room.spectators = this.room.spectators.filter((s) => s.id !== seat.id);
    }
    connection.setState({
      playerId: seat.id,
      name: seat.name,
      role,
    } satisfies ConnState);
    await this.clearAbandonTracking();
    await this.persist();
    this.broadcastRoom();
    if (this.room.game) this.pushGameState();
    if (toast) this.send(connection, { type: "toast", message: toast });
  }

  private async handleJoin(
    connection: Connection,
    rawName: string,
    sessionToken?: string,
  ) {
    const name = rawName.trim().slice(0, 20);
    if (!name) {
      this.send(connection, { type: "error", message: "Enter a name" });
      return;
    }

    const token =
      typeof sessionToken === "string" && sessionToken.length >= 8
        ? sessionToken.trim()
        : "";

    // Ghost games past grace should not block rejoin; active seats stay reserved
    await this.resetAbandonedGame("soft");

    // Already joined on this socket
    const existingPlayer = this.room.players.find((p) => p.connectionId === connection.id);
    if (existingPlayer) {
      // Allow renaming display name while keeping seat
      if (name && name !== existingPlayer.name) {
        const clash = this.nameTaken(name, existingPlayer.id);
        if (!clash) existingPlayer.name = name;
      }
      this.ensureSessionToken(existingPlayer);
      connection.setState({
        playerId: existingPlayer.id,
        name: existingPlayer.name,
        role: "player",
      } satisfies ConnState);
      await this.persist();
      this.sendRoom(connection, existingPlayer.id, "player");
      if (this.room.game) this.pushGameState();
      return;
    }
    const existingSpec = this.room.spectators.find((s) => s.connectionId === connection.id);
    if (existingSpec) {
      if (name && name !== existingSpec.name) {
        const clash = this.nameTaken(name, existingSpec.id);
        if (!clash) existingSpec.name = name;
      }
      this.ensureSessionToken(existingSpec);
      connection.setState({
        playerId: existingSpec.id,
        name: existingSpec.name,
        role: "spectator",
      } satisfies ConnState);
      await this.persist();
      this.sendRoom(connection, existingSpec.id, "spectator");
      if (this.room.game) this.pushGameState();
      return;
    }

    // 1) Prefer opaque session token (device reconnect) — not IP/fingerprint
    if (token) {
      const byTokenPlayer = this.room.players.find(
        (p) => !p.isBot && p.sessionToken === token,
      );
      if (byTokenPlayer) {
        // Optional display-name update if free
        if (name !== byTokenPlayer.name && !this.nameTaken(name, byTokenPlayer.id)) {
          byTokenPlayer.name = name;
        }
        await this.bindSeat(
          connection,
          byTokenPlayer,
          "player",
          this.room.status === "lobby"
            ? `Rejoined room ${this.name}`
            : "Reconnected to your seat",
        );
        await this.track("player_rejoin", {
          playerName: byTokenPlayer.name,
          playerId: byTokenPlayer.id,
          role: "player",
          meta: { via: "sessionToken", status: this.room.status },
        });
        return;
      }
      const byTokenSpec = this.room.spectators.find((s) => s.sessionToken === token);
      if (byTokenSpec) {
        if (name !== byTokenSpec.name && !this.nameTaken(name, byTokenSpec.id)) {
          byTokenSpec.name = name;
        }
        await this.bindSeat(connection, byTokenSpec, "spectator", "Back to watching");
        await this.track("player_rejoin", {
          playerName: byTokenSpec.name,
          playerId: byTokenSpec.id,
          role: "spectator",
          meta: { via: "sessionToken", status: this.room.status },
        });
        return;
      }
      // Stale token (room wiped / leave) — fall through as a fresh join
    }

    const nameKey = name.toLowerCase();

    // 2) Same name as a human seat → reclaim only if offline (or no live socket)
    const sameSeat = this.room.players.find(
      (p) => !p.isBot && p.name.toLowerCase() === nameKey,
    );
    if (sameSeat) {
      if (
        sameSeat.connectionId &&
        sameSeat.connectionId !== connection.id &&
        !this.connectionDead(sameSeat.connectionId)
      ) {
        this.send(connection, {
          type: "error",
          message: `"${sameSeat.name}" is already in this room (online). Pick another name.`,
        });
        return;
      }
      // If seat has a different live token holder offline, name reclaim is still OK
      // (they left the tab). Issue/keep token for this client.
      await this.bindSeat(
        connection,
        sameSeat,
        "player",
        this.room.status === "lobby"
          ? `Rejoined room ${this.name}`
          : "Reconnected to your seat",
      );
      await this.track("player_rejoin", {
        playerName: sameSeat.name,
        playerId: sameSeat.id,
        role: "player",
        meta: { via: "name", status: this.room.status },
      });
      return;
    }

    // Name used by a bot
    const botClash = this.room.players.find(
      (p) => p.isBot && p.name.toLowerCase() === nameKey,
    );
    if (botClash) {
      this.send(connection, {
        type: "error",
        message: `"${botClash.name}" is a bot name — pick a different display name.`,
      });
      return;
    }

    // Same name as a spectator → reclaim watcher slot
    const sameSpec = this.room.spectators.find((s) => s.name.toLowerCase() === nameKey);
    if (sameSpec) {
      if (
        sameSpec.connectionId &&
        sameSpec.connectionId !== connection.id &&
        !this.connectionDead(sameSpec.connectionId)
      ) {
        this.send(connection, {
          type: "error",
          message: `"${sameSpec.name}" is already watching. Pick another name.`,
        });
        return;
      }
      await this.bindSeat(connection, sameSpec, "spectator", "Back to watching");
      await this.track("player_rejoin", {
        playerName: sameSpec.name,
        playerId: sameSpec.id,
        role: "spectator",
        meta: { via: "name", status: this.room.status },
      });
      return;
    }

    // Mid-game or ended: join as spectator (watch now, lobby next)
    if (this.room.status === "playing" || this.room.status === "ended") {
      if (this.room.spectators.filter((s) => s.connectionId).length >= MAX_SPECTATORS) {
        this.send(connection, { type: "error", message: "Too many watchers right now" });
        return;
      }

      const id = crypto.randomUUID();
      const session = crypto.randomUUID();
      this.room.spectators.push({
        id,
        name,
        connectionId: connection.id,
        sessionToken: session,
      });
      connection.setState({ playerId: id, name, role: "spectator" } satisfies ConnState);
      await this.clearAbandonTracking();
      await this.persist();
      this.broadcastRoom();
      if (this.room.game) this.pushGameState();
      this.broadcastJson({
        type: "toast",
        message: `${name} is watching`,
      });
      this.send(connection, {
        type: "toast",
        message:
          this.room.status === "ended"
            ? "Watching results — you'll join the lobby for the next game"
            : "You're watching — you'll be in the lobby for the next game",
      });
      await this.track("spectator_join", {
        playerName: name,
        playerId: id,
        role: "spectator",
        meta: { status: this.room.status },
      });
      return;
    }

    // Lobby: join as player
    if (this.room.players.length >= MAX_PLAYERS) {
      this.send(connection, { type: "error", message: "Room is full" });
      return;
    }

    const id = crypto.randomUUID();
    const session = crypto.randomUUID();
    const isFirstHuman =
      this.room.players.filter((p) => !p.isBot).length === 0;
    this.room.players.push({
      id,
      name,
      connectionId: connection.id,
      isBot: false,
      sessionToken: session,
    });
    if (!this.room.hostId || this.room.players.find((p) => p.id === this.room.hostId)?.isBot) {
      this.room.hostId = id;
    }

    connection.setState({ playerId: id, name, role: "player" } satisfies ConnState);
    await this.persist();
    this.broadcastRoom();
    this.send(connection, { type: "toast", message: `Joined room ${this.name}` });
    if (isFirstHuman) {
      await this.track("room_visit", {
        playerName: name,
        playerId: id,
        role: "player",
        meta: { firstHuman: true },
      });
    }
    await this.track("player_join", {
      playerName: name,
      playerId: id,
      role: "player",
      meta: {
        host: this.room.hostId === id,
        playerCount: this.room.players.length,
        botCount: this.room.players.filter((p) => p.isBot).length,
      },
    });
  }

  private async handleAddBots(connection: Connection, count: number) {
    const playerId = (connection.state as ConnState | undefined)?.playerId;
    if (!playerId || playerId !== this.room.hostId) {
      this.send(connection, { type: "error", message: "Only the host can add bots" });
      return;
    }
    if (this.room.status !== "lobby") {
      this.send(connection, { type: "error", message: "Can only add bots in lobby" });
      return;
    }

    const n = Math.max(1, Math.min(9, Math.floor(count)));
    let added = 0;
    for (let i = 0; i < n && this.room.players.length < MAX_PLAYERS; i++) {
      const used = new Set(this.room.players.map((p) => p.name.toLowerCase()));
      const name =
        BOT_NAMES.find((b) => !used.has(b.toLowerCase())) ??
        `Bot ${this.room.players.filter((p) => p.isBot).length + 1}`;
      // Cycle levels so multiple bots aren't all the same by default
      const cycle: AiStyle[] = ["easy", "solid", "sharp", "wild"];
      const existingBots = this.room.players.filter((p) => p.isBot).length;
      const botStyle = cycle[existingBots % cycle.length] ?? this.room.aiStyle;
      this.room.players.push({
        id: crypto.randomUUID(),
        name,
        connectionId: null,
        isBot: true,
        aiStyle: botStyle,
      });
      added++;
    }

    await this.persist();
    this.broadcastRoom();
    if (added) {
      this.broadcastJson({
        type: "toast",
        message: added === 1 ? `Added ${this.room.players.at(-1)!.name}` : `Added ${added} bots`,
      });
      await this.track("bot_add", {
        role: "system",
        meta: {
          added,
          botCount: this.room.players.filter((p) => p.isBot).length,
        },
      });
    }
  }

  private async handleRemoveBot(connection: Connection) {
    const playerId = (connection.state as ConnState | undefined)?.playerId;
    if (!playerId || playerId !== this.room.hostId) {
      this.send(connection, { type: "error", message: "Only the host can remove bots" });
      return;
    }
    if (this.room.status !== "lobby") return;

    const idx = [...this.room.players].map((p, i) => ({ p, i })).reverse().find(({ p }) => p.isBot)?.i;
    if (idx === undefined) {
      this.send(connection, { type: "error", message: "No bots to remove" });
      return;
    }
    const [removed] = this.room.players.splice(idx, 1);
    await this.persist();
    this.broadcastRoom();
    this.broadcastJson({ type: "toast", message: `Removed ${removed.name}` });
    await this.track("bot_remove", {
      playerName: removed.name,
      playerId: removed.id,
      role: "bot",
    });
  }

  private async handleSetAiStyle(connection: Connection, style: AiStyle) {
    const playerId = (connection.state as ConnState | undefined)?.playerId;
    if (!playerId || playerId !== this.room.hostId) {
      this.send(connection, { type: "error", message: "Only the host can set AI style" });
      return;
    }
    if (!isAiStyle(style)) {
      this.send(connection, { type: "error", message: "Unknown AI style" });
      return;
    }
    this.room.aiStyle = style;
    await this.track("ai_style", {
      role: "system",
      meta: { style, scope: "all_bots_default" },
    });
    // Apply as default to every bot (host can still override per bot)
    for (const p of this.room.players) {
      if (p.isBot) p.aiStyle = style;
    }
    await this.persist();
    this.broadcastRoom();
    const labels: Record<AiStyle, string> = {
      easy: "Easy",
      solid: "Solid",
      sharp: "Sharp",
      wild: "Wild",
    };
    this.broadcastJson({
      type: "toast",
      message: `All bots → ${labels[style]} (change each bot in the list)`,
    });
  }

  private async handleSetBotAiStyle(
    connection: Connection,
    botId: string,
    style: AiStyle,
  ) {
    const playerId = (connection.state as ConnState | undefined)?.playerId;
    if (!playerId || playerId !== this.room.hostId) {
      this.send(connection, { type: "error", message: "Only the host can set bot level" });
      return;
    }
    if (!isAiStyle(style)) {
      this.send(connection, { type: "error", message: "Unknown AI style" });
      return;
    }
    const bot = this.room.players.find((p) => p.id === botId && p.isBot);
    if (!bot) {
      this.send(connection, { type: "error", message: "Bot not found" });
      return;
    }
    bot.aiStyle = style;
    await this.persist();
    this.broadcastRoom();
    const labels: Record<AiStyle, string> = {
      easy: "Easy",
      solid: "Solid",
      sharp: "Sharp",
      wild: "Wild",
    };
    this.broadcastJson({
      type: "toast",
      message: `${bot.name} → ${labels[style]}`,
    });
  }

  private async handleSetTightDeck(connection: Connection, tightDeck: boolean) {
    const playerId = (connection.state as ConnState | undefined)?.playerId;
    if (!playerId || playerId !== this.room.hostId) {
      this.send(connection, { type: "error", message: "Only the host can change deck mode" });
      return;
    }
    if (this.room.status !== "lobby") {
      this.send(connection, { type: "error", message: "Can only change deck before start" });
      return;
    }
    this.room.tightDeck = Boolean(tightDeck);
    await this.persist();
    this.broadcastRoom();
    await this.track("tight_deck", {
      role: "system",
      meta: { tightDeck: this.room.tightDeck },
    });
  }

  /** Shared deal setup — room must already be lobby with enough players. */
  private async beginGame(tightDeckMsg?: boolean): Promise<boolean> {
    if (this.room.status !== "lobby") return false;
    if (this.room.players.length < MIN_PLAYERS) return false;
    if (!this.room.players.some((p) => !p.isBot)) return false;

    if (typeof tightDeckMsg === "boolean") {
      this.room.tightDeck = tightDeckMsg;
    }

    this.room.seats = this.room.players.map((p) => p.id);
    const names = this.room.players.map((p) => p.name);
    const n = names.length;
    const humans = this.room.players.filter((p) => !p.isBot);
    const bots = this.room.players.filter((p) => p.isBot);
    const host = this.room.players.find((p) => p.id === this.room.hostId);
    const gameId = crypto.randomUUID();
    this.room.currentGameId = gameId;
    this.room.gameStartedAt = Date.now();
    this.room.game = setup(
      n,
      {
        points: 66,
        handSize: 10,
        tightDeck: this.room.tightDeck,
      },
      undefined,
      names,
    );
    this.room.status = "playing";
    await this.persist();
    this.broadcastRoom();
    this.pushGameState();
    await logGameStart(this.db(), {
      gameId,
      roomId: this.name,
      humanCount: humans.length,
      botCount: bots.length,
      playerCount: n,
      tightDeck: this.room.tightDeck,
      aiStyle: this.room.aiStyle,
      hostName: host?.name ?? null,
      playerNames: names,
      meta: {
        botNames: bots.map((b) => b.name),
        humanNames: humans.map((h) => h.name),
        hasGemini: Boolean(this.apiKey()),
      },
    });
    const styleLabel = this.room.aiStyle;
    const deckNote = this.room.tightDeck
      ? `tight deck 1–${n * 10 + 4}`
      : "full deck 1–104";
    this.broadcastJson({
      type: "toast",
      message: this.apiKey()
        ? `Game started (${deckNote}) — Gemini (${styleLabel})…`
        : `Game started (${deckNote}) — bots (${styleLabel})`,
    });
    await this.runBots();
    return true;
  }

  private async handleStart(connection: Connection, tightDeckMsg?: boolean) {
    const playerId = (connection.state as ConnState | undefined)?.playerId;
    if (!playerId || playerId !== this.room.hostId) {
      this.send(connection, { type: "error", message: "Only the host can start" });
      return;
    }
    if (this.room.status !== "lobby") {
      this.send(connection, { type: "error", message: "Game already started" });
      return;
    }
    if (this.room.players.length < MIN_PLAYERS) {
      this.send(connection, {
        type: "error",
        message: "Need at least 2 players (add AI bots to play solo)",
      });
      return;
    }
    if (!this.room.players.some((p) => !p.isBot)) {
      this.send(connection, { type: "error", message: "Need at least one human" });
      return;
    }

    await this.beginGame(tightDeckMsg);
  }

  private async handleChoose(connection: Connection, cardNumber: number) {
    const playerId = (connection.state as ConnState | undefined)?.playerId;
    if (!playerId || !this.room.game || this.room.status !== "playing") {
      this.send(connection, { type: "error", message: "No active game" });
      return;
    }

    const idx = this.seatIndex(playerId);
    if (idx < 0) throw new Error("You are not in this game");
    if (this.isBotSeat(idx)) throw new Error("Bots play themselves");

    const G = cloneGame(this.room.game);
    const card = G.players[idx].hand.find((c) => c.number === cardNumber);
    if (!card) throw new Error("That card is not in your hand");

    let next = move(G, { name: MoveName.ChooseCard, data: card }, idx);
    if (next.phase === Phase.PlaceCard) {
      next = autoPlaceIfPossible(next);
    }

    await this.applyAndContinue(next);
  }

  private async handlePlace(connection: Connection, row: number, replace: boolean) {
    const playerId = (connection.state as ConnState | undefined)?.playerId;
    if (!playerId || !this.room.game || this.room.status !== "playing") {
      this.send(connection, { type: "error", message: "No active game" });
      return;
    }

    const idx = this.seatIndex(playerId);
    if (idx < 0) throw new Error("You are not in this game");

    let next = move(
      cloneGame(this.room.game),
      { name: MoveName.PlaceCard, data: { row, replace } },
      idx,
    );
    next = autoPlaceIfPossible(next);
    await this.applyAndContinue(next);
  }

  /** When forced to take a row: swap face-down card for another from hand */
  private async handleSwapCard(connection: Connection, cardNumber: number) {
    const playerId = (connection.state as ConnState | undefined)?.playerId;
    if (!playerId || !this.room.game || this.room.status !== "playing") {
      this.send(connection, { type: "error", message: "No active game" });
      return;
    }

    const idx = this.seatIndex(playerId);
    if (idx < 0) throw new Error("You are not in this game");
    if (this.isBotSeat(idx)) throw new Error("Bots play themselves");

    const who =
      this.room.players.find((p) => p.id === playerId)?.name ?? "Player";
    const prevCard = this.room.game.players[idx]?.faceDownCard?.number;
    let next = swapForcedCard(cloneGame(this.room.game), idx, cardNumber);
    next = autoPlaceIfPossible(next);
    await this.track("card_swap", {
      playerName: who,
      playerId,
      role: "player",
      meta: { from: prevCard, to: cardNumber },
    });
    await this.applyAndContinue(next);
    this.broadcastJson({
      type: "toast",
      message: `${who} switched to a different card`,
    });
  }

  /**
   * Clear the board and seat everyone for lobby.
   * Returns how many watchers were promoted to the table.
   */
  private async returnToLobby(): Promise<number> {
    // If host resets mid-game without a finished result, mark abandoned
    if (
      this.room.game &&
      this.room.currentGameId &&
      this.room.status === "playing"
    ) {
      await this.recordGameFinished(this.room.game, "abandoned");
    }

    this.room.status = "lobby";
    this.room.game = null;
    this.room.seats = [];
    this.room.currentGameId = null;
    this.room.gameStartedAt = null;
    this.clearBetweenDealsTimers();

    // Keep bots + connected seated humans
    let nextPlayers = this.room.players.filter(
      (p) => p.isBot || p.connectionId !== null,
    );

    // Promote connected watchers into the next lobby (they're waiting to play)
    const waiting = this.room.spectators.filter((s) => s.connectionId !== null);
    const promoted: string[] = [];
    for (const s of waiting) {
      if (nextPlayers.length >= MAX_PLAYERS) break;
      if (nextPlayers.some((p) => p.name.toLowerCase() === s.name.toLowerCase())) {
        continue;
      }
      nextPlayers.push({
        id: s.id,
        name: s.name,
        connectionId: s.connectionId,
        isBot: false,
        sessionToken: s.sessionToken,
      });
      promoted.push(s.id);
    }

    // Leftover watchers stay listed if room was full
    this.room.spectators = waiting
      .filter((s) => !promoted.includes(s.id))
      .map((s) => ({ ...s }));

    this.room.players = nextPlayers;

    if (!this.room.players.find((p) => p.id === this.room.hostId)) {
      this.room.hostId =
        this.room.players.find((p) => !p.isBot)?.id ??
        this.room.players[0]?.id ??
        null;
    }

    // Flip connection roles for promoted watchers
    for (const conn of this.getConnections<ConnState>()) {
      const st = conn.state;
      if (!st) continue;
      if (promoted.includes(st.playerId)) {
        conn.setState({ ...st, role: "player" });
      }
    }

    await this.persist();
    this.broadcastRoom();
    return promoted.length;
  }

  private async handlePauseBetweenDeals(connection: Connection) {
    const playerId = (connection.state as ConnState | undefined)?.playerId;
    if (!playerId || !this.room.game || !isBetweenDeals(this.room.game)) {
      this.send(connection, { type: "error", message: "Nothing to pause" });
      return;
    }
    if (this.room.betweenDealsPaused) return;

    const remaining = Math.max(
      0,
      (this.room.betweenDealsEndsAt ?? Date.now()) - Date.now(),
    );
    this.room.betweenDealsPaused = true;
    this.room.betweenDealsRemainingMs = remaining;
    this.room.betweenDealsEndsAt = null;
    await this.persist();
    this.pushGameState();
    const who =
      this.room.players.find((p) => p.id === playerId)?.name ??
      this.room.spectators.find((s) => s.id === playerId)?.name ??
      "Someone";
    this.broadcastJson({
      type: "toast",
      message: `${who} paused the break`,
    });
  }

  private async handleResumeBetweenDeals(connection: Connection) {
    const playerId = (connection.state as ConnState | undefined)?.playerId;
    if (!playerId || !this.room.game || !isBetweenDeals(this.room.game)) {
      this.send(connection, { type: "error", message: "Nothing to resume" });
      return;
    }
    if (!this.room.betweenDealsPaused) return;

    const remaining = this.room.betweenDealsRemainingMs ?? BETWEEN_DEALS_MS;
    this.room.betweenDealsPaused = false;
    this.room.betweenDealsRemainingMs = null;
    this.room.betweenDealsEndsAt = Date.now() + Math.max(500, remaining);
    await this.persist();
    this.pushGameState();
    try {
      await this.ctx.storage.setAlarm(this.room.betweenDealsEndsAt);
    } catch {
      // ignore
    }
    const who =
      this.room.players.find((p) => p.id === playerId)?.name ??
      this.room.spectators.find((s) => s.id === playerId)?.name ??
      "Someone";
    this.broadcastJson({
      type: "toast",
      message: `${who} resumed — next deal soon`,
    });
  }

  private async handleContinueBetweenDeals(connection: Connection) {
    const playerId = (connection.state as ConnState | undefined)?.playerId;
    if (!playerId || !this.room.game || !isBetweenDeals(this.room.game)) {
      this.send(connection, { type: "error", message: "No deal break to skip" });
      return;
    }
    await this.finishBetweenDeals();
  }

  private async handleRestart(connection: Connection) {
    const playerId = (connection.state as ConnState | undefined)?.playerId;
    if (!playerId || playerId !== this.room.hostId) {
      this.send(connection, { type: "error", message: "Only the host can restart" });
      return;
    }

    const n = await this.returnToLobby();
    this.broadcastJson({
      type: "toast",
      message:
        n > 0
          ? `Back to lobby — ${n} watcher${n === 1 ? "" : "s"} joined the table`
          : "Back to lobby",
    });
  }

  /** Host: return to lobby and immediately deal a new game (rematch). */
  private async handlePlayAgain(
    connection: Connection,
    tightDeckMsg?: boolean,
  ) {
    const playerId = (connection.state as ConnState | undefined)?.playerId;
    if (!playerId || playerId !== this.room.hostId) {
      this.send(connection, {
        type: "error",
        message: "Only the host can start another game",
      });
      return;
    }

    const n = await this.returnToLobby();
    const ok = await this.beginGame(tightDeckMsg);
    if (!ok) {
      this.send(connection, {
        type: "error",
        message: "Need at least 2 players (add bots) to start again",
      });
      this.broadcastJson({
        type: "toast",
        message:
          n > 0
            ? `Lobby ready — ${n} watcher${n === 1 ? "" : "s"} joined`
            : "Back to lobby",
      });
      return;
    }
    this.broadcastJson({
      type: "toast",
      message: n > 0 ? `New game — ${n} watcher${n === 1 ? "" : "s"} joined!` : "New game!",
    });
  }

  private async handleLeave(connection: Connection) {
    const st = connection.state as ConnState | undefined;
    const playerId = st?.playerId;
    if (!playerId) return;

    const leaveName = st.name;
    await this.track("player_leave", {
      playerName: leaveName,
      playerId,
      role: st.role,
      meta: { status: this.room.status, explicit: true },
    });

    if (st.role === "spectator") {
      this.room.spectators = this.room.spectators.filter((s) => s.id !== playerId);
    } else if (this.room.status === "lobby") {
      this.room.players = this.room.players.filter((p) => p.id !== playerId);
      if (this.room.hostId === playerId) {
        this.room.hostId =
          this.room.players.find((p) => !p.isBot)?.id ??
          this.room.players[0]?.id ??
          null;
      }
    } else {
      // Explicit Leave mid-game: drop socket + invalidate token (no auto-reclaim)
      const p = this.room.players.find((x) => x.id === playerId);
      if (p && !p.isBot) {
        p.connectionId = null;
        p.sessionToken = undefined;
      }
      if (this.connectedHumansCount() === 0) {
        await this.resetAbandonedGame("force");
      }
    }

    connection.setState(null);
    await this.persist();
    this.broadcastRoom();
  }
}

async function roomPresence(env: Env, code: string): Promise<RoomPresence> {
  const roomId = code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
  const id = env.GameRoom.idFromName(roomId);
  const stub = env.GameRoom.get(id);
  const req = new Request("https://game-room.internal/presence", {
    headers: {
      "x-partykit-room": roomId,
      "x-partykit-namespace": "game-room",
    },
  });
  try {
    const res = await stub.fetch(req);
    if (!res.ok) {
      return { roomId, status: "lobby", humans: [], humanCount: 0 };
    }
    return (await res.json()) as RoomPresence;
  } catch {
    return { roomId, status: "lobby", humans: [], humanCount: 0 };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight for local/dev tooling
    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    // Batch presence for recent-room list: GET /api/rooms?codes=ABC12,XYZ99
    if (request.method === "GET" && url.pathname === "/api/rooms") {
      const raw = url.searchParams.get("codes") || "";
      const codes = [
        ...new Set(
          raw
            .split(",")
            .map((c) => c.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5))
            .filter((c) => c.length >= 4),
        ),
      ].slice(0, 20);

      const rooms = await Promise.all(codes.map((c) => roomPresence(env, c)));
      return Response.json(
        { rooms },
        {
          headers: {
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*",
          },
        },
      );
    }

    // Public analytics dashboard data: GET /api/stats
    if (request.method === "GET" && url.pathname === "/api/stats") {
      const stats = await buildStatsPayload(env.DB);
      return Response.json(stats, {
        headers: {
          "Cache-Control": "public, max-age=15",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    const party = await routePartykitRequest(request, env);
    if (party) return party;

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
