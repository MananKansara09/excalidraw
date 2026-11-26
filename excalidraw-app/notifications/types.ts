export type NotificationType =
  | "share_invite"
  | "canvas_mention"
  | "scene_share"
  | "scene_assigned"
  | "team_added"
  | "comment_mention"
  | "comment_reply"
  | "system";

export type NotificationPriority = "low" | "normal" | "high";

export type ShareRole = "editor" | "viewer";

export interface UserIdentity {
  id: string;
  username: string;
  handle: string;
  avatarUrl?: string | null;
}

export interface KnownUser extends UserIdentity {
  email?: string;
  lastSeenAt: number;
  source: "self" | "collab" | "directory" | "presence" | "plus";
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
  sceneId?: string | null;
  sceneName?: string | null;
  x?: number;
  y?: number;
}

export interface CloudSceneNotificationPayload {
  sceneId: string;
  sceneName?: string | null;
  teamId?: string | null;
  teamName?: string | null;
  role?: ShareRole;
}

export interface TeamNotificationPayload {
  teamId: string;
  teamName?: string | null;
  role?: string;
}

export interface CommentNotificationPayload {
  sceneId: string;
  sceneName?: string | null;
  commentId: string;
  elementId?: string | null;
  textSnippet?: string;
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
  source?: "local" | "server";
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

export type SceneShareNotification = NotificationBase<
  "scene_share",
  CloudSceneNotificationPayload
>;

export type SceneAssignedNotification = NotificationBase<
  "scene_assigned",
  CloudSceneNotificationPayload
>;

export type TeamAddedNotification = NotificationBase<
  "team_added",
  TeamNotificationPayload
>;

export type CommentMentionNotification = NotificationBase<
  "comment_mention",
  CommentNotificationPayload
>;

export type CommentReplyNotification = NotificationBase<
  "comment_reply",
  CommentNotificationPayload
>;

export type SystemNotification = NotificationBase<
  "system",
  SystemNotificationPayload
>;

export type AppNotification =
  | ShareInviteNotification
  | CanvasMentionNotification
  | SceneShareNotification
  | SceneAssignedNotification
  | TeamAddedNotification
  | CommentMentionNotification
  | CommentReplyNotification
  | SystemNotification;

export type NotificationFilter =
  | "all"
  | "unread"
  | "mentions"
  | "shares"
  | "teams";

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

export interface NotificationRemoteSyncAdapter {
  markAsRead(id: string): Promise<void> | void;
  markAllAsRead(): Promise<void> | void;
  dismiss(id: string): Promise<void> | void;
  clearAll(): Promise<void> | void;
}

export type NotificationEventMap = {
  received: AppNotification;
  updated: AppNotification[];
  toast: AppNotification;
};
