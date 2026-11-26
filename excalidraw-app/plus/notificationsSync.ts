import {
  notificationEngine,
  normalizeHandle,
  type AppNotification,
} from "../notifications";

import { plusAPI, type PlusUser, type ServerNotification } from "./api";

export const mapServerNotification = (
  raw: ServerNotification,
  currentUser: PlusUser,
): AppNotification => {
  const sender = {
    id: raw.actor.id || "server",
    username: raw.actor.name,
    handle: normalizeHandle(raw.actor.name),
    avatarUrl: raw.actor.avatarUrl,
  };
  const base = {
    id: raw.id,
    title: raw.title,
    message: raw.message,
    sender,
    recipientId: currentUser.id,
    recipientHandle: normalizeHandle(currentUser.name),
    createdAt: raw.createdAt,
    read: raw.read,
    readAt: raw.readAt ?? undefined,
    dedupeKey: raw.dedupeKey || `server:${raw.id}`,
    source: "server" as const,
  };

  switch (raw.type) {
    case "scene_share":
      return {
        ...base,
        type: "scene_share",
        priority: "high",
        payload: {
          sceneId: raw.sceneId || "",
          sceneName: raw.sceneName,
          role:
            raw.payload?.role === "viewer"
              ? "viewer"
              : raw.payload?.role === "editor"
              ? "editor"
              : undefined,
        },
      };
    case "scene_assigned":
      return {
        ...base,
        type: "scene_assigned",
        priority: "normal",
        payload: {
          sceneId: raw.sceneId || "",
          sceneName: raw.sceneName,
          teamId: raw.teamId,
          teamName: raw.teamName,
        },
      };
    case "team_added":
      return {
        ...base,
        type: "team_added",
        priority: "high",
        payload: {
          teamId: raw.teamId || "",
          teamName: raw.teamName,
          role:
            typeof raw.payload?.role === "string"
              ? raw.payload.role
              : undefined,
        },
      };
    case "comment_mention":
      return {
        ...base,
        type: "comment_mention",
        priority: "high",
        payload: {
          sceneId: raw.sceneId || "",
          sceneName: raw.sceneName,
          commentId: raw.commentId || String(raw.payload?.commentId || ""),
          elementId: raw.elementId,
          textSnippet:
            typeof raw.payload?.textSnippet === "string"
              ? raw.payload.textSnippet
              : undefined,
        },
      };
    case "comment_reply":
      return {
        ...base,
        type: "comment_reply",
        priority: "normal",
        payload: {
          sceneId: raw.sceneId || "",
          sceneName: raw.sceneName,
          commentId: raw.commentId || String(raw.payload?.commentId || ""),
          elementId: raw.elementId,
          textSnippet:
            typeof raw.payload?.textSnippet === "string"
              ? raw.payload.textSnippet
              : undefined,
        },
      };
    case "canvas_mention":
    default:
      return {
        ...base,
        type: "canvas_mention",
        priority: "normal",
        payload: {
          elementId: raw.elementId || String(raw.payload?.elementId || ""),
          textSnippet:
            typeof raw.payload?.textSnippet === "string"
              ? raw.payload.textSnippet
              : raw.message,
          sceneId: raw.sceneId,
          sceneName: raw.sceneName,
          x: typeof raw.payload?.x === "number" ? raw.payload.x : undefined,
          y: typeof raw.payload?.y === "number" ? raw.payload.y : undefined,
        },
      };
  }
};

/**
 * Connects the internal NotificationEngine to `plus-server` when signed in:
 * binds user identity, hydrates stored notifications, seeds workspace/team
 * directory for @mentions, and subscribes to live SSE notifications.
 */
export const startPlusNotificationsSync = (user: PlusUser): (() => void) => {
  let stopped = false;
  let eventSource: EventSource | null = null;
  let reconnectTimer = 0;

  void notificationEngine.bindAuthenticatedUser({
    id: user.id,
    username: user.name,
    handle: normalizeHandle(user.name),
    avatarUrl: user.avatarUrl,
  });

  notificationEngine.setRemoteSyncAdapter({
    markAsRead: (id) => plusAPI.markNotificationRead(id).then(() => undefined),
    markAllAsRead: () =>
      plusAPI.markAllNotificationsRead().then(() => undefined),
    dismiss: (id) => plusAPI.deleteNotification(id).then(() => undefined),
    clearAll: () => plusAPI.clearNotifications().then(() => undefined),
  });

  const hydrate = async () => {
    try {
      const data = await plusAPI.listNotifications();
      if (stopped) {
        return;
      }
      notificationEngine.hydrateFromServer(
        data.notifications.map((n) => mapServerNotification(n, user)),
      );
    } catch {
      // Server may be offline or unavailable
    }
  };

  const seedTeamDirectory = async () => {
    try {
      const { teams } = await plusAPI.listTeams();
      if (stopped) {
        return;
      }
      await Promise.all(
        teams.slice(0, 10).map(async (summary) => {
          try {
            const { team } = await plusAPI.getTeam(summary.id);
            if (!stopped) {
              notificationEngine.registerKnownUsers(
                team.members.map((m) => ({
                  id: m.userId,
                  username: m.name,
                  email: m.email,
                  avatarUrl: m.avatarUrl,
                  source: "plus",
                })),
              );
            }
          } catch {
            // Ignore per-team fetch error
          }
        }),
      );
    } catch {
      // Ignore teams directory error
    }
  };

  const connectStream = () => {
    if (stopped || typeof EventSource === "undefined") {
      return;
    }
    try {
      eventSource = new EventSource(plusAPI.notificationEventsURL(), {
        withCredentials: true,
      });

      eventSource.addEventListener("notification", (event) => {
        if (stopped) {
          return;
        }
        try {
          const parsed = JSON.parse((event as MessageEvent).data) as {
            notification?: ServerNotification;
          };
          if (parsed?.notification) {
            notificationEngine.ingest(
              mapServerNotification(parsed.notification, user),
            );
          }
        } catch {
          // Ignore malformed event payload
        }
      });

      eventSource.onerror = () => {
        eventSource?.close();
        eventSource = null;
        if (!stopped) {
          reconnectTimer = window.setTimeout(connectStream, 4000);
        }
      };
    } catch {
      // Ignore EventSource construction errors
    }
  };

  void hydrate();
  void seedTeamDirectory();
  connectStream();

  return () => {
    stopped = true;
    if (reconnectTimer) {
      window.clearTimeout(reconnectTimer);
    }
    eventSource?.close();
    eventSource = null;
    notificationEngine.setRemoteSyncAdapter(null);
  };
};
