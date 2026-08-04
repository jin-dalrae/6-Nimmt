/**
 * Online Take a Number room — PartyServer Durable Object.
 * Same hosting pattern as Take 5 GameRoom / MrJackRoom.
 */

import { Connection, Server } from "partyserver";
import {
  BOT_NAMES,
  chooseCardForBot,
  chooseRowForBot,
  pickPersonalCardForBot,
} from "./ai";
import {
  chooseCard,
  chooseRowToTake,
  pickPersonalCard,
  setupGame,
  startNextRound,
} from "./engine";
import type {
  TanClientMessage,
  TanLobbyPlayer,
  TanServerMessage,
} from "./protocol";
import { cloneGame, toPublicState } from "./protocol";
import type { GameState } from "./types";
import { Phase } from "./types";

type Env = {
  TakeANumberRoom: DurableObjectNamespace<TakeANumberRoom>;
  ASSETS?: Fetcher;
  GEMINI_API_KEY?: string;
  DB?: D1Database;
};

type ConnState = {
  playerId: string;
  name: string;
};

type Seat = {
  id: string;
  name: string;
  connectionId: string | null;
  isBot: boolean;
  sessionToken?: string;
};

type RoomData = {
  status: "lobby" | "playing" | "ended";
  players: Seat[];
  hostId: string | null;
  game: GameState | null;
};

const MAX_PLAYERS = 4;
const MIN_PLAYERS = 2;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export class TakeANumberRoom extends Server<Env> {
  static options = { hibernate: true };

  room: RoomData = {
    status: "lobby",
    players: [],
    hostId: null,
    game: null,
  };

  private botsBusy = false;

  async onStart() {
    const saved = await this.ctx.storage.get<RoomData>("room");
    if (saved) {
      this.room = {
        status: saved.status ?? "lobby",
        players: Array.isArray(saved.players) ? saved.players : [],
        hostId: saved.hostId ?? null,
        game: saved.game ?? null,
      };
    }
  }

  private async persist() {
    await this.ctx.storage.put("room", this.room);
  }

  private send(conn: Connection, msg: TanServerMessage) {
    conn.send(JSON.stringify(msg));
  }

  private broadcastJson(msg: TanServerMessage, exclude: string[] = []) {
    this.broadcast(JSON.stringify(msg), exclude);
  }

  private lobbyPlayers(): TanLobbyPlayer[] {
    return this.room.players.map((p) => ({
      id: p.id,
      name: p.name,
      connected: p.isBot || p.connectionId !== null,
      isBot: p.isBot,
      isHost: p.id === this.room.hostId,
    }));
  }

  private sessionFor(youId: string): string | undefined {
    return this.room.players.find((p) => p.id === youId)?.sessionToken;
  }

  private ensureToken(seat: Seat): string {
    if (!seat.sessionToken) seat.sessionToken = crypto.randomUUID();
    return seat.sessionToken;
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
      minPlayers: MIN_PLAYERS,
      sessionToken: this.sessionFor(youId),
    });
  }

  private broadcastRoom() {
    for (const conn of this.getConnections<ConnState>()) {
      const st = conn.state;
      if (!st?.playerId) continue;
      this.sendRoom(conn, st.playerId);
    }
  }

  private pushGameState() {
    if (!this.room.game) return;
    if (this.room.game.phase === Phase.Ended) {
      this.room.status = "ended";
    }

    for (const conn of this.getConnections<ConnState>()) {
      const st = conn.state;
      if (!st?.playerId) continue;
      this.send(conn, {
        type: "state",
        status: this.room.game.phase === Phase.Ended ? "ended" : "playing",
        game: toPublicState(this.room.game, st.playerId),
      });
    }
  }

  async onConnect(connection: Connection) {
    this.send(connection, {
      type: "room",
      roomId: this.name,
      status: this.room.status,
      players: this.lobbyPlayers(),
      hostId: this.room.hostId,
      youId: "",
      maxPlayers: MAX_PLAYERS,
      minPlayers: MIN_PLAYERS,
    });
  }

  async onMessage(connection: Connection, raw: string | ArrayBuffer) {
    if (typeof raw !== "string") return;
    let msg: TanClientMessage;
    try {
      msg = JSON.parse(raw) as TanClientMessage;
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
          await this.handleStart(connection);
          break;
        case "addBots":
          await this.handleAddBots(connection, msg.count ?? 1);
          break;
        case "removeBot":
          await this.handleRemoveBot(connection);
          break;
        case "chooseCard":
          await this.handleChooseCard(connection, msg.cardNumber);
          break;
        case "chooseRow":
          await this.handleChooseRow(connection, msg.rowIndex);
          break;
        case "pickPersonal":
          await this.handlePickPersonal(connection, msg.cardNumber);
          break;
        case "startNextRound":
          await this.handleStartNextRound(connection);
          break;
        case "restart":
          await this.handleRestart(connection);
          break;
        case "playAgain":
          await this.handlePlayAgain(connection);
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
    if (!st?.playerId) return;
    const seat = this.room.players.find((p) => p.id === st.playerId);
    if (seat && seat.connectionId === connection.id) {
      seat.connectionId = null;
    }
    if (this.room.status === "lobby") {
      this.room.players = this.room.players.filter(
        (p) => p.isBot || p.connectionId !== null,
      );
      if (this.room.hostId === st.playerId) {
        this.room.hostId =
          this.room.players.find((p) => !p.isBot)?.id ??
          this.room.players[0]?.id ??
          null;
      }
    }
    await this.persist();
    this.broadcastRoom();
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

    if (token) {
      const seat = this.room.players.find((p) => p.sessionToken === token);
      if (seat) {
        if (name !== seat.name) {
          const clash = this.room.players.some(
            (p) =>
              p.id !== seat.id && p.name.toLowerCase() === name.toLowerCase(),
          );
          if (!clash) seat.name = name;
        }
        seat.connectionId = connection.id;
        this.ensureToken(seat);
        connection.setState({
          playerId: seat.id,
          name: seat.name,
        } satisfies ConnState);
        await this.persist();
        this.broadcastRoom();
        this.sendRoom(connection, seat.id);
        if (this.room.game) this.pushGameState();
        this.send(connection, {
          type: "toast",
          message:
            this.room.status === "lobby"
              ? `Rejoined room ${this.name}`
              : "Reconnected",
        });
        return;
      }
    }

    const existing = this.room.players.find(
      (p) => p.connectionId === connection.id,
    );
    if (existing) {
      this.sendRoom(connection, existing.id);
      if (this.room.game) this.pushGameState();
      return;
    }

    const same = this.room.players.find(
      (p) => !p.isBot && p.name.toLowerCase() === name.toLowerCase(),
    );
    if (same) {
      if (same.connectionId && same.connectionId !== connection.id) {
        const live = this.getConnection(same.connectionId);
        if (live) {
          this.send(connection, {
            type: "error",
            message: `"${same.name}" is already in this room. Pick another name.`,
          });
          return;
        }
      }
      same.connectionId = connection.id;
      this.ensureToken(same);
      connection.setState({
        playerId: same.id,
        name: same.name,
      } satisfies ConnState);
      await this.persist();
      this.broadcastRoom();
      this.sendRoom(connection, same.id);
      if (this.room.game) this.pushGameState();
      return;
    }

    if (this.room.status !== "lobby") {
      this.send(connection, {
        type: "error",
        message:
          "Game in progress — wait for lobby or reconnect with the same device/name",
      });
      return;
    }

    if (this.room.players.length >= MAX_PLAYERS) {
      this.send(connection, {
        type: "error",
        message: `Room is full (${MAX_PLAYERS} players)`,
      });
      return;
    }

    const id = crypto.randomUUID();
    const session = crypto.randomUUID();
    this.room.players.push({
      id,
      name,
      connectionId: connection.id,
      isBot: false,
      sessionToken: session,
    });
    if (!this.room.hostId) this.room.hostId = id;

    connection.setState({ playerId: id, name } satisfies ConnState);
    await this.persist();
    this.broadcastRoom();
    this.sendRoom(connection, id);
    this.send(connection, {
      type: "toast",
      message: `Joined room ${this.name}`,
    });
    this.broadcastJson(
      { type: "toast", message: `${name} joined` },
      [connection.id],
    );
  }

  private assertHost(connection: Connection): string {
    const playerId = (connection.state as ConnState | undefined)?.playerId;
    if (!playerId || playerId !== this.room.hostId) {
      throw new Error("Only the host can do that");
    }
    return playerId;
  }

  private async handleAddBots(connection: Connection, count: number) {
    this.assertHost(connection);
    if (this.room.status !== "lobby") {
      throw new Error("Can only add bots in the lobby");
    }
    const n = Math.max(1, Math.min(3, Math.floor(count)));
    let added = 0;
    for (let i = 0; i < n && this.room.players.length < MAX_PLAYERS; i++) {
      const usedNames = new Set(this.room.players.map((p) => p.name));
      const botName =
        BOT_NAMES.find((nm) => !usedNames.has(nm)) ?? `Bot ${this.room.players.length + 1}`;
      this.room.players.push({
        id: crypto.randomUUID(),
        name: botName,
        connectionId: null,
        isBot: true,
      });
      added++;
    }
    await this.persist();
    this.broadcastRoom();
    if (added > 0) {
      this.broadcastJson({
        type: "toast",
        message: `Added ${added} bot${added === 1 ? "" : "s"}`,
      });
    }
  }

  private async handleRemoveBot(connection: Connection) {
    this.assertHost(connection);
    if (this.room.status !== "lobby") {
      throw new Error("Can only remove bots in the lobby");
    }
    const idx = [...this.room.players]
      .map((p, i) => ({ p, i }))
      .reverse()
      .find((x) => x.p.isBot)?.i;
    if (idx === undefined) {
      throw new Error("No bots to remove");
    }
    const [removed] = this.room.players.splice(idx, 1);
    await this.persist();
    this.broadcastRoom();
    this.broadcastJson({
      type: "toast",
      message: `Removed ${removed?.name ?? "bot"}`,
    });
  }

  private async handleStart(connection: Connection) {
    this.assertHost(connection);
    if (this.room.status !== "lobby") {
      throw new Error("Game already started");
    }
    if (this.room.players.length < MIN_PLAYERS) {
      throw new Error(`Need at least ${MIN_PLAYERS} players (add bots or friends)`);
    }

    const defs = this.room.players.map((p) => ({
      id: p.id,
      name: p.name,
      isBot: p.isBot,
    }));
    this.room.game = setupGame(defs);
    this.room.status = "playing";
    await this.persist();
    this.broadcastRoom();
    this.pushGameState();
    this.broadcastJson({ type: "toast", message: "Game started!" });
    void this.runBots();
  }

  private playerIndex(playerId: string): number {
    if (!this.room.game) return -1;
    return this.room.game.players.findIndex((p) => p.id === playerId);
  }

  private async handleChooseCard(connection: Connection, cardNumber: number) {
    const playerId = (connection.state as ConnState | undefined)?.playerId;
    if (!playerId || !this.room.game) throw new Error("No active game");
    if (this.room.game.phase !== Phase.ChooseCard) {
      throw new Error("Not choosing cards right now");
    }
    const idx = this.playerIndex(playerId);
    if (idx < 0) throw new Error("Not in this game");
    const p = this.room.game.players[idx]!;
    if (p.faceDownCard) throw new Error("You already chose a card");

    this.room.game = chooseCard(cloneGame(this.room.game), idx, cardNumber);
    if (!this.room.game.players[idx]?.faceDownCard) {
      throw new Error("Invalid card");
    }
    await this.persist();
    this.pushGameState();
    void this.runBots();
  }

  private async handleChooseRow(connection: Connection, rowIndex: number) {
    const playerId = (connection.state as ConnState | undefined)?.playerId;
    if (!playerId || !this.room.game) throw new Error("No active game");
    if (this.room.game.phase !== Phase.PlaceCard) {
      throw new Error("Not picking a row right now");
    }
    if (this.room.game.activePlayerIndex !== this.playerIndex(playerId)) {
      throw new Error("Not your turn to take a row");
    }
    const idx = this.playerIndex(playerId);
    this.room.game = chooseRowToTake(cloneGame(this.room.game), idx, rowIndex);
    await this.persist();
    this.pushGameState();
    void this.runBots();
  }

  private async handlePickPersonal(connection: Connection, cardNumber: number) {
    const playerId = (connection.state as ConnState | undefined)?.playerId;
    if (!playerId || !this.room.game) throw new Error("No active game");
    if (this.room.game.phase !== Phase.PickPersonalCard) {
      throw new Error("Not picking a personal card right now");
    }
    if (this.room.game.activePlayerIndex !== this.playerIndex(playerId)) {
      throw new Error("Not your turn");
    }
    const idx = this.playerIndex(playerId);
    this.room.game = pickPersonalCard(cloneGame(this.room.game), idx, cardNumber);
    if (this.room.game.phase === Phase.Ended) this.room.status = "ended";
    await this.persist();
    this.broadcastRoom();
    this.pushGameState();
    void this.runBots();
  }

  private async handleStartNextRound(connection: Connection) {
    this.assertHost(connection);
    if (!this.room.game || this.room.game.phase !== Phase.BetweenRounds) {
      throw new Error("Not between rounds");
    }
    this.room.game = startNextRound(cloneGame(this.room.game));
    this.room.status = "playing";
    await this.persist();
    this.broadcastRoom();
    this.pushGameState();
    this.broadcastJson({
      type: "toast",
      message: `Round ${this.room.game.currentRound} started!`,
    });
    void this.runBots();
  }

  private async handleRestart(connection: Connection) {
    this.assertHost(connection);
    this.room.game = null;
    this.room.status = "lobby";
    // Drop bots stay; humans stay for next game
    await this.persist();
    this.broadcastRoom();
    this.broadcastJson({ type: "toast", message: "Back to lobby" });
  }

  private async handlePlayAgain(connection: Connection) {
    this.assertHost(connection);
    if (this.room.players.length < MIN_PLAYERS) {
      throw new Error(`Need at least ${MIN_PLAYERS} players`);
    }
    const defs = this.room.players.map((p) => ({
      id: p.id,
      name: p.name,
      isBot: p.isBot,
    }));
    this.room.game = setupGame(defs);
    this.room.status = "playing";
    await this.persist();
    this.broadcastRoom();
    this.pushGameState();
    this.broadcastJson({ type: "toast", message: "New game!" });
    void this.runBots();
  }

  private async handleLeave(connection: Connection) {
    const st = connection.state as ConnState | undefined;
    if (!st?.playerId) return;
    if (this.room.status === "lobby") {
      this.room.players = this.room.players.filter((p) => p.id !== st.playerId);
      if (this.room.hostId === st.playerId) {
        this.room.hostId =
          this.room.players.find((p) => !p.isBot)?.id ??
          this.room.players[0]?.id ??
          null;
      }
    } else {
      const seat = this.room.players.find((p) => p.id === st.playerId);
      if (seat) seat.connectionId = null;
    }
    connection.setState(null as unknown as ConnState);
    await this.persist();
    this.broadcastRoom();
  }

  /** Drive bot turns until a human must act (or game pauses). */
  private async runBots() {
    if (this.botsBusy) return;
    this.botsBusy = true;
    try {
      let guard = 0;
      while (this.room.game && guard++ < 40) {
        const G = this.room.game;
        if (
          G.phase === Phase.Ended ||
          G.phase === Phase.BetweenRounds
        ) {
          break;
        }

        if (G.phase === Phase.ChooseCard) {
          const botsNeeding = G.players
            .map((p, i) => ({ p, i }))
            .filter((x) => x.p.isBot && !x.p.faceDownCard);
          if (botsNeeding.length === 0) break;

          await sleep(450);
          if (!this.room.game || this.room.game.phase !== Phase.ChooseCard) {
            continue;
          }
          let next = cloneGame(this.room.game);
          for (const { i } of botsNeeding) {
            const card = chooseCardForBot(next, i);
            if (card) next = chooseCard(next, i, card.number);
          }
          this.room.game = next;
          await this.persist();
          this.pushGameState();
          continue;
        }

        if (
          G.phase === Phase.PlaceCard &&
          G.activePlayerIndex !== null
        ) {
          const p = G.players[G.activePlayerIndex];
          if (!p?.isBot) break;
          await sleep(500);
          if (
            !this.room.game ||
            this.room.game.phase !== Phase.PlaceCard ||
            this.room.game.activePlayerIndex !== G.activePlayerIndex
          ) {
            continue;
          }
          const row = chooseRowForBot(this.room.game);
          this.room.game = chooseRowToTake(
            cloneGame(this.room.game),
            G.activePlayerIndex,
            row,
          );
          await this.persist();
          this.pushGameState();
          continue;
        }

        if (
          G.phase === Phase.PickPersonalCard &&
          G.activePlayerIndex !== null
        ) {
          const p = G.players[G.activePlayerIndex];
          if (!p?.isBot) break;
          await sleep(550);
          if (
            !this.room.game ||
            this.room.game.phase !== Phase.PickPersonalCard ||
            this.room.game.activePlayerIndex !== G.activePlayerIndex
          ) {
            continue;
          }
          const card = pickPersonalCardForBot(
            this.room.game,
            G.activePlayerIndex,
          );
          if (!card) break;
          this.room.game = pickPersonalCard(
            cloneGame(this.room.game),
            G.activePlayerIndex,
            card.number,
          );
          if (this.room.game.phase === Phase.Ended) this.room.status = "ended";
          await this.persist();
          this.broadcastRoom();
          this.pushGameState();
          continue;
        }

        break;
      }
    } finally {
      this.botsBusy = false;
    }
  }
}
