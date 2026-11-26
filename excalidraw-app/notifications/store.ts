import { atom } from "../app-jotai";

import { getOrCreateUserIdentity, loadKnownUsersFromStorage } from "./identity";

import type {
  AppNotification,
  KnownUser,
  NotificationFilter,
  SharedCollaboratorEntry,
  UserIdentity,
} from "./types";

export const currentUserAtom = atom<UserIdentity>(getOrCreateUserIdentity());

export const notificationsAtom = atom<AppNotification[]>([]);

export const unreadNotificationCountAtom = atom((get) => {
  const notifications = get(notificationsAtom);
  let count = 0;
  for (const item of notifications) {
    if (!item.read) {
      count++;
    }
  }
  return count;
});

export const notificationToastQueueAtom = atom<AppNotification[]>([]);

export const notificationCenterOpenAtom = atom(false);

export const notificationFilterAtom = atom<NotificationFilter>("all");

export const knownUsersAtom = atom<KnownUser[]>(loadKnownUsersFromStorage());

export const sharedUsersByRoomAtom = atom<
  Record<string, SharedCollaboratorEntry[]>
>({});
