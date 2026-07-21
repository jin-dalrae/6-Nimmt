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
  autoPlaceIfPossible,
  cloneGame,
  ended,
  move,
  setup,
  toPublicState,
} from "./game/engine";
import type { GameState } from "./game/types";
import { MoveName, Phase } from "./game/types";
import type { ClientMessage, LobbyPlayer, ServerMessage } from "./game/protocol";

type Env = {
  GameRoom: DurableObjectNamespace<GameRoom>;
  ASSETS?: Fetcher;
  GEMINI_API_KEY?: string;
};

type ConnState = {
  playerId: string;
  name: string;
};

type RoomPlayer = {
  id: string;
  name: string;
  connectionId: string | null;
  isBot: boolean;
};

type RoomData = {
  status: "lobby" | "playing" | "ended";
  players: RoomPlayer[];
  hostId: string | null;
  game: GameState | null;
  seats: string[];
  aiStyle: AiStyle;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const MAX_PLAYERS = 10;
const MIN_PLAYERS = 2;

export class GameRoom extends Server<Env> {
  static options = { hibernate: true };

  room: RoomData = {
    status: "lobby",
    players: [],
    hostId: null,
    game: null,
    seats: [],
    aiStyle: "solid",
  };

  private botsBusy = false;

  async onStart() {
    const saved = await this.ctx.storage.get<RoomData>("room");
    if (saved) {
      // Migrate older rooms missing isBot / aiStyle
      this.room = {
        ...saved,
        aiStyle: isAiStyle(saved.aiStyle) ? saved.aiStyle : "solid",
        players: saved.players.map((p) => ({
          ...p,
          isBot: "isBot" in p ? Boolean((p as RoomPlayer).isBot) : false,
        })),
      };
    }
  }

  private apiKey(): string | undefined {
    const key = this.env.GEMINI_API_KEY?.trim();
    return key || undefined;
  }

  private async persist() {
    await this.ctx.storage.put("room", this.room);
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
    }));
  }

  private sendRoom(conn: Connection, youId: string) {
    this.send(conn, {
      type: "room",
      roomId: this.name,
      status: this.room.status,
      players: this.lobbyPlayers(),
      hostId: this.room.hostId,
      youId,
      maxPlayers: MAX_PLAYERS,
      hasAiKey: Boolean(this.apiKey()),
      aiStyle: this.room.aiStyle,
    });
  }

  private broadcastRoom() {
    for (const conn of this.getConnections<ConnState>()) {
      const youId = conn.state?.playerId;
      if (!youId) continue;
      this.sendRoom(conn, youId);
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

    for (const conn of this.getConnections<ConnState>()) {
      const playerId = conn.state?.playerId;
      if (!playerId) continue;
      const idx = this.seatIndex(playerId);
      if (idx < 0) continue;

      const publicState = toPublicState(this.room.game, idx);
      publicState.players.forEach((p, i) => {
        p.isBot = this.isBotSeat(i);
      });
      const status = publicState.ended ? "ended" : "playing";
      if (publicState.ended) this.room.status = "ended";

      this.send(conn, {
        type: "state",
        game: publicState,
        status,
      });
    }
  }

  private async applyAndContinue(next: GameState) {
    this.room.game = next;
    if (ended(next)) this.room.status = "ended";
    await this.persist();
    this.pushGameState();
    if (this.room.status === "ended") {
      this.broadcastRoom();
      this.broadcastJson({ type: "toast", message: "Game over!" });
      return;
    }
    await this.runBots();
  }

  /** Let Gemini/heuristic bots act until humans must move. */
  private async runBots() {
    if (this.botsBusy || !this.room.game || this.room.status !== "playing") return;
    this.botsBusy = true;
    const style = this.room.aiStyle;
    const pace = botPaceMs(style);

    try {
      let guard = 0;
      while (this.room.game && this.room.status === "playing" && guard++ < 40) {
        let G = this.room.game;
        if (ended(G)) break;

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

          await sleep(pace);

          // Bots choose in parallel (same board snapshot), then apply sequentially
          const picks = await Promise.all(
            botIndexes.map(async (i) => ({
              i,
              card: await chooseCardForBot(cloneGame(G), i, this.apiKey(), style),
            })),
          );

          let next = cloneGame(G);
          for (const { i, card } of picks) {
            // Re-validate against current next state
            const still = next.players[i].hand.find((c) => c.number === card.number);
            if (!still || next.players[i].faceDownCard) continue;
            next = move(next, { name: MoveName.ChooseCard, data: still }, i);
          }

          if (next.phase === Phase.PlaceCard) {
            next = autoPlaceIfPossible(next);
          }

          this.room.game = next;
          if (ended(next)) {
            this.room.status = "ended";
            await this.persist();
            this.pushGameState();
            this.broadcastRoom();
            this.broadcastJson({ type: "toast", message: "Game over!" });
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

        await sleep(Math.round(pace * 0.7));

        const choice = await placeRowForBot(
          cloneGame(G),
          actor,
          this.apiKey(),
          style,
        );
        let next = move(
          cloneGame(G),
          { name: MoveName.PlaceCard, data: choice },
          actor,
        );
        next = autoPlaceIfPossible(next);

        this.room.game = next;
        if (ended(next)) {
          this.room.status = "ended";
          await this.persist();
          this.pushGameState();
          this.broadcastRoom();
          this.broadcastJson({ type: "toast", message: "Game over!" });
          return;
        }
        await this.persist();
        this.pushGameState();
      }
    } finally {
      this.botsBusy = false;
    }
  }

  onConnect(connection: Connection) {
    this.send(connection, {
      type: "room",
      roomId: this.name,
      status: this.room.status,
      players: this.lobbyPlayers(),
      hostId: this.room.hostId,
      youId: "",
      maxPlayers: MAX_PLAYERS,
      hasAiKey: Boolean(this.apiKey()),
      aiStyle: this.room.aiStyle,
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
          await this.handleJoin(connection, msg.name);
          break;
        case "start":
          await this.handleStart(connection);
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
        case "chooseCard":
          await this.handleChoose(connection, msg.cardNumber);
          break;
        case "placeCard":
          await this.handlePlace(connection, msg.row, msg.replace);
          break;
        case "restart":
          await this.handleRestart(connection);
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
    const playerId = (connection.state as ConnState | undefined)?.playerId;
    if (!playerId) return;

    const player = this.room.players.find((p) => p.id === playerId);
    if (player && player.connectionId === connection.id) {
      player.connectionId = null;
    }

    if (this.room.status === "lobby") {
      // Keep bots; drop only disconnected humans
      this.room.players = this.room.players.filter(
        (p) => p.isBot || p.connectionId !== null,
      );
      if (this.room.hostId === playerId) {
        this.room.hostId =
          this.room.players.find((p) => !p.isBot)?.id ??
          this.room.players[0]?.id ??
          null;
      }
    }

    await this.persist();
    this.broadcastRoom();
  }

  private async handleJoin(connection: Connection, rawName: string) {
    const name = rawName.trim().slice(0, 20);
    if (!name) {
      this.send(connection, { type: "error", message: "Enter a name" });
      return;
    }

    const existingByConn = this.room.players.find((p) => p.connectionId === connection.id);
    if (existingByConn) {
      connection.setState({
        playerId: existingByConn.id,
        name: existingByConn.name,
      } satisfies ConnState);
      this.sendRoom(connection, existingByConn.id);
      if (this.room.game) this.pushGameState();
      return;
    }

    const reclaim = this.room.players.find(
      (p) =>
        !p.isBot &&
        p.connectionId === null &&
        p.name.toLowerCase() === name.toLowerCase(),
    );
    if (reclaim) {
      reclaim.connectionId = connection.id;
      connection.setState({ playerId: reclaim.id, name: reclaim.name } satisfies ConnState);
      await this.persist();
      this.broadcastRoom();
      if (this.room.game) this.pushGameState();
      this.send(connection, { type: "toast", message: "Reconnected" });
      return;
    }

    if (this.room.status !== "lobby") {
      this.send(connection, {
        type: "error",
        message: "Game already in progress — join with the same name to reconnect",
      });
      return;
    }

    if (this.room.players.length >= MAX_PLAYERS) {
      this.send(connection, { type: "error", message: "Room is full" });
      return;
    }

    if (this.room.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      this.send(connection, { type: "error", message: "Name already taken in this room" });
      return;
    }

    const id = crypto.randomUUID();
    this.room.players.push({ id, name, connectionId: connection.id, isBot: false });
    if (!this.room.hostId || this.room.players.find((p) => p.id === this.room.hostId)?.isBot) {
      this.room.hostId = id;
    }

    connection.setState({ playerId: id, name } satisfies ConnState);
    await this.persist();
    this.broadcastRoom();
    this.send(connection, { type: "toast", message: `Joined room ${this.name}` });
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
      this.room.players.push({
        id: crypto.randomUUID(),
        name,
        connectionId: null,
        isBot: true,
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
      message: `AI style: ${labels[style]}`,
    });
  }

  private async handleStart(connection: Connection) {
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

    this.room.seats = this.room.players.map((p) => p.id);
    const names = this.room.players.map((p) => p.name);
    this.room.game = setup(names.length, { points: 66, handSize: 10 }, undefined, names);
    this.room.status = "playing";
    await this.persist();
    this.broadcastRoom();
    this.pushGameState();
    const styleLabel = this.room.aiStyle;
    this.broadcastJson({
      type: "toast",
      message: this.apiKey()
        ? `Game started — Gemini (${styleLabel}) thinking…`
        : `Game started — bots (${styleLabel} heuristic; set GEMINI_API_KEY for smarter AI)`,
    });
    await this.runBots();
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

  private async handleRestart(connection: Connection) {
    const playerId = (connection.state as ConnState | undefined)?.playerId;
    if (!playerId || playerId !== this.room.hostId) {
      this.send(connection, { type: "error", message: "Only the host can restart" });
      return;
    }

    this.room.status = "lobby";
    this.room.game = null;
    this.room.seats = [];
    // Keep bots; drop only disconnected humans
    this.room.players = this.room.players.filter(
      (p) => p.isBot || p.connectionId !== null,
    );
    if (!this.room.players.find((p) => p.id === this.room.hostId)) {
      this.room.hostId =
        this.room.players.find((p) => !p.isBot)?.id ??
        this.room.players[0]?.id ??
        null;
    }

    await this.persist();
    this.broadcastRoom();
    this.broadcastJson({ type: "toast", message: "Back to lobby" });
  }

  private async handleLeave(connection: Connection) {
    const playerId = (connection.state as ConnState | undefined)?.playerId;
    if (!playerId) return;

    if (this.room.status === "lobby") {
      this.room.players = this.room.players.filter((p) => p.id !== playerId);
      if (this.room.hostId === playerId) {
        this.room.hostId =
          this.room.players.find((p) => !p.isBot)?.id ??
          this.room.players[0]?.id ??
          null;
      }
    } else {
      const p = this.room.players.find((x) => x.id === playerId);
      if (p && !p.isBot) p.connectionId = null;
    }

    connection.setState(null);
    await this.persist();
    this.broadcastRoom();
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const party = await routePartykitRequest(request, env);
    if (party) return party;

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
