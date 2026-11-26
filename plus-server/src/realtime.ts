import { newId } from "./db.ts";

import type { ServerResponse } from "node:http";
import type { WebSocketConnection } from "./websocket.ts";

/** How a connection delivers events: an SSE stream or a WebSocket. */
export type Transport = {
  send: (event: string, data: unknown) => void;
  /** Keeps idle proxies from dropping the connection. */
  heartbeat: () => void;
  close: () => void;
  /** Bytes waiting to be flushed to a slow client. */
  backlog: () => number;
};

/**
 * One open realtime connection. Each browser tab viewing a cloud scene holds
 * one (a WebSocket, or an SSE stream as the fallback); it carries scene
 * updates, presence, comment events and the WebRTC signaling for voice
 * hangouts and screen sharing.
 */
export type Connection = {
  id: string;
  channel: string;
  userId: string | null;
  name: string;
  avatarUrl: string | null;
  color: string;
  transport: Transport;
  inHangout: boolean;
  sharingScreen: boolean;
  cameraOn: boolean;
  /**
   * Ids of the media streams carrying this peer's camera and screen, so
   * receivers can tell the two video tracks apart (including late joiners).
   */
  cameraStreamId: string | null;
  screenStreamId: string | null;
  /** Joined through a presentation-only link: gets slides, never the scene. */
  restricted: boolean;
  /** This connection is running a presentation, on slide `slide`. */
  presenting: boolean;
  slide: number;
};

export type ConnectOptions = {
  /** Presentation-only viewer: see `Connection.restricted`. */
  restricted?: boolean;
};

/** Drop clients that fall this far behind rather than buffering forever. */
const MAX_BACKLOG_BYTES = 16 * 1024 * 1024;

export type Participant = {
  connectionId: string;
  userId: string | null;
  name: string;
  avatarUrl: string | null;
  color: string;
  inHangout: boolean;
  sharingScreen: boolean;
  cameraOn: boolean;
  cameraStreamId: string | null;
  screenStreamId: string | null;
  presenting: boolean;
  slide: number;
};

const COLORS = [
  "#e03131",
  "#2f9e44",
  "#1971c2",
  "#f08c00",
  "#9c36b5",
  "#0c8599",
  "#c2255c",
  "#5c940d",
];

/** Signal types a client may send to one peer (`to`) or broadcast. */
export const TARGETED_SIGNALS = [
  "rtc-offer",
  "rtc-answer",
  "rtc-ice",
  "follow-start",
  "follow-stop",
  "viewport",
] as const;
export const BROADCAST_SIGNALS = [
  "hangout-join",
  "hangout-leave",
  "screen-share-start",
  "screen-share-stop",
  "camera-start",
  "camera-stop",
  "chat",
  "pointer",
  "presentation-start",
  "presentation-stop",
  "follow-slide",
] as const;

export class RealtimeHub {
  private channels = new Map<string, Map<string, Connection>>();
  private heartbeat: NodeJS.Timeout;

  constructor() {
    // keeps proxies from closing idle streams
    this.heartbeat = setInterval(() => {
      for (const channel of this.channels.values()) {
        for (const connection of channel.values()) {
          connection.transport.heartbeat();
        }
      }
    }, 25_000);
    this.heartbeat.unref();
  }

  close() {
    clearInterval(this.heartbeat);
    for (const channel of this.channels.values()) {
      for (const connection of channel.values()) {
        connection.transport.close();
      }
    }
    this.channels.clear();
  }

  /** Server-Sent Events fallback (and what REST/MCP-style clients use). */
  connectSSE(
    channel: string,
    res: ServerResponse,
    user: { id: string | null; name: string; avatarUrl?: string | null },
    options: ConnectOptions = {},
  ): Connection {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const connection = this.connect(
      channel,
      {
        send: (event, data) =>
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        heartbeat: () => res.write(": ping\n\n"),
        close: () => res.end(),
        backlog: () => res.writableLength,
      },
      user,
      options,
    );
    res.on("close", () => this.disconnect(connection));
    return connection;
  }

  /** A WebSocket connection; frames are `{ event, data }` JSON. */
  connectWebSocket(
    channel: string,
    socket: WebSocketConnection,
    user: { id: string | null; name: string; avatarUrl?: string | null },
    options: ConnectOptions = {},
  ): Connection {
    const connection = this.connect(
      channel,
      {
        send: (event, data) => socket.send(JSON.stringify({ event, data })),
        heartbeat: () => {
          // a client that never answered the last ping is gone
          if (!socket.alive()) {
            socket.close(1001, "Ping timeout");
            return;
          }
          socket.ping();
        },
        close: () => socket.close(1001, "Server closing"),
        backlog: () => socket.bufferedAmount(),
      },
      user,
      options,
    );
    socket.onClose(() => this.disconnect(connection));
    return connection;
  }

  private connect(
    channel: string,
    transport: Transport,
    user: { id: string | null; name: string; avatarUrl?: string | null },
    { restricted = false }: ConnectOptions = {},
  ): Connection {
    let connections = this.channels.get(channel);
    if (!connections) {
      connections = new Map();
      this.channels.set(channel, connections);
    }
    const connection: Connection = {
      id: newId(8),
      channel,
      userId: user.id,
      name: user.name,
      avatarUrl: user.avatarUrl ?? null,
      color: COLORS[connections.size % COLORS.length],
      transport,
      inHangout: false,
      sharingScreen: false,
      cameraOn: false,
      cameraStreamId: null,
      screenStreamId: null,
      restricted,
      presenting: false,
      slide: 0,
    };
    connections.set(connection.id, connection);
    this.send(connection, "hello", {
      connectionId: connection.id,
      color: connection.color,
    });
    this.broadcastPresence(channel);
    return connection;
  }

  disconnect(connection: Connection) {
    const { channel } = connection;
    const current = this.channels.get(channel);
    if (!current?.delete(connection.id)) {
      return;
    }
    if (!current.size) {
      this.channels.delete(channel);
      return;
    }
    if (connection.inHangout) {
      this.broadcast(channel, "signal", {
        type: "hangout-leave",
        from: connection.id,
      });
    }
    this.broadcastPresence(channel);
  }

  get(channel: string, connectionId: string) {
    return this.channels.get(channel)?.get(connectionId) ?? null;
  }

  participants(channel: string): Participant[] {
    return [...(this.channels.get(channel)?.values() ?? [])].map((c) => ({
      connectionId: c.id,
      userId: c.userId,
      name: c.name,
      avatarUrl: c.avatarUrl,
      color: c.color,
      inHangout: c.inHangout,
      sharingScreen: c.sharingScreen,
      cameraOn: c.cameraOn,
      cameraStreamId: c.cameraStreamId,
      screenStreamId: c.screenStreamId,
      presenting: c.presenting,
      slide: c.slide,
    }));
  }

  /** The connection currently presenting on a channel, if any. */
  presenter(channel: string) {
    for (const connection of this.channels.get(channel)?.values() ?? []) {
      if (connection.presenting) {
        return connection;
      }
    }
    return null;
  }

  /** Channels with a live presentation. */
  presentingChannels() {
    const live = new Map<string, { presenter: Connection; viewers: number }>();
    for (const [channel, connections] of this.channels) {
      const presenter = this.presenter(channel);
      if (presenter) {
        live.set(channel, { presenter, viewers: connections.size - 1 });
      }
    }
    return live;
  }

  /** Pushes updated profile fields (name / avatarUrl) to live rooms. */
  updateUser(
    userId: string,
    patch: { name?: string; avatarUrl?: string | null },
  ) {
    for (const [channel, connections] of this.channels) {
      let changed = false;
      for (const connection of connections.values()) {
        if (connection.userId !== userId) {
          continue;
        }
        if (patch.name !== undefined && connection.name !== patch.name) {
          connection.name = patch.name;
          changed = true;
        }
        if (
          patch.avatarUrl !== undefined &&
          connection.avatarUrl !== patch.avatarUrl
        ) {
          connection.avatarUrl = patch.avatarUrl;
          changed = true;
        }
      }
      if (changed) {
        this.broadcastPresence(channel);
      }
    }
  }

  send(connection: Connection, event: string, data: unknown) {
    if (connection.restricted) {
      // Presentation-only viewers learn that the scene changed and re-fetch
      // their filtered copy; they never get its elements or comments, nor
      // pointers other than the presenter's.
      if (event === "scene-update") {
        event = "scene-refresh";
        data = {};
      } else if (event === "comment") {
        return;
      } else if (
        event === "signal" &&
        (data as { type?: string })?.type === "pointer" &&
        !this.get(connection.channel, (data as { from: string }).from)
          ?.presenting
      ) {
        return;
      }
    }
    if (connection.transport.backlog() > MAX_BACKLOG_BYTES) {
      // too slow to keep up; it reconnects and resyncs from the database
      connection.transport.close();
      return;
    }
    try {
      connection.transport.send(event, data);
    } catch {
      // the connection is closing; its close handler cleans up
    }
  }

  broadcast(
    channel: string,
    event: string,
    data: unknown,
    exceptConnectionId?: string | null,
  ) {
    for (const connection of this.channels.get(channel)?.values() ?? []) {
      if (connection.id !== exceptConnectionId) {
        this.send(connection, event, data);
      }
    }
  }

  /**
   * Sends to everyone who has joined the talk (the sender included). Chat uses
   * this so only people in the call see it.
   */
  broadcastToHangout(channel: string, event: string, data: unknown) {
    for (const connection of this.channels.get(channel)?.values() ?? []) {
      if (connection.inHangout) {
        this.send(connection, event, data);
      }
    }
  }

  broadcastPresence(channel: string) {
    this.broadcast(channel, "presence", {
      participants: this.participants(channel),
    });
  }

  /** Ends every stream on a channel, e.g. when the scene is deleted. */
  closeChannel(channel: string) {
    for (const connection of this.channels.get(channel)?.values() ?? []) {
      this.send(connection, "scene-deleted", {});
      connection.transport.close();
    }
    this.channels.delete(channel);
  }
}
