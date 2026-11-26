import { getUser, requireUser } from "../auth.ts";
import { all, get, newId, now, run } from "../db.ts";
import { HttpError, parseCookies } from "../http.ts";
import { acceptWebSocket } from "../websocket.ts";

import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { AppContext } from "../context.ts";
import type { Request, Router } from "../http.ts";

export const userNotificationChannel = (userId: string) => `user:${userId}`;

const MAX_NOTIFICATIONS_PER_USER = 500;

export type ServerNotificationType =
  | "scene_share"
  | "scene_assigned"
  | "team_added"
  | "canvas_mention"
  | "comment_mention"
  | "comment_reply";

export type NotificationRow = {
  id: string;
  user_id: string;
  actor_id: string | null;
  actor_name: string;
  actor_avatar_url: string | null;
  type: ServerNotificationType;
  title: string;
  message: string;
  scene_id: string | null;
  scene_name: string | null;
  team_id: string | null;
  team_name: string | null;
  comment_id: string | null;
  element_id: string | null;
  dedupe_key: string | null;
  payload: string;
  read_at: number | null;
  created_at: number;
};

export const notificationJSON = (row: NotificationRow) => ({
  id: row.id,
  userId: row.user_id,
  actor: {
    id: row.actor_id,
    name: row.actor_name,
    avatarUrl: row.actor_avatar_url ?? null,
  },
  type: row.type,
  title: row.title,
  message: row.message,
  sceneId: row.scene_id,
  sceneName: row.scene_name,
  teamId: row.team_id,
  teamName: row.team_name,
  commentId: row.comment_id,
  elementId: row.element_id,
  dedupeKey: row.dedupe_key,
  payload: JSON.parse(row.payload || "{}") as Record<string, unknown>,
  read: row.read_at !== null,
  readAt: row.read_at,
  createdAt: row.created_at,
});

export type CreateNotificationInput = {
  userId: string;
  actorId?: string | null;
  actorName: string;
  actorAvatarUrl?: string | null;
  type: ServerNotificationType;
  title: string;
  message: string;
  sceneId?: string | null;
  sceneName?: string | null;
  teamId?: string | null;
  teamName?: string | null;
  commentId?: string | null;
  elementId?: string | null;
  dedupeKey?: string | null;
  payload?: Record<string, unknown>;
};

/**
 * Persists a notification (deduplicated per user via `dedupeKey`), enforces a
 * bounded per-user history, and pushes it over the user's live SSE/WS stream.
 */
export const createAndPushNotification = (
  ctx: AppContext,
  input: CreateNotificationInput,
) => {
  if (!input.userId || (input.actorId && input.actorId === input.userId)) {
    return null;
  }

  const { db, hub } = ctx;
  const id = newId();
  const createdAt = now();
  const payloadJSON = JSON.stringify(input.payload ?? {});

  const result = db
    .prepare(
      `INSERT OR IGNORE INTO notifications (
        id, user_id, actor_id, actor_name, actor_avatar_url,
        type, title, message, scene_id, scene_name,
        team_id, team_name, comment_id, element_id,
        dedupe_key, payload, read_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    )
    .run(
      id,
      input.userId,
      input.actorId ?? null,
      input.actorName,
      input.actorAvatarUrl ?? null,
      input.type,
      input.title,
      input.message,
      input.sceneId ?? null,
      input.sceneName ?? null,
      input.teamId ?? null,
      input.teamName ?? null,
      input.commentId ?? null,
      input.elementId ?? null,
      input.dedupeKey ?? null,
      payloadJSON,
      createdAt,
    );

  if (result.changes === 0) {
    return null;
  }

  // Keep per-user table bounded
  run(
    db,
    `DELETE FROM notifications WHERE user_id = ? AND id NOT IN (
       SELECT id FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
     )`,
    input.userId,
    input.userId,
    MAX_NOTIFICATIONS_PER_USER,
  );

  const row = get<NotificationRow>(
    db,
    "SELECT * FROM notifications WHERE id = ?",
    id,
  );
  if (!row) {
    return null;
  }

  const serialized = notificationJSON(row);
  hub.broadcast(userNotificationChannel(input.userId), "notification", {
    notification: serialized,
  });
  return serialized;
};

export const extractCanvasMentionsFromElements = (
  elements: readonly any[],
  people: readonly { userId: string; name: string; email: string }[],
) => {
  if (!Array.isArray(elements) || people.length === 0) {
    return [];
  }

  const normalize = (val: string) =>
    val
      .trim()
      .replace(/^@+/, "")
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9._-]/g, "");

  const hits: {
    userId: string;
    name: string;
    elementId: string;
    textSnippet: string;
    x?: number;
    y?: number;
  }[] = [];
  const seen = new Set<string>();

  for (const el of elements) {
    if (!el || el.isDeleted || el.type !== "text") {
      continue;
    }
    const text = String(el.originalText ?? el.text ?? "");
    if (!text.includes("@")) {
      continue;
    }

    const snippet = text.replace(/\s+/g, " ").trim().slice(0, 140);

    for (const person of people) {
      const nameLower = person.name.toLowerCase();
      const handle = normalize(person.name);
      const firstToken = normalize(person.name.split(/\s+/)[0] || "");
      const emailLocal = normalize(person.email.split("@")[0] || "");

      const candidates = new Set(
        [nameLower, handle, firstToken, emailLocal].filter(Boolean),
      );

      let matched = false;
      const atMatches = text.matchAll(
        /(?:^|[^a-zA-Z0-9._%+-])@(?:"([^"\r\n]{1,64})"|([a-zA-Z0-9][a-zA-Z0-9._ -]{0,63}))/g,
      );
      for (const m of atMatches) {
        const rawToken = (m[1] || m[2] || "").trim();
        const rawLower = rawToken.toLowerCase();
        const rawHandle = normalize(rawToken);
        if (
          candidates.has(rawLower) ||
          candidates.has(rawHandle) ||
          rawLower.startsWith(`${nameLower} `) ||
          rawLower === nameLower ||
          rawLower.split(/[\s.,!?;:)\]]/)[0] === handle ||
          (firstToken && rawLower.split(/[\s.,!?;:)\]]/)[0] === firstToken)
        ) {
          matched = true;
          break;
        }
      }

      if (matched) {
        const key = `${el.id}:${person.userId}`;
        if (!seen.has(key)) {
          seen.add(key);
          hits.push({
            userId: person.userId,
            name: person.name,
            elementId: el.id,
            textSnippet: snippet,
            x: typeof el.x === "number" ? el.x : undefined,
            y: typeof el.y === "number" ? el.y : undefined,
          });
        }
      }
    }
  }

  return hits;
};

export const registerNotificationRoutes = (router: Router, ctx: AppContext) => {
  const { db, hub } = ctx;

  router.get("/api/v1/notifications", (req) => {
    const user = requireUser(db, req);
    const rows = all<NotificationRow>(
      db,
      `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`,
      user.id,
    );
    const unread = get<{ n: number }>(
      db,
      "SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL",
      user.id,
    )!.n;

    return {
      unread,
      notifications: rows.map(notificationJSON),
    };
  });

  router.post("/api/v1/notifications/:notificationId/read", (req) => {
    const user = requireUser(db, req);
    const timestamp = now();
    run(
      db,
      "UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND user_id = ?",
      timestamp,
      req.params.notificationId,
      user.id,
    );
    return { ok: true };
  });

  router.post("/api/v1/notifications/read-all", (req) => {
    const user = requireUser(db, req);
    run(
      db,
      "UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE user_id = ? AND read_at IS NULL",
      now(),
      user.id,
    );
    return { ok: true };
  });

  router.delete("/api/v1/notifications/:notificationId", (req) => {
    const user = requireUser(db, req);
    run(
      db,
      "DELETE FROM notifications WHERE id = ? AND user_id = ?",
      req.params.notificationId,
      user.id,
    );
    return { ok: true };
  });

  router.delete("/api/v1/notifications", (req) => {
    const user = requireUser(db, req);
    run(db, "DELETE FROM notifications WHERE user_id = ?", user.id);
    return { ok: true };
  });

  router.get("/api/v1/notifications/events", (req, res) => {
    const user = requireUser(db, req);
    hub.connectSSE(userNotificationChannel(user.id), res, {
      id: user.id,
      name: user.name,
      avatarUrl: user.avatar_url ?? null,
    });
  });
};

const NOTIFICATION_SOCKET_PATH = /^\/api\/v1\/notifications\/ws\/?$/;

export const handleNotificationSocket = (
  ctx: AppContext,
  raw: IncomingMessage,
  socket: Duplex,
  head: Buffer,
) => {
  const url = new URL(raw.url || "/", "http://localhost");
  if (!NOTIFICATION_SOCKET_PATH.test(url.pathname)) {
    return false;
  }

  const req: Request = {
    raw,
    method: "GET",
    path: url.pathname,
    query: url.searchParams,
    params: {},
    headers: raw.headers,
    cookies: parseCookies(raw.headers.cookie),
    ip: raw.socket.remoteAddress || "unknown",
    body: async () => ({}),
  };

  let user;
  try {
    user = getUser(ctx.db, req);
    if (!user) {
      throw new HttpError(401, "Unauthorized");
    }
  } catch {
    socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    return true;
  }

  const ws = acceptWebSocket(raw, socket, head);
  if (!ws) {
    return true;
  }

  ctx.hub.connectWebSocket(userNotificationChannel(user.id), ws, {
    id: user.id,
    name: user.name,
    avatarUrl: user.avatar_url ?? null,
  });

  return true;
};
