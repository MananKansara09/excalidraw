/**
 * Client for the Excalidraw Plus server (`plus-server/`). The app reaches it
 * same-origin under `/api` (proxied by Vite in development), so the session
 * cookie is sent without any CORS setup.
 */

export const PLUS_API_BASE: string =
  import.meta.env.VITE_APP_PLUS_API || "/api/v1";

export class PlusAPIError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type PlusUser = {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
  createdAt: number;
  hasAIKey: boolean;
};

export type SceneRole = "owner" | "editor" | "viewer";
export type TeamRole = "owner" | "admin" | "member";

export type SceneSummary = {
  id: string;
  name: string;
  ownerId: string;
  teamId: string | null;
  folderId: string | null;
  version: number;
  elementCount: number;
  createdAt: number;
  updatedAt: number;
  /** When the preview image was rendered; `null` if there is none yet. */
  thumbnailAt?: number | null;
  role?: SceneRole;
};

export type SceneDetail = SceneSummary & {
  role: SceneRole;
  elements: any[];
  appState: Record<string, unknown>;
  presentation: string[];
  files?: Record<string, PlusFile>;
};

export type PlusFile = {
  id: string;
  mimeType: string;
  dataURL: string;
  created?: number;
};

export type Folder = {
  id: string;
  name: string;
  parentId: string | null;
  teamId: string | null;
  ownerId: string;
  createdAt: number;
};

export type TeamSummary = {
  id: string;
  name: string;
  role: TeamRole;
  memberCount: number;
  createdAt: number;
};

export type TeamDetail = {
  id: string;
  name: string;
  role: TeamRole;
  createdAt: number;
  members: {
    userId: string;
    name: string;
    email: string;
    avatarUrl: string | null;
    role: TeamRole;
    joinedAt: number;
  }[];
  invites: { id: string; email: string; role: TeamRole; createdAt: number }[];
};

export type SceneAccess = {
  owner: {
    userId: string;
    name: string;
    email: string;
    avatarUrl: string | null;
  };
  teamId: string | null;
  collaborators: {
    userId: string;
    name: string;
    email: string;
    avatarUrl: string | null;
    role: "editor" | "viewer";
  }[];
  links: {
    token: string;
    role: "editor" | "viewer";
    createdAt: number;
    url: string | null;
  }[];
};

export type PlusComment = {
  id: string;
  sceneId: string;
  parentId: string | null;
  author: { id: string; name: string; avatarUrl: string | null };
  elementId: string | null;
  x: number | null;
  y: number | null;
  body: string;
  mentions: Mention[];
  resolved: boolean;
  createdAt: number;
  updatedAt: number;
};

export type Mention = { userId: string; name: string };

export type Person = {
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
};

export type MentionInboxItem = PlusComment & {
  sceneName: string;
  unread: boolean;
};

export type ServerNotificationType =
  | "scene_share"
  | "scene_assigned"
  | "team_added"
  | "canvas_mention"
  | "comment_mention"
  | "comment_reply";

export type ServerNotification = {
  id: string;
  userId: string;
  actor: { id: string | null; name: string; avatarUrl: string | null };
  type: ServerNotificationType;
  title: string;
  message: string;
  sceneId: string | null;
  sceneName: string | null;
  teamId: string | null;
  teamName: string | null;
  commentId: string | null;
  elementId: string | null;
  dedupeKey: string | null;
  payload: Record<string, unknown>;
  read: boolean;
  readAt: number | null;
  createdAt: number;
};

export type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  createdAt: number;
  lastUsedAt: number | null;
};

export type AIUsage = {
  model: string;
  configured: boolean;
  ownKey: boolean;
  limit: number | null;
  used: number;
  remaining: number | null;
};

/** Share-link token of the scene opened via `#share=`, sent with requests. */
let activeShareToken: string | null = null;
export const setActiveShareToken = (token: string | null) => {
  activeShareToken = token;
};
export const getActiveShareToken = () => activeShareToken;

export const plusFetch = async <T>(
  path: string,
  init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> => {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (activeShareToken) {
    headers["X-Share-Token"] = activeShareToken;
  }
  let res: Response;
  try {
    res = await fetch(`${PLUS_API_BASE}${path}`, {
      method: init.method || "GET",
      headers,
      credentials: "same-origin",
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
    });
  } catch (error: any) {
    if (error?.name === "AbortError") {
      throw error;
    }
    throw new PlusAPIError(0, "Can't reach the Excalidraw Plus server");
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON body, e.g. a proxy error page
  }
  if (!res.ok) {
    throw new PlusAPIError(
      res.status,
      data?.message ||
        (res.status === 404 && !data
          ? "The Excalidraw Plus server isn't running"
          : `Request failed (${res.status})`),
    );
  }
  return data as T;
};

const q = (params: Record<string, string | null | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      search.set(key, value);
    }
  }
  const str = search.toString();
  return str ? `?${str}` : "";
};

/** The preview image of a scene (`thumbnailAt` busts the browser cache). */
export const sceneThumbnailURL = (id: string, thumbnailAt: number) =>
  `${PLUS_API_BASE}/scenes/${id}/thumbnail?v=${thumbnailAt}`;

export const plusAPI = {
  // account
  me: () => plusFetch<{ user: PlusUser }>("/me"),
  signUp: (body: { email: string; name: string; password: string }) =>
    plusFetch<{ user: PlusUser }>("/auth/signup", { method: "POST", body }),
  login: (body: { email: string; password: string }) =>
    plusFetch<{ user: PlusUser }>("/auth/login", { method: "POST", body }),
  logout: () => plusFetch("/auth/logout", { method: "POST", body: {} }),
  updateMe: (body: {
    name?: string;
    avatarUrl?: string | null;
    aiKey?: string | null;
    password?: string;
    currentPassword?: string;
  }) => plusFetch<{ user: PlusUser }>("/me", { method: "PATCH", body }),
  listApiKeys: () => plusFetch<{ apiKeys: ApiKey[] }>("/me/api-keys"),
  createApiKey: (name: string) =>
    plusFetch<{ id: string; name: string; key: string }>("/me/api-keys", {
      method: "POST",
      body: { name },
    }),
  deleteApiKey: (id: string) =>
    plusFetch(`/me/api-keys/${id}`, { method: "DELETE" }),
  aiUsage: () => plusFetch<AIUsage>("/ai/usage"),

  // teams
  listTeams: () => plusFetch<{ teams: TeamSummary[] }>("/teams"),
  createTeam: (name: string) =>
    plusFetch<{ team: TeamDetail }>("/teams", {
      method: "POST",
      body: { name },
    }),
  getTeam: (id: string) => plusFetch<{ team: TeamDetail }>(`/teams/${id}`),
  renameTeam: (id: string, name: string) =>
    plusFetch<{ team: TeamDetail }>(`/teams/${id}`, {
      method: "PATCH",
      body: { name },
    }),
  deleteTeam: (id: string) => plusFetch(`/teams/${id}`, { method: "DELETE" }),
  inviteToTeam: (id: string, email: string, role: "admin" | "member") =>
    plusFetch<{ added: boolean; team: TeamDetail }>(`/teams/${id}/invites`, {
      method: "POST",
      body: { email, role },
    }),
  cancelInvite: (teamId: string, inviteId: string) =>
    plusFetch<{ team: TeamDetail }>(`/teams/${teamId}/invites/${inviteId}`, {
      method: "DELETE",
    }),
  setMemberRole: (teamId: string, userId: string, role: TeamRole) =>
    plusFetch<{ team: TeamDetail }>(`/teams/${teamId}/members/${userId}`, {
      method: "PATCH",
      body: { role },
    }),
  removeMember: (teamId: string, userId: string) =>
    plusFetch<{ team?: TeamDetail }>(`/teams/${teamId}/members/${userId}`, {
      method: "DELETE",
    }),

  // folders
  listFolders: (teamId: string | null) =>
    plusFetch<{ folders: Folder[] }>(`/folders${q({ teamId })}`),
  createFolder: (body: {
    name: string;
    parentId?: string | null;
    teamId?: string | null;
  }) => plusFetch<{ folder: Folder }>("/folders", { method: "POST", body }),
  updateFolder: (
    id: string,
    body: { name?: string; parentId?: string | null },
  ) =>
    plusFetch<{ folder: Folder }>(`/folders/${id}`, { method: "PATCH", body }),
  deleteFolder: (id: string) =>
    plusFetch(`/folders/${id}`, { method: "DELETE" }),

  // scenes
  listScenes: (params: {
    scope?: "personal" | "team" | "shared" | "all";
    teamId?: string | null;
    folderId?: string | null;
    q?: string | null;
  }) =>
    plusFetch<{ scenes: SceneSummary[] }>(
      `/scenes${q({
        scope: params.scope,
        teamId: params.teamId,
        folderId: params.folderId === null ? "root" : params.folderId,
        q: params.q || null,
      })}`,
    ),
  createScene: (body: {
    name: string;
    teamId?: string | null;
    folderId?: string | null;
    elements?: readonly any[];
    appState?: Record<string, unknown>;
    files?: Record<string, PlusFile>;
  }) => plusFetch<{ scene: SceneDetail }>("/scenes", { method: "POST", body }),
  getScene: (id: string) => plusFetch<{ scene: SceneDetail }>(`/scenes/${id}`),
  syncScene: (
    id: string,
    body: {
      elements?: readonly any[];
      appState?: Record<string, unknown>;
      files?: Record<string, PlusFile>;
      connectionId?: string | null;
    },
  ) =>
    plusFetch<{ version: number; accepted: number }>(`/scenes/${id}/sync`, {
      method: "POST",
      body,
    }),
  getSceneFiles: (id: string, ids: string[]) =>
    plusFetch<{ files: Record<string, PlusFile> }>(
      `/scenes/${id}/files${q({ ids: ids.join(",") })}`,
    ),
  updateScene: (
    id: string,
    body: {
      name?: string;
      presentation?: string[];
      teamId?: string | null;
      folderId?: string | null;
    },
  ) =>
    plusFetch<{ scene: SceneSummary }>(`/scenes/${id}`, {
      method: "PATCH",
      body,
    }),
  setSceneThumbnail: (id: string, image: string) =>
    plusFetch<{ thumbnailAt: number }>(`/scenes/${id}/thumbnail`, {
      method: "PUT",
      body: { image },
    }),
  duplicateScene: (id: string) =>
    plusFetch<{ scene: SceneSummary }>(`/scenes/${id}/duplicate`, {
      method: "POST",
      body: {},
    }),
  deleteScene: (id: string) => plusFetch(`/scenes/${id}`, { method: "DELETE" }),

  // sharing
  getAccess: (id: string) => plusFetch<SceneAccess>(`/scenes/${id}/access`),
  shareWithUser: (id: string, email: string, role: "editor" | "viewer") =>
    plusFetch<SceneAccess>(`/scenes/${id}/access`, {
      method: "POST",
      body: { email, role },
    }),
  unshareWithUser: (id: string, userId: string) =>
    plusFetch<SceneAccess>(`/scenes/${id}/access/${userId}`, {
      method: "DELETE",
    }),
  createLink: (id: string, role: "editor" | "viewer") =>
    plusFetch<SceneAccess>(`/scenes/${id}/links`, {
      method: "POST",
      body: { role },
    }),
  revokeLink: (id: string, token: string) =>
    plusFetch<SceneAccess>(`/scenes/${id}/links/${token}`, {
      method: "DELETE",
    }),
  resolveShareLink: (token: string) =>
    plusFetch<{ sceneId: string; role: "editor" | "viewer" }>(
      `/share/${token}`,
    ),

  // comments
  listComments: (sceneId: string) =>
    plusFetch<{ comments: PlusComment[] }>(`/scenes/${sceneId}/comments`),
  addComment: (
    sceneId: string,
    body: {
      body: string;
      parentId?: string | null;
      elementId?: string | null;
      x?: number | null;
      y?: number | null;
      mentions?: Mention[];
    },
  ) =>
    plusFetch<{ comment: PlusComment }>(`/scenes/${sceneId}/comments`, {
      method: "POST",
      body,
    }),
  updateComment: (id: string, body: { body?: string; resolved?: boolean }) =>
    plusFetch<{ comment: PlusComment }>(`/comments/${id}`, {
      method: "PATCH",
      body,
    }),
  deleteComment: (id: string) =>
    plusFetch(`/comments/${id}`, { method: "DELETE" }),
  listPeople: (sceneId: string) =>
    plusFetch<{ people: Person[] }>(`/scenes/${sceneId}/people`),
  myMentions: () =>
    plusFetch<{ unread: number; mentions: MentionInboxItem[] }>("/me/mentions"),
  markMentionsSeen: () =>
    plusFetch("/me/mentions/seen", { method: "POST", body: {} }),
  listNotifications: () =>
    plusFetch<{ unread: number; notifications: ServerNotification[] }>(
      "/notifications",
    ),
  markNotificationRead: (id: string) =>
    plusFetch(`/notifications/${id}/read`, { method: "POST", body: {} }),
  markAllNotificationsRead: () =>
    plusFetch("/notifications/read-all", { method: "POST", body: {} }),
  deleteNotification: (id: string) =>
    plusFetch(`/notifications/${id}`, { method: "DELETE" }),
  clearNotifications: () => plusFetch("/notifications", { method: "DELETE" }),
  notificationEventsURL: () => `${PLUS_API_BASE}/notifications/events`,
  syncCanvasMentions: (
    sceneId: string,
    body: {
      mentions?: Array<{
        elementId: string;
        textSnippet: string;
        recipientNameOrHandle: string;
        x?: number;
        y?: number;
      }>;
      elements?: readonly any[];
    },
  ) =>
    plusFetch<{ ok: boolean; notified: number }>(
      `/scenes/${sceneId}/mentions/sync`,
      { method: "POST", body },
    ),
  rtcConfig: () => plusFetch<{ iceServers: RTCIceServer[] }>("/rtc-config"),

  // realtime
  signal: (
    sceneId: string,
    body: { from: string; to?: string; type: string; data?: unknown },
  ) => plusFetch(`/scenes/${sceneId}/signal`, { method: "POST", body }),
  /** The realtime WebSocket (same events as `eventsURL`, plus live edits). */
  socketURL: (sceneId: string, name: string | null) => {
    const url = new URL(
      `${PLUS_API_BASE}/scenes/${sceneId}/ws${q({
        share: activeShareToken,
        name,
      })}`,
      window.location.href,
    );
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.toString();
  },
  eventsURL: (sceneId: string, name: string | null) =>
    `${PLUS_API_BASE}/scenes/${sceneId}/events${q({
      share: activeShareToken,
      name,
    })}`,
};
