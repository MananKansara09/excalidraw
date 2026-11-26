import clsx from "clsx";
import React, { useMemo, useState } from "react";

import { useAtom, useAtomValue } from "../../app-jotai";
import { notificationEngine } from "../NotificationEngine";
import {
  currentUserAtom,
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
      return { label: "Share", className: "is-share" };
    case "canvas_mention":
      return { label: "@Mention", className: "is-mention" };
    default:
      return { label: "System", className: "is-system" };
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
  const notifications = useAtomValue(notificationsAtom);
  const unreadCount = useAtomValue(unreadNotificationCountAtom);
  const [filter, setFilter] = useAtom(notificationFilterAtom);

  const [isEditingIdentity, setIsEditingIdentity] = useState(false);
  const [nameDraft, setNameDraft] = useState(currentUser.username);

  const filteredNotifications = useMemo(() => {
    switch (filter) {
      case "unread":
        return notifications.filter((n) => !n.read);
      case "canvas_mention":
        return notifications.filter((n) => n.type === "canvas_mention");
      case "share_invite":
        return notifications.filter((n) => n.type === "share_invite");
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
    { key: "canvas_mention", label: "Mentions" },
    { key: "share_invite", label: "Shares" },
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
        {isEditingIdentity ? (
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
              You&apos;ll see real-time alerts here when someone shares a canvas
              with you or mentions <code>@{currentUser.handle}</code> on the
              canvas.
            </div>
          </div>
        ) : (
          filteredNotifications.map((notification) => {
            const badge = getTypeBadge(notification.type);
            const actionLabel =
              notification.type === "share_invite"
                ? "Open canvas"
                : notification.type === "canvas_mention"
                ? "Jump to mention"
                : notification.payload.actionLabel;

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
