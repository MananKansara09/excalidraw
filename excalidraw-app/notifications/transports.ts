import { WS_EVENTS } from "../app_constants";

import type {
  AppNotification,
  NotificationTransport,
  SharedCollaboratorEntry,
  UserIdentity,
} from "./types";
import type { Socket } from "socket.io-client";

const CHANNEL_NAME = "excalidraw-internal-notifications-v1";
const STORAGE_BUS_KEY = "excalidraw-notification-bus-packet";
const MAX_OUTBOX_SIZE = 100;

export type BusWireMessage =
  | {
      kind: "notification";
      originTabId: string;
      notification: AppNotification;
    }
  | {
      kind: "presence:announce";
      originTabId: string;
      user: UserIdentity;
    }
  | {
      kind: "presence:ack";
      originTabId: string;
      user: UserIdentity;
    }
  | {
      kind: "shared-users:sync";
      originTabId: string;
      roomKey: string;
      users: SharedCollaboratorEntry[];
    };

export interface BroadcastBusCallbacks {
  getIdentity: () => UserIdentity;
  onNotification: (notification: AppNotification) => void;
  onPresence: (user: UserIdentity) => void;
  onSharedUsersSync: (
    roomKey: string,
    users: SharedCollaboratorEntry[],
  ) => void;
}

/**
 * Internal cross-tab real-time transport backed by BroadcastChannel with
 * automatic localStorage `storage` event fallback for browsers/environments
 * without BroadcastChannel.
 */
export class BroadcastChannelTransport implements NotificationTransport {
  readonly name = "broadcast-channel";
  private channel: BroadcastChannel | null = null;
  private storageListener: ((event: StorageEvent) => void) | null = null;
  private readonly tabId = `${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  private callbacks: BroadcastBusCallbacks;

  constructor(callbacks: BroadcastBusCallbacks) {
    this.callbacks = callbacks;
  }

  private handleWireMessage = (msg: BusWireMessage) => {
    if (!msg || msg.originTabId === this.tabId) {
      return;
    }

    switch (msg.kind) {
      case "notification":
        this.callbacks.onNotification(msg.notification);
        break;
      case "presence:announce":
        this.callbacks.onPresence(msg.user);
        this.postWireMessage({
          kind: "presence:ack",
          originTabId: this.tabId,
          user: this.callbacks.getIdentity(),
        });
        break;
      case "presence:ack":
        this.callbacks.onPresence(msg.user);
        break;
      case "shared-users:sync":
        this.callbacks.onSharedUsersSync(msg.roomKey, msg.users);
        break;
    }
  };

  private postWireMessage = (msg: BusWireMessage) => {
    if (this.channel) {
      try {
        this.channel.postMessage(msg);
        return;
      } catch {
        // Fallback to localStorage storage event if channel closed/failed
      }
    }

    try {
      const packet = JSON.stringify({ ...msg, nonce: Math.random() });
      localStorage.setItem(STORAGE_BUS_KEY, packet);
      localStorage.removeItem(STORAGE_BUS_KEY);
    } catch {
      // Ignore storage errors
    }
  };

  start(onReceive: (notification: AppNotification) => void) {
    this.callbacks.onNotification = onReceive;

    if (typeof BroadcastChannel !== "undefined") {
      try {
        this.channel = new BroadcastChannel(CHANNEL_NAME);
        this.channel.onmessage = (event: MessageEvent<BusWireMessage>) => {
          this.handleWireMessage(event.data);
        };
      } catch {
        this.channel = null;
      }
    }

    if (typeof window !== "undefined") {
      this.storageListener = (event: StorageEvent) => {
        if (event.key !== STORAGE_BUS_KEY || !event.newValue) {
          return;
        }
        try {
          const parsed = JSON.parse(event.newValue) as BusWireMessage;
          this.handleWireMessage(parsed);
        } catch {
          // Ignore malformed wire messages
        }
      };
      window.addEventListener("storage", this.storageListener);
    }

    this.announcePresence(this.callbacks.getIdentity());
  }

  send(notification: AppNotification) {
    this.postWireMessage({
      kind: "notification",
      originTabId: this.tabId,
      notification,
    });
  }

  announcePresence(user: UserIdentity) {
    this.postWireMessage({
      kind: "presence:announce",
      originTabId: this.tabId,
      user,
    });
  }

  syncSharedUsers(roomKey: string, users: SharedCollaboratorEntry[]) {
    this.postWireMessage({
      kind: "shared-users:sync",
      originTabId: this.tabId,
      roomKey,
      users,
    });
  }

  stop() {
    if (this.channel) {
      try {
        this.channel.close();
      } catch {
        // Ignore close errors
      }
      this.channel = null;
    }
    if (this.storageListener && typeof window !== "undefined") {
      window.removeEventListener("storage", this.storageListener);
      this.storageListener = null;
    }
  }
}

export interface SocketNotificationBridge {
  isReady: () => boolean;
  broadcastEncrypted: (notification: AppNotification) => Promise<void> | void;
  getSocket: () => Socket | null;
}

/**
 * Socket.IO transport that delivers encrypted notifications over Excalidraw's
 * collaboration room socket AND optionally over a dedicated internal
 * notification channel (`notification-dispatch` / `notification-receive`).
 * Includes a bounded offline/reconnect outbox queue.
 */
export class SocketNotificationTransport implements NotificationTransport {
  readonly name = "socket-io";
  private bridge: SocketNotificationBridge | null = null;
  private onReceive: ((notification: AppNotification) => void) | null = null;
  private outbox: AppNotification[] = [];
  private attachedSocket: Socket | null = null;
  private getIdentity: () => UserIdentity;

  constructor(getIdentity: () => UserIdentity) {
    this.getIdentity = getIdentity;
  }

  start(onReceive: (notification: AppNotification) => void) {
    this.onReceive = onReceive;
    this.attachSocketListeners();
  }

  setBridge(bridge: SocketNotificationBridge | null) {
    this.detachSocketListeners();
    this.bridge = bridge;
    this.attachSocketListeners();
    this.flushOutbox();
  }

  private handleDirectSocketNotification = (notification: AppNotification) => {
    if (notification && typeof notification === "object") {
      this.onReceive?.(notification);
    }
  };

  private attachSocketListeners() {
    const socket = this.bridge?.getSocket() ?? null;
    if (!socket || socket === this.attachedSocket) {
      return;
    }

    this.attachedSocket = socket;
    const identity = this.getIdentity();
    socket.emit(WS_EVENTS.NOTIFICATION_REGISTER, {
      userId: identity.id,
      handle: identity.handle,
      username: identity.username,
    });
    socket.on(
      WS_EVENTS.NOTIFICATION_RECEIVE,
      this.handleDirectSocketNotification,
    );
  }

  private detachSocketListeners() {
    if (this.attachedSocket) {
      this.attachedSocket.off(
        WS_EVENTS.NOTIFICATION_RECEIVE,
        this.handleDirectSocketNotification,
      );
      this.attachedSocket = null;
    }
  }

  async send(notification: AppNotification) {
    if (!this.bridge || !this.bridge.isReady()) {
      if (this.outbox.length >= MAX_OUTBOX_SIZE) {
        this.outbox.shift();
      }
      this.outbox.push(notification);
      return;
    }

    await this.deliver(notification);
  }

  private async deliver(notification: AppNotification) {
    if (!this.bridge) {
      return;
    }
    try {
      await this.bridge.broadcastEncrypted(notification);
      const socket = this.bridge.getSocket();
      if (socket?.connected) {
        socket.emit(WS_EVENTS.NOTIFICATION_DISPATCH, notification);
      }
    } catch {
      if (this.outbox.length < MAX_OUTBOX_SIZE) {
        this.outbox.push(notification);
      }
    }
  }

  async flushOutbox() {
    if (!this.bridge || !this.bridge.isReady() || this.outbox.length === 0) {
      return;
    }
    this.attachSocketListeners();
    const pending = this.outbox.splice(0, this.outbox.length);
    for (const item of pending) {
      await this.deliver(item);
    }
  }

  ingestFromPortal(notification: AppNotification) {
    this.onReceive?.(notification);
  }

  stop() {
    this.detachSocketListeners();
    this.onReceive = null;
    this.outbox = [];
  }
}
