import { appJotaiStore } from "../app-jotai";

import {
  nativeNotificationPermissionAtom,
  nativeNotificationsEnabledAtom,
} from "./store";

import type { AppNotification } from "./types";

export type NativePermissionState = NotificationPermission | "unsupported";

const NATIVE_PREF_STORAGE_KEY = "excalidraw-native-notifications-enabled";
const NATIVE_NOTIFICATION_ICON = "/android-chrome-192x192.png";

export const getNativeNotificationPermission = (): NativePermissionState => {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return "unsupported";
  }
  return Notification.permission;
};

export const loadNativeNotificationPreference = (): boolean => {
  try {
    const raw = localStorage.getItem(NATIVE_PREF_STORAGE_KEY);
    if (raw === null) {
      return true;
    }
    return raw === "true";
  } catch {
    return true;
  }
};

export const setNativeNotificationPreference = (enabled: boolean) => {
  appJotaiStore.set(nativeNotificationsEnabledAtom, enabled);
  try {
    localStorage.setItem(NATIVE_PREF_STORAGE_KEY, String(enabled));
  } catch {
    // Ignore storage write error
  }
};

export const syncNativeNotificationPermissionAtom = () => {
  appJotaiStore.set(
    nativeNotificationPermissionAtom,
    getNativeNotificationPermission(),
  );
};

export const requestNativeNotificationPermission =
  async (): Promise<NativePermissionState> => {
    if (typeof window === "undefined" || typeof Notification === "undefined") {
      syncNativeNotificationPermissionAtom();
      return "unsupported";
    }
    try {
      const result = await Notification.requestPermission();
      appJotaiStore.set(nativeNotificationPermissionAtom, result);
      if (result === "granted") {
        setNativeNotificationPreference(true);
      }
      return result;
    } catch {
      syncNativeNotificationPermissionAtom();
      return getNativeNotificationPermission();
    }
  };

export interface ShowNativeNotificationOptions {
  /** Show even if the browser window currently has focus. */
  force?: boolean;
  doc?: Document;
  onActivate?: (notification: AppNotification) => void;
}

/**
 * Displays a native OS / browser popup notification (using the Web
 * Notifications API) when Chrome is minimized, hidden, or unfocused, and wires
 * `onclick` to focus the window and bring up the main in-app Notification
 * Center with the notification details.
 */
export const showNativeNotification = (
  notification: AppNotification,
  options: ShowNativeNotificationOptions = {},
): Notification | null => {
  const doc =
    options.doc ?? (typeof document !== "undefined" ? document : undefined);
  const win =
    doc?.defaultView ?? (typeof window !== "undefined" ? window : undefined);

  if (
    !win ||
    typeof Notification === "undefined" ||
    Notification.permission !== "granted"
  ) {
    return null;
  }

  if (!appJotaiStore.get(nativeNotificationsEnabledAtom)) {
    return null;
  }

  const isBackgrounded = doc ? doc.hidden || !doc.hasFocus() : false;
  if (!options.force && !isBackgrounded) {
    return null;
  }

  const title = `New notification — ${notification.title}`;
  const body = `${notification.message}\nClick to view in Excalidraw`;

  try {
    const nativeNotif = new Notification(title, {
      body,
      icon: NATIVE_NOTIFICATION_ICON,
      badge: NATIVE_NOTIFICATION_ICON,
      tag: notification.dedupeKey || notification.id,
      requireInteraction: false,
    });

    nativeNotif.onclick = (event) => {
      event.preventDefault();
      try {
        win.focus();
      } catch {
        // Ignore focus errors in restricted contexts
      }
      nativeNotif.close();
      options.onActivate?.(notification);
    };

    return nativeNotif;
  } catch {
    // Fallback via active Service Worker registration if available (e.g. Android Chrome)
    try {
      if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
        void navigator.serviceWorker.getRegistration().then((reg) => {
          reg?.showNotification(title, {
            body,
            icon: NATIVE_NOTIFICATION_ICON,
            tag: notification.dedupeKey || notification.id,
            data: { notificationId: notification.id },
          });
        });
      }
    } catch {
      // Ignore SW notification failure
    }
    return null;
  }
};
