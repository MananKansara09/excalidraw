import { createStore, del, get, set } from "idb-keyval";

import type { AppNotification, NotificationStorageAdapter } from "./types";

const IDB_DB_NAME = "excalidraw-notifications-db";
const IDB_STORE_NAME = "notifications";
const KEY_PREFIX = "inbox:";

const hasIndexedDB = () => {
  try {
    return typeof indexedDB !== "undefined";
  } catch {
    return false;
  }
};

export class IndexedDBNotificationStorage
  implements NotificationStorageAdapter
{
  private idbStore = hasIndexedDB()
    ? createStore(IDB_DB_NAME, IDB_STORE_NAME)
    : null;
  private memoryFallback = new Map<string, AppNotification[]>();

  async load(namespaceKey: string): Promise<AppNotification[]> {
    const key = `${KEY_PREFIX}${namespaceKey}`;
    if (this.idbStore) {
      try {
        const stored = await get<AppNotification[]>(key, this.idbStore);
        if (Array.isArray(stored)) {
          return stored;
        }
        return [];
      } catch {
        // Fall through to memory fallback if IDB fails (e.g. private browsing)
      }
    }
    return this.memoryFallback.get(key) ?? [];
  }

  async save(
    namespaceKey: string,
    notifications: AppNotification[],
  ): Promise<void> {
    const key = `${KEY_PREFIX}${namespaceKey}`;
    this.memoryFallback.set(key, notifications);

    if (this.idbStore) {
      try {
        await set(key, notifications, this.idbStore);
      } catch {
        // Ignore IDB write error; memoryFallback already holds the state
      }
    }
  }

  async clear(namespaceKey: string): Promise<void> {
    const key = `${KEY_PREFIX}${namespaceKey}`;
    this.memoryFallback.delete(key);

    if (this.idbStore) {
      try {
        await del(key, this.idbStore);
      } catch {
        // Ignore IDB delete error
      }
    }
  }
}
