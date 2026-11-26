import clsx from "clsx";
import React, { useEffect, useRef } from "react";

import { useAtom, useAtomValue } from "../../app-jotai";
import {
  notificationCenterOpenAtom,
  unreadNotificationCountAtom,
} from "../store";

import { NotificationCenter } from "./NotificationCenter";

import "./NotificationBell.scss";

import type { AppNotification } from "../types";

const BellIcon = () => (
  <svg
    aria-hidden="true"
    focusable="false"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2 -3v-3a7 7 0 0 1 4 -6" />
    <path d="M9 17v1a3 3 0 0 0 6 0v-1" />
  </svg>
);

export interface NotificationBellProps {
  onSelectNotification: (notification: AppNotification) => void;
}

export const NotificationBell: React.FC<NotificationBellProps> = ({
  onSelectNotification,
}) => {
  const [isOpen, setIsOpen] = useAtom(notificationCenterOpenAtom);
  const unreadCount = useAtomValue(unreadNotificationCountAtom);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const ownerDoc = wrapperRef.current?.ownerDocument ?? document;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        wrapperRef.current &&
        target &&
        !wrapperRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    ownerDoc.addEventListener("pointerdown", handlePointerDown);
    ownerDoc.addEventListener("keydown", handleKeyDown);
    return () => {
      ownerDoc.removeEventListener("pointerdown", handlePointerDown);
      ownerDoc.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, setIsOpen]);

  return (
    <div className="NotificationBell" ref={wrapperRef}>
      <button
        type="button"
        className={clsx("excalidraw-button NotificationBell__trigger", {
          "is-open": isOpen,
          "has-unread": unreadCount > 0,
        })}
        aria-label={
          unreadCount > 0
            ? `Notifications (${unreadCount} unread)`
            : "Notifications"
        }
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        title="Notifications"
        data-testid="notification-bell-button"
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <BellIcon />
        {unreadCount > 0 && (
          <span
            className="NotificationBell__badge"
            data-testid="notification-unread-badge"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          className="NotificationBell__popover"
          role="dialog"
          aria-label="Notifications"
        >
          <NotificationCenter
            onClose={() => setIsOpen(false)}
            onSelectNotification={(notification) => {
              setIsOpen(false);
              onSelectNotification(notification);
            }}
          />
        </div>
      )}
    </div>
  );
};
