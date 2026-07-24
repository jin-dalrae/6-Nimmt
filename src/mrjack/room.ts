/**
 * Online Mr. Jack room — PartyServer Durable Object (2 players).
 * Same hosting pattern as 6 Nimmt GameRoom.
 */

import { Connection, Server } from "partyserver";
import {
  accuse,
  createGame,
  moveCharacter,
  resolveCall,
  selectCharacter,
  skipPower,
  usePower,
} from "./engine";
import type {
  MrJackClientMessage,
  MrJackLobbyPlayer,
  MrJackServerMessage,
} from "./protocol";
import { isSeatTurn, toPublicMrJack } from "./public";
import type { CharId, GameState, HexKey, Role } from "./types";

type Env = {
  MrJackRoom: DurableObjectNamespace<MrJackRoom>;
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
  role: Role | null;
  sessionToken?: string;
};

type RoomData = {
  status: "lobby" | "playing" | "ended";
  players: Seat[];
  hostId: string | null;
  game: GameState | null;
};

const MAX_PLAYERS = 2;

export class MrJackRoom extends Server<Env> {
  static options = { hibernate: true };

  room: RoomData = {
    status: "lobby",
    players: [],
    hostId: null,
    game: null,
  };

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

  private send(conn: Connection, msg: MrJackServerMessage) {
    conn.send(JSON.stringify(msg));
  }

  private broadcastJson(msg: MrJackServerMessage, exclude: string[] = []) {
    this.broadcast(JSON.stringify(msg), exclude);
  }

  private lobbyPlayers(): MrJackLobbyPlayer[] {
    return this.room.players.map((p) => ({
      id: p.id,
      name: p.name,
      connected: p.connectionId !== null,
      role: p.role,
      isHost: p.id === this.room.hostId,
    }));
  }

  private sessionFor(youId: string): string | undefined {
    return this.room.players.find((p) => p.id === youId)?.sessionToken;
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

  private seatRole(playerId: string): Role | null {
    return this.room.players.find((p) => p.id === playerId)?.role ?? null;
  }

  private pushGameState() {
    if (!this.room.game) return;
    const ended = this.room.game.phase === "ended";
    if (ended) this.room.status = "ended";

    for (const conn of this.getConnections<ConnState>()) {
      const st = conn.state;
      if (!st?.playerId) continue;
      const role = this.seatRole(st.playerId);
      this.send(conn, {
        type: "state",
        status: ended ? "ended" : "playing",
        game: toPublicMrJack(this.room.game, role),
      });
    }
  }

  private ensureToken(seat: Seat): string {
    if (!seat.sessionToken) seat.sessionToken = crypto.randomUUID();
    return seat.sessionToken;
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
    });
  }

  async onMessage(connection: Connection, raw: string | ArrayBuffer) {
    if (typeof raw !== "string") return;
    let msg: MrJackClientMessage;
    try {
      msg = JSON.parse(raw) as MrJackClientMessage;
    } catch {
      this.send(connection, { type: "error", message: "Invalid message" });
      return;
    }

    try {
      switch (msg.type) {
        case "join":
          await this.handleJoin(connection, msg.name, msg.sessionToken, msg.preferRole);
          break;
        case "setRole":
          await this.handleSetRole(connection, msg.role);
          break;
        case "start":
          await this.handleStart(connection);
          break;
        case "selectChar":
          await this.handleSelect(connection, msg.charId);
          break;
        case "move":
          await this.handleMove(connection, msg.hex);
          break;
        case "power":
          await this.handlePower(connection, msg.target);
          break;
        case "skipPower":
          await this.handleSkipPower(connection);
          break;
        case "resolveCall":
          await this.handleResolveCall(connection);
          break;
        case "accuse":
          await this.handleAccuse(connection, msg.charId);
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
    const st = connection.state as ConnState | undefined;
    if (!st?.playerId) return;
    const seat = this.room.players.find((p) => p.id === st.playerId);
    if (seat && seat.connectionId === connection.id) {
      seat.connectionId = null;
    }
    if (this.room.status === "lobby") {
      this.room.players = this.room.players.filter((p) => p.connectionId !== null);
      if (this.room.hostId === st.playerId) {
        this.room.hostId = this.room.players[0]?.id ?? null;
      }
    }
    await this.persist();
    this.broadcastRoom();
  }

  private async handleJoin(
    connection: Connection,
    rawName: string,
    sessionToken?: string,
    preferRole?: Role,
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

    // Reclaim by session
    if (token) {
      const seat = this.room.players.find((p) => p.sessionToken === token);
      if (seat) {
        if (name !== seat.name) {
          const clash = this.room.players.some(
            (p) => p.id !== seat.id && p.name.toLowerCase() === name.toLowerCase(),
          );
          if (!clash) seat.name = name;
        }
        seat.connectionId = connection.id;
        this.ensureToken(seat);
        connection.setState({ playerId: seat.id, name: seat.name } satisfies ConnState);
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

    // Already on this socket
    const existing = this.room.players.find((p) => p.connectionId === connection.id);
    if (existing) {
      this.sendRoom(connection, existing.id);
      if (this.room.game) this.pushGameState();
      return;
    }

    // Reclaim offline same name
    const same = this.room.players.find(
      (p) => p.name.toLowerCase() === name.toLowerCase(),
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
      connection.setState({ playerId: same.id, name: same.name } satisfies ConnState);
      await this.persist();
      this.broadcastRoom();
      this.sendRoom(connection, same.id);
      if (this.room.game) this.pushGameState();
      return;
    }

    if (this.room.status !== "lobby") {
      this.send(connection, {
        type: "error",
        message: "Game in progress — wait for lobby or use the same name/device to reconnect",
      });
      return;
    }

    if (this.room.players.length >= MAX_PLAYERS) {
      this.send(connection, { type: "error", message: "Room is full (2 players)" });
      return;
    }

    const id = crypto.randomUUID();
    const session = crypto.randomUUID();
    let role: Role | null = null;
    if (preferRole === "detective" || preferRole === "jack") {
      const taken = this.room.players.some((p) => p.role === preferRole);
      if (!taken) role = preferRole;
    }
    // Auto-assign remaining role when one seat is taken
    if (!role && this.room.players.length === 1) {
      const other = this.room.players[0]!.role;
      if (other === "detective") role = "jack";
      else if (other === "jack") role = "detective";
    }
    if (!role && this.room.players.length === 0) {
      role = preferRole === "jack" ? "jack" : "detective";
    }

    this.room.players.push({
      id,
      name,
      connectionId: connection.id,
      role,
      sessionToken: session,
    });
    if (!this.room.hostId) this.room.hostId = id;

    connection.setState({ playerId: id, name } satisfies ConnState);
    await this.persist();
    this.broadcastRoom();
    this.sendRoom(connection, id);
    this.send(connection, {
      type: "toast",
      message: `Joined ${this.name} as ${role === "jack" ? "Mr. Jack" : role === "detective" ? "Detective" : "…"}`,
    });
    this.broadcastJson({
      type: "toast",
      message: `${name} joined`,
    }, [connection.id]);
  }

  private async handleSetRole(connection: Connection, role: Role) {
    const playerId = (connection.state as ConnState | undefined)?.playerId;
    if (!playerId || this.room.status !== "lobby") {
      this.send(connection, { type: "error", message: "Can only pick a role in lobby" });
      return;
    }
    if (role !== "detective" && role !== "jack") {
      this.send(connection, { type: "error", message: "Invalid role" });
      return;
    }
    const seat = this.room.players.find((p) => p.id === playerId);
    if (!seat) return;

    const other = this.room.players.find((p) => p.id !== playerId && p.role === role);
    if (other) {
      // Swap roles if the other seat holds this one
      other.role = seat.role;
    }
    seat.role = role;
    await this.persist();
    this.broadcastRoom();
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
    if (this.room.players.length < 2) {
      this.send(connection, {
        type: "error",
        message: "Need 2 players — share the room code",
      });
      return;
    }

    // Ensure both roles assigned and distinct
    const p0 = this.room.players[0]!;
    const p1 = this.room.players[1]!;
    if (!p0.role && !p1.role) {
      p0.role = "detective";
      p1.role = "jack";
    } else if (!p0.role) {
      p0.role = p1.role === "detective" ? "jack" : "detective";
    } else if (!p1.role) {
      p1.role = p0.role === "detective" ? "jack" : "detective";
    } else if (p0.role === p1.role) {
      p1.role = p0.role === "detective" ? "jack" : "detective";
    }

    // createGame stores humanRole for AI; online both humans — vsAi false
    this.room.game = createGame("detective", false);
    // Clear AI-centric log lines; write online intro
    const jackSeat = this.room.players.find((p) => p.role === "jack");
    this.room.game.log = [
      `Online game in room ${this.name}.`,
      `${p0.name} is ${p0.role === "jack" ? "Mr. Jack" : "Detective"}; ${p1.name} is ${p1.role === "jack" ? "Mr. Jack" : "Detective"}.`,
      `Round 1 — ${this.room.game.currentRole} picks a character.`,
    ];
    // Jack-only secret is applied in public view, not shared log
    void jackSeat;

    this.room.status = "playing";
    await this.persist();
    this.broadcastRoom();
    this.pushGameState();
    this.broadcastJson({ type: "toast", message: "Investigation begins!" });
  }

  private assertYourTurn(playerId: string): Role {
    if (!this.room.game || this.room.status === "lobby") {
      throw new Error("No active game");
    }
    const role = this.seatRole(playerId);
    if (!role) throw new Error("You have no role");
    if (!isSeatTurn(this.room.game, role)) {
      throw new Error("Not your turn");
    }
    return role;
  }

  private async applyGame(next: GameState) {
    this.room.game = next;
    if (next.phase === "ended") this.room.status = "ended";
    await this.persist();
    this.pushGameState();
    if (this.room.status === "ended") {
      this.broadcastRoom();
      this.broadcastJson({
        type: "toast",
        message: next.detectiveWon ? "Detective wins!" : "Mr. Jack wins!",
      });
    }
  }

  private async handleSelect(connection: Connection, charId: CharId) {
    const playerId = (connection.state as ConnState | undefined)?.playerId;
    if (!playerId) return;
    this.assertYourTurn(playerId);
    const before = this.room.game!;
    if (before.phase !== "selectChar") throw new Error("Not selecting a character");
    const next = selectCharacter(before, charId);
    if (next === before || next.selected !== charId) {
      throw new Error("Illegal character");
    }
    await this.applyGame(next);
  }

  private async handleMove(connection: Connection, hex: HexKey) {
    const playerId = (connection.state as ConnState | undefined)?.playerId;
    if (!playerId) return;
    this.assertYourTurn(playerId);
    const before = this.room.game!;
    if (before.phase !== "move") throw new Error("Not moving");
    const next = moveCharacter(before, hex);
    if (next === before) throw new Error("Illegal move");
    await this.applyGame(next);
  }

  private async handlePower(connection: Connection, target: string) {
    const playerId = (connection.state as ConnState | undefined)?.playerId;
    if (!playerId) return;
    this.assertYourTurn(playerId);
    const before = this.room.game!;
    if (before.phase !== "power") throw new Error("No power to use");
    const next = usePower(before, target);
    if (next === before) throw new Error("Illegal power target");
    await this.applyGame(next);
  }

  private async handleSkipPower(connection: Connection) {
    const playerId = (connection.state as ConnState | undefined)?.playerId;
    if (!playerId) return;
    this.assertYourTurn(playerId);
    const before = this.room.game!;
    const next = skipPower(before);
    if (next === before) throw new Error("Cannot skip power now");
    await this.applyGame(next);
  }

  private async handleResolveCall(connection: Connection) {
    const playerId = (connection.state as ConnState | undefined)?.playerId;
    if (!playerId) return;
    // Either player may resolve the call
    if (!this.room.game || this.room.game.phase !== "call") {
      throw new Error("No witness call to resolve");
    }
    const next = resolveCall(this.room.game);
    await this.applyGame(next);
  }

  private async handleAccuse(connection: Connection, charId: CharId) {
    const playerId = (connection.state as ConnState | undefined)?.playerId;
    if (!playerId) return;
    const role = this.seatRole(playerId);
    if (role !== "detective") throw new Error("Only the Detective can accuse");
    if (!this.room.game) throw new Error("No game");
    const before = this.room.game;
    const next = accuse(before, charId);
    // Engine returns same reference only if phase blocks; otherwise always clones
    if (next.phase === before.phase && next.accusationsLeft === before.accusationsLeft && next.detectiveWon === before.detectiveWon) {
      throw new Error("Cannot accuse that character right now");
    }
    await this.applyGame(next);
  }

  private async handleRestart(connection: Connection) {
    const playerId = (connection.state as ConnState | undefined)?.playerId;
    if (!playerId || playerId !== this.room.hostId) {
      this.send(connection, { type: "error", message: "Only the host can return to lobby" });
      return;
    }
    this.room.status = "lobby";
    this.room.game = null;
    this.room.players = this.room.players.filter((p) => p.connectionId !== null);
    if (!this.room.players.find((p) => p.id === this.room.hostId)) {
      this.room.hostId = this.room.players[0]?.id ?? null;
    }
    await this.persist();
    this.broadcastRoom();
    this.broadcastJson({ type: "toast", message: "Back to lobby" });
  }

  private async handleLeave(connection: Connection) {
    const st = connection.state as ConnState | undefined;
    if (!st?.playerId) return;
    if (this.room.status === "lobby") {
      this.room.players = this.room.players.filter((p) => p.id !== st.playerId);
      if (this.room.hostId === st.playerId) {
        this.room.hostId = this.room.players[0]?.id ?? null;
      }
    } else {
      const seat = this.room.players.find((p) => p.id === st.playerId);
      if (seat) {
        seat.connectionId = null;
        seat.sessionToken = undefined;
      }
    }
    connection.setState(null);
    await this.persist();
    this.broadcastRoom();
  }
}
