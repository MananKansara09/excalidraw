import React, { useEffect, useRef } from "react";

import { useAtomValue } from "../../app-jotai";
import { notificationEngine } from "../NotificationEngine";
import { notificationToastQueueAtom } from "../store";

import "./NotificationToast.scss";

import type { AppNotification } from "../types";

const TOAST_AUTO_DISMISS_MS = 6000;

const getToastMeta = (notification: AppNotification) => {
  switch (notification.type) {
    case "share_invite":
      return { pill: "Share", cta: "Open" };
    case "scene_share":
    case "scene_assigned":
      return { pill: "Scene", cta: "Open scene" };
    case "team_added":
      return { pill: "Team", cta: "Open team" };
    case "comment_mention":
    case "comment_reply":
      return { pill: "Chat", cta: "Open chat" };
    case "canvas_mention":
      return { pill: "@Mention", cta: "View" };
    case "system":
      return { pill: "Notice", cta: notification.payload.actionLabel };
  }
};

interface ToastCardProps {
  notification: AppNotification;
  onAction: (notification: AppNotification) => void;
}

const NotificationToastCard: React.FC<ToastCardProps> = ({
  notification,
  onAction,
}) => {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<number | null>(null);

  const scheduleDismiss = () => {
    const ownerWin = cardRef.current?.ownerDocument.defaultView ?? window;
    if (timerRef.current !== null) {
      ownerWin.clearTimeout(timerRef.current);
    }
    timerRef.current = ownerWin.setTimeout(() => {
      notificationEngine.dismissToast(notification.id);
    }, TOAST_AUTO_DISMISS_MS);
  };

  useEffect(() => {
    const ownerWin = cardRef.current?.ownerDocument.defaultView ?? window;
    scheduleDismiss();
    return () => {
      if (timerRef.current !== null) {
        ownerWin.clearTimeout(timerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notification.id]);

  const { pill, cta } = getToastMeta(notification);

  return (
    <div
      ref={cardRef}
      className={`NotificationToastCard is-${notification.type}`}
      role="status"
      aria-live="polite"
      data-testid={`notification-toast-${notification.id}`}
      onMouseEnter={() => {
        const ownerWin = cardRef.current?.ownerDocument.defaultView ?? window;
        if (timerRef.current !== null) {
          ownerWin.clearTimeout(timerRef.current);
          timerRef.current = null;
        }
      }}
      onMouseLeave={scheduleDismiss}
    >
      <div className="NotificationToastCard__body">
        <div className="NotificationToastCard__title">
          <span className="NotificationToastCard__pill">{pill}</span>
          <span>{notification.title}</span>
        </div>
        <div className="NotificationToastCard__message">
          {notification.message}
        </div>
      </div>

      <div className="NotificationToastCard__actions">
        {cta && (
          <button
            type="button"
            className="NotificationToastCard__cta"
            onClick={() => {
              notificationEngine.markAsRead(notification.id);
              onAction(notification);
            }}
          >
            {cta}
          </button>
        )}
        <button
          type="button"
          className="NotificationToastCard__close"
          aria-label="Dismiss notification"
          onClick={() => notificationEngine.dismissToast(notification.id)}
        >
          ×
        </button>
      </div>
    </div>
  );
};

export interface NotificationToastStackProps {
  onSelectNotification: (notification: AppNotification) => void;
}

export const NotificationToastStack: React.FC<NotificationToastStackProps> = ({
  onSelectNotification,
}) => {
  const queue = useAtomValue(notificationToastQueueAtom);

  if (queue.length === 0) {
    return null;
  }

  return (
    <div
      className="NotificationToastStack"
      data-testid="notification-toast-stack"
    >
      {queue.map((notification) => (
        <NotificationToastCard
          key={notification.id}
          notification={notification}
          onAction={onSelectNotification}
        />
      ))}
    </div>
  );
};
