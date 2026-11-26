import type { ExcalidrawElement } from "@excalidraw/element/types";

import type { Collaborator, SocketId } from "@excalidraw/excalidraw/types";

import { appJotaiStore } from "../app-jotai";
import { STORAGE_KEYS } from "../app_constants";

import {
  getOrCreateUserIdentity,
  loadKnownUsersFromStorage,
  matchesRecipient,
  normalizeHandle,
  persistCollabProfile,
  saveKnownUsersToStorage,
} from "./identity";
import { MentionTracker } from "./mentionParser";
import {
  showNativeNotification,
  syncNativeNotificationPermissionAtom,
} from "./nativeNotifications";
import { IndexedDBNotificationStorage } from "./storage";
import {
  currentUserAtom,
  knownUsersAtom,
  notificationCenterOpenAtom,
  notificationsAtom,
  notificationToastQueueAtom,
  sharedUsersByRoomAtom,
} from "./store";
import {
  BroadcastChannelTransport,
  SocketNotificationTransport,
  type SocketNotificationBridge,
} from "./transports";

import type {
  AppNotification,
  CanvasMentionNotification,
  KnownUser,
  NotificationEventMap,
  NotificationRemoteSyncAdapter,
  NotificationStorageAdapter,
  NotificationTransport,
  ShareInviteNotification,
  ShareRole,
  SharedCollaboratorEntry,
  SystemNotification,
  UserIdentity,
} from "./types";

export const MAX_STORED_NOTIFICATIONS = 200;
export const MAX_TOAST_QUEUE = 4;
const DEDUPE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_DEDUPE_ENTRIES = 2000;

const createNotificationId = (): string => {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `ntf_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
};

const loadSharedUsersFromStorage = (): Record<
  string,
  SharedCollaboratorEntry[]
> => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_SHARED_USERS);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const saveSharedUsersToStorage = (
  map: Record<string, SharedCollaboratorEntry[]>,
) => {
  try {
    localStorage.setItem(
      STORAGE_KEYS.LOCAL_STORAGE_SHARED_USERS,
      JSON.stringify(map),
    );
  } catch {
    // Ignore storage write errors
  }
};

type EventListeners = {
  [K in keyof NotificationEventMap]: Set<
    (payload: NotificationEventMap[K]) => void
  >;
};

export interface NotificationEngineOptions {
  storage?: NotificationStorageAdapter;
  transports?: NotificationTransport[];
  enableDefaultTransports?: boolean;
}

export class NotificationEngine {
  private storage: NotificationStorageAdapter;
  private remoteSync: NotificationRemoteSyncAdapter | null = null;
  private nativeActivationHandler:
    | ((notification: AppNotification) => void)
    | null = null;
  private transports: NotificationTransport[] = [];
  private broadcastTransport: BroadcastChannelTransport | null = null;
  private socketTransport: SocketNotificationTransport | null = null;
  private mentionTracker = new MentionTracker();

  private initialized = false;
  private seenIds = new Set<string>();
  private dedupeIndex = new Map<string, number>();
  private persistTimer: number | null = null;
  private listeners: EventListeners = {
    received: new Set(),
    updated: new Set(),
    toast: new Set(),
  };

  constructor(options: NotificationEngineOptions = {}) {
    this.storage = options.storage ?? new IndexedDBNotificationStorage();

    if (options.transports) {
      this.transports = [...options.transports];
    } else if (options.enableDefaultTransports !== false) {
      this.broadcastTransport = new BroadcastChannelTransport({
        getIdentity: () => this.getCurrentUser(),
        onNotification: (notification) => this.ingest(notification),
        onPresence: (user) =>
          this.registerKnownUsers([
            { ...user, source: "presence", isOnline: true },
          ]),
        onSharedUsersSync: (roomKey, users) =>
          this.mergeSharedUsersFromBus(roomKey, users),
      });
      this.socketTransport = new SocketNotificationTransport(() =>
        this.getCurrentUser(),
      );
      this.transports = [this.broadcastTransport, this.socketTransport];
    }
  }

  async init() {
    if (this.initialized) {
      return;
    }
    this.initialized = true;

    const identity = getOrCreateUserIdentity();
    appJotaiStore.set(currentUserAtom, identity);
    appJotaiStore.set(knownUsersAtom, loadKnownUsersFromStorage());
    appJotaiStore.set(sharedUsersByRoomAtom, loadSharedUsersFromStorage());

    this.registerKnownUsers([
      {
        ...identity,
        source: "self",
        isOnline: true,
      },
    ]);

    await this.loadInboxForIdentity(identity);

    for (const transport of this.transports) {
      transport.start((notification) => this.ingest(notification));
    }

    if (typeof window !== "undefined") {
      window.addEventListener("online", this.handleOnline);
    }
    syncNativeNotificationPermissionAtom();
  }

  private handleOnline = () => {
    this.socketTransport?.flushOutbox();
  };

  destroy() {
    if (!this.initialized) {
      return;
    }
    this.initialized = false;

    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.handleOnline);
    }
    if (this.persistTimer !== null && typeof window !== "undefined") {
      window.clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }

    for (const transport of this.transports) {
      transport.stop();
    }
    this.mentionTracker.reset();
  }

  registerTransport(transport: NotificationTransport) {
    this.transports.push(transport);
    if (this.initialized) {
      transport.start((notification) => this.ingest(notification));
    }
  }

  setRemoteSyncAdapter(adapter: NotificationRemoteSyncAdapter | null) {
    this.remoteSync = adapter;
  }

  setNativeActivationHandler(
    handler: ((notification: AppNotification) => void) | null,
  ) {
    this.nativeActivationHandler = handler;
  }

  setSocketBridge(bridge: SocketNotificationBridge | null) {
    this.socketTransport?.setBridge(bridge);
  }

  flushSocketOutbox() {
    this.socketTransport?.flushOutbox();
  }

  ingestFromSocket(notification: AppNotification) {
    if (this.socketTransport) {
      this.socketTransport.ingestFromPortal(notification);
    } else {
      this.ingest(notification);
    }
  }

  getCurrentUser(): UserIdentity {
    return appJotaiStore.get(currentUserAtom);
  }

  async updateCurrentUser(
    username: string,
    opts?: { syncLocalStorage?: boolean },
  ): Promise<UserIdentity> {
    const prev = this.getCurrentUser();
    const next = persistCollabProfile({
      username,
      syncLocalStorage: opts?.syncLocalStorage,
    });
    appJotaiStore.set(currentUserAtom, next);

    this.registerKnownUsers([
      {
        ...next,
        source: "self",
        isOnline: true,
      },
    ]);

    if (prev.handle !== next.handle) {
      await this.loadInboxForIdentity(next);
    }

    this.broadcastTransport?.announcePresence(next);
    return next;
  }

  /**
   * Aligns notification identity with an authenticated Plus account without
   * overwriting local guest collab preferences.
   */
  async bindAuthenticatedUser(identity: UserIdentity): Promise<UserIdentity> {
    const prev = this.getCurrentUser();
    appJotaiStore.set(currentUserAtom, identity);
    this.registerKnownUsers([
      {
        ...identity,
        source: "self",
        isOnline: true,
      },
    ]);

    if (prev.id !== identity.id || prev.handle !== identity.handle) {
      await this.loadInboxForIdentity(identity);
    }
    this.broadcastTransport?.announcePresence(identity);
    return identity;
  }

  /**
   * Hydrates historical notifications fetched from `plus-server` without
   * popping toast or desktop notifications for already-stored items.
   */
  hydrateFromServer(serverItems: AppNotification[]) {
    const identity = this.getCurrentUser();
    const localItems = appJotaiStore
      .get(notificationsAtom)
      .filter((n) => n.source !== "server");

    const mergedByKey = new Map<string, AppNotification>();
    for (const item of [...serverItems, ...localItems]) {
      this.seenIds.add(item.id);
      this.dedupeIndex.set(item.dedupeKey, item.createdAt);
      const existing = mergedByKey.get(item.id);
      if (!existing || item.createdAt >= existing.createdAt) {
        mergedByKey.set(item.id, item);
      }
    }

    const sorted = this.applyRetentionPolicy(
      Array.from(mergedByKey.values()).sort(
        (a, b) => b.createdAt - a.createdAt,
      ),
    );
    appJotaiStore.set(notificationsAtom, sorted);
    this.schedulePersist(identity.handle, sorted);
    this.emit("updated", sorted);
  }

  private async loadInboxForIdentity(identity: UserIdentity) {
    const stored = await this.storage.load(identity.handle);
    const sorted = [...stored]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_STORED_NOTIFICATIONS);

    this.seenIds.clear();
    this.dedupeIndex.clear();
    for (const item of sorted) {
      this.seenIds.add(item.id);
      this.dedupeIndex.set(item.dedupeKey, item.createdAt);
    }

    appJotaiStore.set(notificationsAtom, sorted);
    appJotaiStore.set(notificationToastQueueAtom, []);
    this.emit("updated", sorted);
  }

  registerKnownUsers(
    users: Array<
      Pick<UserIdentity, "id" | "username"> & {
        handle?: string;
        source?: KnownUser["source"];
        isOnline?: boolean;
      }
    >,
  ) {
    const existing = appJotaiStore.get(knownUsersAtom);
    const byHandle = new Map<string, KnownUser>();

    for (const u of existing) {
      byHandle.set(u.handle, u);
    }

    const now = Date.now();
    let changed = false;

    for (const user of users) {
      const cleanName = user.username?.trim();
      if (!cleanName) {
        continue;
      }
      const handle = user.handle || normalizeHandle(cleanName);
      const prev = byHandle.get(handle);
      const nextEntry: KnownUser = {
        id: user.id || prev?.id || `usr_${handle}`,
        username: cleanName,
        handle,
        lastSeenAt: now,
        source: user.source ?? prev?.source ?? "directory",
        isOnline: user.isOnline ?? prev?.isOnline,
      };
      if (
        !prev ||
        prev.username !== nextEntry.username ||
        prev.isOnline !== nextEntry.isOnline ||
        prev.id !== nextEntry.id
      ) {
        changed = true;
      }
      byHandle.set(handle, nextEntry);
    }

    if (changed || byHandle.size !== existing.length) {
      const merged = Array.from(byHandle.values())
        .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
        .slice(0, 100);
      appJotaiStore.set(knownUsersAtom, merged);
      saveKnownUsersToStorage(merged);
    }
  }

  syncCollaborators(collaborators: Map<SocketId, Collaborator>) {
    const entries: Array<
      Pick<UserIdentity, "id" | "username"> & {
        source: KnownUser["source"];
        isOnline: boolean;
      }
    > = [];

    collaborators.forEach((collab, socketId) => {
      if (collab.username?.trim()) {
        entries.push({
          id: collab.id || `socket:${socketId}`,
          username: collab.username.trim(),
          source: collab.isCurrentUser ? "self" : "collab",
          isOnline: true,
        });
      }
    });

    if (entries.length > 0) {
      this.registerKnownUsers(entries);
    }
  }

  getSharedUsers(roomKey: string): SharedCollaboratorEntry[] {
    const map = appJotaiStore.get(sharedUsersByRoomAtom);
    return map[roomKey] ?? [];
  }

  private mergeSharedUsersFromBus(
    roomKey: string,
    incoming: SharedCollaboratorEntry[],
  ) {
    const map = appJotaiStore.get(sharedUsersByRoomAtom);
    const current = map[roomKey] ?? [];
    const byHandle = new Map<string, SharedCollaboratorEntry>();

    for (const item of [...current, ...incoming]) {
      const existing = byHandle.get(item.handle);
      if (!existing || item.addedAt >= existing.addedAt) {
        byHandle.set(item.handle, item);
      }
    }

    const updated = {
      ...map,
      [roomKey]: Array.from(byHandle.values()),
    };
    appJotaiStore.set(sharedUsersByRoomAtom, updated);
    saveSharedUsersToStorage(updated);
  }

  async addSharedUser(opts: {
    roomId: string;
    roomKey?: string;
    roomLink: string;
    targetUsername: string;
    targetUserId?: string;
    role?: ShareRole;
    canvasName?: string;
  }): Promise<{
    entry: SharedCollaboratorEntry;
    notification: ShareInviteNotification;
  }> {
    const sender = this.getCurrentUser();
    const cleanTarget = opts.targetUsername.trim().replace(/^@+/, "");
    const handle = normalizeHandle(cleanTarget);
    const knownMatch = appJotaiStore
      .get(knownUsersAtom)
      .find((u) => u.handle === handle);

    const entry: SharedCollaboratorEntry = {
      id: opts.targetUserId || knownMatch?.id || `usr_${handle}`,
      username: knownMatch?.username || cleanTarget,
      handle,
      role: opts.role ?? "editor",
      addedAt: Date.now(),
      addedBy: sender,
    };

    this.registerKnownUsers([
      {
        id: entry.id,
        username: entry.username,
        handle: entry.handle,
        source: "directory",
      },
    ]);

    const storageKey = opts.roomId || "local";
    const map = appJotaiStore.get(sharedUsersByRoomAtom);
    const existingList = (map[storageKey] ?? []).filter(
      (u) => u.handle !== entry.handle,
    );
    const nextList = [entry, ...existingList];
    const nextMap = { ...map, [storageKey]: nextList };
    appJotaiStore.set(sharedUsersByRoomAtom, nextMap);
    saveSharedUsersToStorage(nextMap);

    this.broadcastTransport?.syncSharedUsers(storageKey, nextList);

    const notification = await this.notifyShareInvite({
      recipientId: entry.id,
      recipientHandle: entry.handle,
      recipientName: entry.username,
      roomId: opts.roomId,
      roomKey: opts.roomKey,
      roomLink: opts.roomLink,
      role: entry.role,
      canvasName: opts.canvasName,
    });

    return { entry, notification };
  }

  removeSharedUser(roomId: string, handle: string) {
    const storageKey = roomId || "local";
    const map = appJotaiStore.get(sharedUsersByRoomAtom);
    const nextList = (map[storageKey] ?? []).filter(
      (u) => u.handle !== normalizeHandle(handle),
    );
    const nextMap = { ...map, [storageKey]: nextList };
    appJotaiStore.set(sharedUsersByRoomAtom, nextMap);
    saveSharedUsersToStorage(nextMap);
    this.broadcastTransport?.syncSharedUsers(storageKey, nextList);
  }

  async notifyShareInvite(opts: {
    recipientId?: string;
    recipientHandle: string;
    recipientName?: string;
    roomId: string;
    roomKey?: string;
    roomLink: string;
    role: ShareRole;
    canvasName?: string;
  }): Promise<ShareInviteNotification> {
    const sender = this.getCurrentUser();
    const handle = normalizeHandle(opts.recipientHandle);
    const label = opts.canvasName?.trim() || "a canvas";

    const notification: ShareInviteNotification = {
      id: createNotificationId(),
      type: "share_invite",
      title: "Shared canvas invitation",
      message: `${sender.username} added you as ${opts.role} on ${label}`,
      sender,
      recipientId: opts.recipientId,
      recipientHandle: handle,
      createdAt: Date.now(),
      read: false,
      dedupeKey: `share:${opts.roomId}:${handle}:${opts.role}:${Math.floor(
        Date.now() / 5000,
      )}`,
      priority: "high",
      payload: {
        roomId: opts.roomId,
        roomKey: opts.roomKey,
        roomLink: opts.roomLink,
        canvasName: opts.canvasName,
        role: opts.role,
      },
    };

    await this.dispatch(notification);
    return notification;
  }

  async notifyCanvasMention(opts: {
    recipientId?: string;
    recipientHandle: string;
    elementId: string;
    containerId?: string | null;
    textSnippet: string;
    roomId?: string | null;
    roomLink?: string | null;
    x?: number;
    y?: number;
    senderOverride?: UserIdentity;
    dedupeSuffix?: string;
  }): Promise<CanvasMentionNotification> {
    const sender = opts.senderOverride ?? this.getCurrentUser();
    const handle = normalizeHandle(opts.recipientHandle);
    const scopeKey = opts.roomId || "local";

    const notification: CanvasMentionNotification = {
      id: createNotificationId(),
      type: "canvas_mention",
      title: "Mentioned on canvas",
      message: `${sender.username} mentioned you: "${opts.textSnippet}"`,
      sender,
      recipientId: opts.recipientId,
      recipientHandle: handle,
      createdAt: Date.now(),
      read: false,
      dedupeKey: `mention:${scopeKey}:${opts.elementId}:${handle}${
        opts.dedupeSuffix ? `:${opts.dedupeSuffix}` : ""
      }`,
      priority: "normal",
      payload: {
        elementId: opts.elementId,
        containerId: opts.containerId ?? null,
        textSnippet: opts.textSnippet,
        roomId: opts.roomId ?? null,
        roomLink: opts.roomLink ?? null,
        x: opts.x,
        y: opts.y,
      },
    };

    await this.dispatch(notification);
    return notification;
  }

  async notifySystem(opts: {
    title: string;
    message: string;
    actionLabel?: string;
    actionUrl?: string;
    dedupeKey?: string;
  }): Promise<SystemNotification> {
    const sender = this.getCurrentUser();
    const notification: SystemNotification = {
      id: createNotificationId(),
      type: "system",
      title: opts.title,
      message: opts.message,
      sender,
      recipientId: sender.id,
      recipientHandle: sender.handle,
      createdAt: Date.now(),
      read: false,
      dedupeKey: opts.dedupeKey || `system:${createNotificationId()}`,
      priority: "low",
      payload: {
        actionLabel: opts.actionLabel,
        actionUrl: opts.actionUrl,
      },
    };

    this.ingest(notification, { allowSelf: true });
    return notification;
  }

  seedCanvasElements(elements: readonly ExcalidrawElement[]) {
    this.mentionTracker.seedElements(
      elements,
      appJotaiStore.get(knownUsersAtom),
    );
  }

  async processCanvasElements(
    elements: readonly ExcalidrawElement[],
    opts: {
      editingElementId?: string | null;
      roomId?: string | null;
      roomLink?: string | null;
      isRemote?: boolean;
      senderOverride?: UserIdentity;
    } = {},
  ): Promise<CanvasMentionNotification[]> {
    const knownUsers = appJotaiStore.get(knownUsersAtom);
    const detected = this.mentionTracker.collectNewMentions(elements, {
      editingElementId: opts.editingElementId,
      knownUsers,
    });

    if (detected.length === 0) {
      return [];
    }

    const currentUser = this.getCurrentUser();
    const emitted: CanvasMentionNotification[] = [];

    for (const mention of detected) {
      // Skip self-mentions during local authoring
      if (!opts.isRemote && mention.handle === currentUser.handle) {
        continue;
      }

      // On remote fallback detection, only notify if addressed to current user
      if (
        opts.isRemote &&
        mention.handle !== currentUser.handle &&
        mention.handle !== "everyone" &&
        mention.handle !== "all"
      ) {
        continue;
      }

      const targetUser = knownUsers.find((u) => u.handle === mention.handle);

      if (opts.isRemote) {
        const remoteNotification: CanvasMentionNotification = {
          id: createNotificationId(),
          type: "canvas_mention",
          title: "Mentioned on canvas",
          message: `${
            opts.senderOverride?.username || "A collaborator"
          } mentioned you: "${mention.textSnippet}"`,
          sender: opts.senderOverride ?? {
            id: "remote-collaborator",
            username: "Collaborator",
            handle: "collaborator",
          },
          recipientId: currentUser.id,
          recipientHandle: mention.handle,
          createdAt: Date.now(),
          read: false,
          dedupeKey: `mention:${opts.roomId || "local"}:${mention.elementId}:${
            mention.handle
          }`,
          priority: "normal",
          payload: {
            elementId: mention.elementId,
            containerId: mention.containerId,
            textSnippet: mention.textSnippet,
            roomId: opts.roomId ?? null,
            roomLink: opts.roomLink ?? null,
            x: mention.x,
            y: mention.y,
          },
        };
        if (this.ingest(remoteNotification)) {
          emitted.push(remoteNotification);
        }
      } else {
        const sent = await this.notifyCanvasMention({
          recipientId: targetUser?.id,
          recipientHandle: mention.handle,
          elementId: mention.elementId,
          containerId: mention.containerId,
          textSnippet: mention.textSnippet,
          roomId: opts.roomId,
          roomLink: opts.roomLink,
          x: mention.x,
          y: mention.y,
        });
        emitted.push(sent);
      }
    }

    return emitted;
  }

  private async dispatch(notification: AppNotification) {
    // Deliver through all transports (BroadcastChannel + Socket.IO)
    await Promise.allSettled(
      this.transports.map((transport) => transport.send(notification)),
    );
  }

  ingest(
    notification: AppNotification,
    opts: { allowSelf?: boolean } = {},
  ): boolean {
    if (!notification || !notification.id || !notification.dedupeKey) {
      return false;
    }

    const currentUser = this.getCurrentUser();

    if (!opts.allowSelf && notification.sender.id === currentUser.id) {
      return false;
    }

    if (!matchesRecipient(notification, currentUser)) {
      return false;
    }

    const now = Date.now();
    this.pruneDedupeIndex(now);

    if (this.seenIds.has(notification.id)) {
      return false;
    }

    const prevDedupeAt = this.dedupeIndex.get(notification.dedupeKey);
    if (prevDedupeAt && now - prevDedupeAt < DEDUPE_TTL_MS) {
      return false;
    }

    this.seenIds.add(notification.id);
    this.dedupeIndex.set(notification.dedupeKey, now);

    this.registerKnownUsers([
      {
        ...notification.sender,
        source: "presence",
        isOnline: true,
      },
    ]);

    const current = appJotaiStore.get(notificationsAtom);
    const next = this.applyRetentionPolicy([notification, ...current]);

    appJotaiStore.set(notificationsAtom, next);
    this.schedulePersist(currentUser.handle, next);

    const queue = appJotaiStore.get(notificationToastQueueAtom);
    const nextQueue = [notification, ...queue].slice(0, MAX_TOAST_QUEUE);
    appJotaiStore.set(notificationToastQueueAtom, nextQueue);

    this.emit("received", notification);
    this.emit("toast", notification);
    this.emit("updated", next);

    showNativeNotification(notification, {
      onActivate: (activated) => {
        appJotaiStore.set(notificationCenterOpenAtom, true);
        this.nativeActivationHandler?.(activated);
      },
    });

    return true;
  }

  private applyRetentionPolicy(list: AppNotification[]): AppNotification[] {
    if (list.length <= MAX_STORED_NOTIFICATIONS) {
      return list;
    }

    // Evict oldest read items first, then oldest overall
    const sorted = [...list].sort((a, b) => b.createdAt - a.createdAt);
    const unread = sorted.filter((n) => !n.read);
    const read = sorted.filter((n) => n.read);

    if (unread.length >= MAX_STORED_NOTIFICATIONS) {
      return unread.slice(0, MAX_STORED_NOTIFICATIONS);
    }

    return [
      ...unread,
      ...read.slice(0, MAX_STORED_NOTIFICATIONS - unread.length),
    ].sort((a, b) => b.createdAt - a.createdAt);
  }

  private pruneDedupeIndex(now: number) {
    if (this.dedupeIndex.size < MAX_DEDUPE_ENTRIES) {
      return;
    }
    for (const [key, ts] of this.dedupeIndex.entries()) {
      if (now - ts >= DEDUPE_TTL_MS) {
        this.dedupeIndex.delete(key);
      }
    }
  }

  private schedulePersist(namespaceKey: string, list: AppNotification[]) {
    if (typeof window === "undefined") {
      void this.storage.save(namespaceKey, list);
      return;
    }
    if (this.persistTimer !== null) {
      window.clearTimeout(this.persistTimer);
    }
    this.persistTimer = window.setTimeout(() => {
      this.persistTimer = null;
      void this.storage.save(
        namespaceKey,
        appJotaiStore.get(notificationsAtom),
      );
    }, 150);
  }

  markAsRead(id: string) {
    const current = appJotaiStore.get(notificationsAtom);
    let changed = false;
    const now = Date.now();
    const next = current.map((item) => {
      if (item.id === id && !item.read) {
        changed = true;
        return { ...item, read: true, readAt: now };
      }
      return item;
    });

    if (changed) {
      appJotaiStore.set(notificationsAtom, next);
      this.schedulePersist(this.getCurrentUser().handle, next);
      this.emit("updated", next);
      void this.remoteSync?.markAsRead(id);
    }

    this.dismissToast(id);
  }

  markAllAsRead() {
    const current = appJotaiStore.get(notificationsAtom);
    const now = Date.now();
    let changed = false;
    const next = current.map((item) => {
      if (!item.read) {
        changed = true;
        return { ...item, read: true, readAt: now };
      }
      return item;
    });

    if (changed) {
      appJotaiStore.set(notificationsAtom, next);
      this.schedulePersist(this.getCurrentUser().handle, next);
      this.emit("updated", next);
      void this.remoteSync?.markAllAsRead();
    }

    appJotaiStore.set(notificationToastQueueAtom, []);
  }

  dismiss(id: string) {
    const current = appJotaiStore.get(notificationsAtom);
    const next = current.filter((item) => item.id !== id);
    if (next.length !== current.length) {
      appJotaiStore.set(notificationsAtom, next);
      this.schedulePersist(this.getCurrentUser().handle, next);
      this.emit("updated", next);
      void this.remoteSync?.dismiss(id);
    }
    this.dismissToast(id);
  }

  clearAll() {
    appJotaiStore.set(notificationsAtom, []);
    appJotaiStore.set(notificationToastQueueAtom, []);
    void this.storage.clear(this.getCurrentUser().handle);
    void this.remoteSync?.clearAll();
    this.emit("updated", []);
  }

  dismissToast(id: string) {
    const queue = appJotaiStore.get(notificationToastQueueAtom);
    const next = queue.filter((item) => item.id !== id);
    if (next.length !== queue.length) {
      appJotaiStore.set(notificationToastQueueAtom, next);
    }
  }

  subscribe<K extends keyof NotificationEventMap>(
    event: K,
    listener: (payload: NotificationEventMap[K]) => void,
  ): () => void {
    const set = this.listeners[event];
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }

  private emit<K extends keyof NotificationEventMap>(
    event: K,
    payload: NotificationEventMap[K],
  ) {
    this.listeners[event].forEach((listener) => {
      try {
        listener(payload);
      } catch (err) {
        console.error("Notification listener error:", err);
      }
    });
  }
}

export const notificationEngine = new NotificationEngine();
