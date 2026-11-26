export type NotificationType = "share_invite" | "canvas_mention" | "system";

export type NotificationPriority = "low" | "normal" | "high";

export type ShareRole = "editor" | "viewer";

export interface UserIdentity {
  id: string;
  username: string;
  handle: string;
}

export interface KnownUser extends UserIdentity {
  lastSeenAt: number;
  source: "self" | "collab" | "directory" | "presence";
  isOnline?: boolean;
}

export interface SharedCollaboratorEntry {
  id: string;
  username: string;
  handle: string;
  role: ShareRole;
  addedAt: number;
  addedBy: UserIdentity;
}

export interface ShareInvitePayload {
  roomId: string;
  roomKey?: string;
  roomLink: string;
  canvasName?: string;
  role: ShareRole;
}

export interface CanvasMentionPayload {
  elementId: string;
  containerId?: string | null;
  textSnippet: string;
  roomId?: string | null;
  roomLink?: string | null;
  x?: number;
  y?: number;
}

export interface SystemNotificationPayload {
  actionLabel?: string;
  actionUrl?: string;
}

export interface NotificationBase<TType extends NotificationType, TPayload> {
  id: string;
  type: TType;
  title: string;
  message: string;
  sender: UserIdentity;
  recipientId?: string;
  recipientHandle?: string;
  createdAt: number;
  read: boolean;
  readAt?: number;
  dedupeKey: string;
  priority: NotificationPriority;
  payload: TPayload;
}

export type ShareInviteNotification = NotificationBase<
  "share_invite",
  ShareInvitePayload
>;

export type CanvasMentionNotification = NotificationBase<
  "canvas_mention",
  CanvasMentionPayload
>;

export type SystemNotification = NotificationBase<
  "system",
  SystemNotificationPayload
>;

export type AppNotification =
  | ShareInviteNotification
  | CanvasMentionNotification
  | SystemNotification;

export type NotificationFilter =
  | "all"
  | "unread"
  | "canvas_mention"
  | "share_invite";

export interface NotificationTransport {
  readonly name: string;
  start(onReceive: (notification: AppNotification) => void): void;
  send(notification: AppNotification): Promise<void> | void;
  stop(): void;
}

export interface NotificationStorageAdapter {
  load(namespaceKey: string): Promise<AppNotification[]>;
  save(namespaceKey: string, notifications: AppNotification[]): Promise<void>;
  clear(namespaceKey: string): Promise<void>;
}

export type NotificationEventMap = {
  received: AppNotification;
  updated: AppNotification[];
  toast: AppNotification;
};
