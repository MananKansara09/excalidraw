import clsx from "clsx";
import React, { useMemo, useState } from "react";

import { useAtom, useAtomValue } from "../../app-jotai";
import { plusUserAtom } from "../../plus/state";
import { notificationEngine } from "../NotificationEngine";
import {
  requestNativeNotificationPermission,
  setNativeNotificationPreference,
} from "../nativeNotifications";
import {
  currentUserAtom,
  nativeNotificationPermissionAtom,
  nativeNotificationsEnabledAtom,
  notificationFilterAtom,
  notificationsAtom,
  unreadNotificationCountAtom,
} from "../store";

import "./NotificationCenter.scss";

import type { AppNotification, NotificationFilter } from "../types";

const formatRelativeTime = (timestamp: number): string => {
  const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSec < 10) {
    return "Just now";
  }
  if (diffSec < 60) {
    return `${diffSec}s ago`;
  }
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return `${diffMin}m ago`;
  }
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) {
    return `${diffHr}h ago`;
  }
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
};

const getTypeBadge = (type: AppNotification["type"]) => {
  switch (type) {
    case "share_invite":
    case "scene_share":
      return { label: "Share", className: "is-share" };
    case "scene_assigned":
      return { label: "Scene", className: "is-share" };
    case "team_added":
      return { label: "Team", className: "is-team" };
    case "comment_mention":
      return { label: "Chat @", className: "is-mention" };
    case "comment_reply":
      return { label: "Reply", className: "is-mention" };
    case "canvas_mention":
      return { label: "@Mention", className: "is-mention" };
    default:
      return { label: "System", className: "is-system" };
  }
};

const getActionLabel = (notification: AppNotification): string | undefined => {
  switch (notification.type) {
    case "share_invite":
      return "Open canvas";
    case "scene_share":
    case "scene_assigned":
      return "Open scene";
    case "team_added":
      return "Open team";
    case "comment_mention":
    case "comment_reply":
      return "Open chat";
    case "canvas_mention":
      return "Jump to mention";
    case "system":
      return notification.payload.actionLabel;
  }
};

export interface NotificationCenterProps {
  onClose?: () => void;
  onSelectNotification: (notification: AppNotification) => void;
}

export const NotificationCenter: React.FC<NotificationCenterProps> = ({
  onSelectNotification,
}) => {
  const currentUser = useAtomValue(currentUserAtom);
  const plusUser = useAtomValue(plusUserAtom);
  const notifications = useAtomValue(notificationsAtom);
  const unreadCount = useAtomValue(unreadNotificationCountAtom);
  const [filter, setFilter] = useAtom(notificationFilterAtom);
  const nativePermission = useAtomValue(nativeNotificationPermissionAtom);
  const nativeEnabled = useAtomValue(nativeNotificationsEnabledAtom);

  const [isEditingIdentity, setIsEditingIdentity] = useState(false);
  const [nameDraft, setNameDraft] = useState(currentUser.username);

  const filteredNotifications = useMemo(() => {
    switch (filter) {
      case "unread":
        return notifications.filter((n) => !n.read);
      case "mentions":
        return notifications.filter(
          (n) =>
            n.type === "canvas_mention" ||
            n.type === "comment_mention" ||
            n.type === "comment_reply",
        );
      case "shares":
        return notifications.filter(
          (n) =>
            n.type === "share_invite" ||
            n.type === "scene_share" ||
            n.type === "scene_assigned",
        );
      case "teams":
        return notifications.filter((n) => n.type === "team_added");
      default:
        return notifications;
    }
  }, [notifications, filter]);

  const handleIdentitySave = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      return;
    }
    await notificationEngine.updateCurrentUser(trimmed);
    setIsEditingIdentity(false);
  };

  const filters: Array<{ key: NotificationFilter; label: string }> = [
    { key: "all", label: "All" },
    { key: "unread", label: `Unread (${unreadCount})` },
    { key: "mentions", label: "Mentions" },
    { key: "shares", label: "Shares" },
    { key: "teams", label: "Teams" },
  ];

  return (
    <div className="NotificationCenter" data-testid="notification-center">
      <div className="NotificationCenter__header">
        <div className="NotificationCenter__titleRow">
          <h4 className="NotificationCenter__title">Notifications</h4>
          {unreadCount > 0 && (
            <span className="NotificationCenter__unreadPill">
              {unreadCount} new
            </span>
          )}
        </div>
        <div className="NotificationCenter__headerActions">
          {unreadCount > 0 && (
            <button
              type="button"
              className="NotificationCenter__textBtn"
              onClick={() => notificationEngine.markAllAsRead()}
            >
              Mark all read
            </button>
          )}
          {notifications.length > 0 && (
            <button
              type="button"
              className="NotificationCenter__textBtn is-danger"
              onClick={() => notificationEngine.clearAll()}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="NotificationCenter__identityBar">
        {plusUser ? (
          <div className="NotificationCenter__identitySummary">
            <span>
              Signed in as <strong>{plusUser.name}</strong> (
              <code>@{currentUser.handle}</code>)
            </span>
          </div>
        ) : isEditingIdentity ? (
          <form
            className="NotificationCenter__identityForm"
            onSubmit={handleIdentitySave}
          >
            <input
              type="text"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              placeholder="Your display name"
              aria-label="Your display name"
              autoFocus
            />
            <button type="submit" className="NotificationCenter__saveBtn">
              Save
            </button>
            <button
              type="button"
              className="NotificationCenter__textBtn"
              onClick={() => {
                setNameDraft(currentUser.username);
                setIsEditingIdentity(false);
              }}
            >
              Cancel
            </button>
          </form>
        ) : (
          <div className="NotificationCenter__identitySummary">
            <span>
              Receiving as <strong>@{currentUser.handle}</strong> (
              {currentUser.username})
            </span>
            <button
              type="button"
              className="NotificationCenter__textBtn"
              onClick={() => {
                setNameDraft(currentUser.username);
                setIsEditingIdentity(true);
              }}
            >
              Switch
            </button>
          </div>
        )}
      </div>

      {nativePermission !== "unsupported" && (
        <div className="NotificationCenter__desktopBar">
          {nativePermission === "default" ? (
            <>
              <span>Get native desktop alerts when Chrome is minimized</span>
              <button
                type="button"
                className="NotificationCenter__saveBtn"
                data-testid="enable-desktop-notifications-btn"
                onClick={() => void requestNativeNotificationPermission()}
              >
                Enable alerts
              </button>
            </>
          ) : nativePermission === "granted" ? (
            <label className="NotificationCenter__desktopToggle">
              <input
                type="checkbox"
                checked={nativeEnabled}
                onChange={(e) =>
                  setNativeNotificationPreference(e.target.checked)
                }
              />
              <span>Desktop popups when minimized / away</span>
            </label>
          ) : (
            <span className="NotificationCenter__desktopBlocked">
              Desktop alerts blocked in browser site settings
            </span>
          )}
        </div>
      )}

      <div className="NotificationCenter__filters" role="tablist">
        {filters.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={filter === item.key}
            className={clsx("NotificationCenter__filterTab", {
              "is-active": filter === item.key,
            })}
            onClick={() => setFilter(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="NotificationCenter__list">
        {filteredNotifications.length === 0 ? (
          <div className="NotificationCenter__empty">
            <div className="NotificationCenter__emptyTitle">
              No notifications yet
            </div>
            <div className="NotificationCenter__emptyHint">
              You&apos;ll see real-time alerts here for scene shares, team
              invitations, chat replies, and canvas mentions of{" "}
              <code>@{currentUser.handle}</code>.
            </div>
          </div>
        ) : (
          filteredNotifications.map((notification) => {
            const badge = getTypeBadge(notification.type);
            const actionLabel = getActionLabel(notification);

            return (
              <div
                key={notification.id}
                className={clsx("NotificationCenter__item", {
                  "is-unread": !notification.read,
                })}
                data-testid={`notification-item-${notification.id}`}
              >
                <div className="NotificationCenter__itemTop">
                  <span
                    className={clsx(
                      "NotificationCenter__typeBadge",
                      badge.className,
                    )}
                  >
                    {badge.label}
                  </span>
                  <span className="NotificationCenter__time">
                    {formatRelativeTime(notification.createdAt)}
                  </span>
                </div>

                <div className="NotificationCenter__itemTitle">
                  {!notification.read && (
                    <span
                      className="NotificationCenter__unreadDot"
                      aria-hidden="true"
                    />
                  )}
                  <span>{notification.title}</span>
                </div>

                <div className="NotificationCenter__itemMessage">
                  {notification.message}
                </div>

                <div className="NotificationCenter__itemActions">
                  {actionLabel && (
                    <button
                      type="button"
                      className="NotificationCenter__primaryAction"
                      onClick={() => {
                        notificationEngine.markAsRead(notification.id);
                        onSelectNotification(notification);
                      }}
                    >
                      {actionLabel}
                    </button>
                  )}
                  {!notification.read && (
                    <button
                      type="button"
                      className="NotificationCenter__textBtn"
                      onClick={() =>
                        notificationEngine.markAsRead(notification.id)
                      }
                    >
                      Mark read
                    </button>
                  )}
                  <button
                    type="button"
                    className="NotificationCenter__textBtn"
                    onClick={() => notificationEngine.dismiss(notification.id)}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
