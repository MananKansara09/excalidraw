import { newId } from "./db.ts";

import type { ServerResponse } from "node:http";

/**
 * One open SSE stream. Each browser tab viewing a cloud scene holds one; it
 * carries scene updates, presence, comment events and the WebRTC signaling
 * for voice hangouts and screen sharing.
 */
export type Connection = {
  id: string;
  channel: string;
  userId: string | null;
  name: string;
  color: string;
  res: ServerResponse;
  inHangout: boolean;
  sharingScreen: boolean;
  /** Joined through a presentation-only link: gets slides, never the scene. */
  restricted: boolean;
  /** This connection is running a presentation, on slide `slide`. */
  presenting: boolean;
  slide: number;
};

export type Participant = {
  connectionId: string;
  userId: string | null;
  name: string;
  color: string;
  inHangout: boolean;
  sharingScreen: boolean;
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
export const TARGETED_SIGNALS = ["rtc-offer", "rtc-answer", "rtc-ice"] as const;
export const BROADCAST_SIGNALS = [
  "hangout-join",
  "hangout-leave",
  "screen-share-start",
  "screen-share-stop",
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
          connection.res.write(": ping\n\n");
        }
      }
    }, 25_000);
    this.heartbeat.unref();
  }

  close() {
    clearInterval(this.heartbeat);
    for (const channel of this.channels.values()) {
      for (const connection of channel.values()) {
        connection.res.end();
      }
    }
    this.channels.clear();
  }

  connect(
    channel: string,
    res: ServerResponse,
    user: { id: string | null; name: string },
    { restricted = false } = {},
  ): Connection {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
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
      color: COLORS[connections.size % COLORS.length],
      res,
      inHangout: false,
      sharingScreen: false,
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

    res.on("close", () => {
      const current = this.channels.get(channel);
      current?.delete(connection.id);
      if (current && !current.size) {
        this.channels.delete(channel);
      } else {
        if (connection.inHangout) {
          this.broadcast(channel, "signal", {
            type: "hangout-leave",
            from: connection.id,
          });
        }
        this.broadcastPresence(channel);
      }
    });
    return connection;
  }

  get(channel: string, connectionId: string) {
    return this.channels.get(channel)?.get(connectionId) ?? null;
  }

  participants(channel: string): Participant[] {
    return [...(this.channels.get(channel)?.values() ?? [])].map((c) => ({
      connectionId: c.id,
      userId: c.userId,
      name: c.name,
      color: c.color,
      inHangout: c.inHangout,
      sharingScreen: c.sharingScreen,
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
        (data as { type?: string; from?: string })?.type === "pointer" &&
        !this.get(connection.channel, (data as { from: string }).from)
          ?.presenting
      ) {
        return;
      }
    }
    connection.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
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

  broadcastPresence(channel: string) {
    this.broadcast(channel, "presence", {
      participants: this.participants(channel),
    });
  }

  /** Ends every stream on a channel, e.g. when the scene is deleted. */
  closeChannel(channel: string) {
    for (const connection of this.channels.get(channel)?.values() ?? []) {
      this.send(connection, "scene-deleted", {});
      connection.res.end();
    }
    this.channels.delete(channel);
  }
}
