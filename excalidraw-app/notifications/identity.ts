import { STORAGE_KEYS } from "../app_constants";

import type { AppNotification, KnownUser, UserIdentity } from "./types";

const MAX_KNOWN_USERS = 100;
const TAB_IDENTITY_SESSION_KEY = "excalidraw-tab-identity";

/**
 * Normalizes a display name or raw handle into a consistent mentionable handle.
 * Examples:
 * - "Alice Smith" -> "alice_smith"
 * - "@Bob.Dev" -> "bob.dev"
 */
export const normalizeHandle = (input: string): string => {
  const cleaned = input
    .trim()
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9._-]/g, "");

  return cleaned || "user";
};

const generateUserId = (): string => {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `usr_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
};

const getQueryUsername = (): string | null => {
  try {
    if (typeof window === "undefined") {
      return null;
    }
    const userParam = new URLSearchParams(window.location.search).get("user");
    return userParam?.trim() || null;
  } catch {
    return null;
  }
};

const getSessionIdentity = (): UserIdentity | null => {
  try {
    if (typeof sessionStorage === "undefined") {
      return null;
    }
    const raw = sessionStorage.getItem(TAB_IDENTITY_SESSION_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.id === "string" &&
      parsed.id &&
      typeof parsed?.username === "string" &&
      parsed.username.trim()
    ) {
      return {
        id: parsed.id,
        username: parsed.username.trim(),
        handle: normalizeHandle(parsed.username),
      };
    }
  } catch {
    // Ignore sessionStorage read errors
  }
  return null;
};

const saveSessionIdentity = (identity: UserIdentity) => {
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(
        TAB_IDENTITY_SESSION_KEY,
        JSON.stringify(identity),
      );
    }
  } catch {
    // Ignore sessionStorage write errors
  }
};

export const getStoredCollabProfile = (): {
  username: string;
  userId: string;
} => {
  let username = "";
  let userId = "";

  try {
    const raw = localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_COLLAB);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.username === "string") {
        username = parsed.username;
      }
      if (typeof parsed?.userId === "string" && parsed.userId.trim()) {
        userId = parsed.userId;
      }
    }
  } catch {
    // Ignore storage read errors
  }

  if (!userId) {
    userId = generateUserId();
    try {
      localStorage.setItem(
        STORAGE_KEYS.LOCAL_STORAGE_COLLAB,
        JSON.stringify({ username, userId }),
      );
    } catch {
      // Ignore storage write errors
    }
  }

  return { username, userId };
};

export const persistCollabProfile = (profile: {
  username: string;
  userId?: string;
  syncLocalStorage?: boolean;
}): UserIdentity => {
  const currentSession = getSessionIdentity();
  const currentCollab = getStoredCollabProfile();
  const username =
    profile.username.trim() ||
    currentSession?.username ||
    currentCollab.username ||
    "Guest";
  const handle = normalizeHandle(username);

  // If the handle changed in this tab, assign a clean tab-scoped ID so two
  // tabs in the same browser testing different users never share an ID.
  const handleChanged = currentSession && currentSession.handle !== handle;
  const userId =
    profile.userId ||
    (handleChanged ? generateUserId() : currentSession?.id || generateUserId());

  const identity: UserIdentity = {
    id: userId,
    username,
    handle,
  };

  saveSessionIdentity(identity);

  if (profile.syncLocalStorage !== false) {
    try {
      localStorage.setItem(
        STORAGE_KEYS.LOCAL_STORAGE_COLLAB,
        JSON.stringify({ username, userId: currentCollab.userId }),
      );
    } catch {
      // Ignore storage write errors
    }
  }

  return identity;
};

export const getOrCreateUserIdentity = (
  fallbackUsername?: string,
): UserIdentity => {
  const queryUsername = getQueryUsername();
  const sessionIdentity = getSessionIdentity();

  if (queryUsername) {
    const queryHandle = normalizeHandle(queryUsername);
    if (sessionIdentity && sessionIdentity.handle === queryHandle) {
      return { ...sessionIdentity, username: queryUsername };
    }
    const identity: UserIdentity = {
      id: generateUserId(),
      username: queryUsername,
      handle: queryHandle,
    };
    saveSessionIdentity(identity);
    return identity;
  }

  if (sessionIdentity) {
    return sessionIdentity;
  }

  const { username } = getStoredCollabProfile();
  const tabId = generateUserId();
  const resolvedName =
    username.trim() || fallbackUsername?.trim() || `User_${tabId.slice(0, 4)}`;

  const identity: UserIdentity = {
    id: tabId,
    username: resolvedName,
    handle: normalizeHandle(resolvedName),
  };

  saveSessionIdentity(identity);

  if (!username.trim()) {
    try {
      const stored = getStoredCollabProfile();
      localStorage.setItem(
        STORAGE_KEYS.LOCAL_STORAGE_COLLAB,
        JSON.stringify({ username: resolvedName, userId: stored.userId }),
      );
    } catch {
      // Ignore storage write errors
    }
  }

  return identity;
};

export const matchesRecipient = (
  notification: Pick<
    AppNotification,
    "recipientId" | "recipientHandle" | "sender"
  >,
  identity: UserIdentity,
): boolean => {
  const targetHandle = notification.recipientHandle
    ? normalizeHandle(notification.recipientHandle)
    : undefined;

  if (targetHandle === "everyone" || targetHandle === "all") {
    return notification.sender.id !== identity.id;
  }

  if (notification.recipientId && notification.recipientId === identity.id) {
    return true;
  }

  if (targetHandle && targetHandle === identity.handle) {
    return true;
  }

  // Also allow matching by first token of multi-word username (e.g. @alice -> "Alice Smith")
  if (targetHandle) {
    const firstWordHandle = normalizeHandle(
      identity.username.split(/\s+/)[0] || "",
    );
    if (firstWordHandle && targetHandle === firstWordHandle) {
      return true;
    }
  }

  return false;
};

export const loadKnownUsersFromStorage = (): KnownUser[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_KNOWN_USERS);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(
        (u): u is KnownUser =>
          u &&
          typeof u.id === "string" &&
          typeof u.username === "string" &&
          typeof u.handle === "string",
      )
      .slice(0, MAX_KNOWN_USERS);
  } catch {
    return [];
  }
};

export const saveKnownUsersToStorage = (users: KnownUser[]) => {
  try {
    const bounded = [...users]
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      .slice(0, MAX_KNOWN_USERS);
    localStorage.setItem(
      STORAGE_KEYS.LOCAL_STORAGE_KNOWN_USERS,
      JSON.stringify(bounded),
    );
  } catch {
    // Ignore storage write errors
  }
};
