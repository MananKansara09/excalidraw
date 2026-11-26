import { Popover } from "radix-ui";
import clsx from "clsx";
import React, { useRef, useState } from "react";

import {
  getClientColor,
  getCollaboratorActivityLabel,
  getCollaboratorStatusInfo,
} from "../clients";
import { t } from "../i18n";

import { Avatar } from "./Avatar";
import { Island } from "./Island";
import { hideDocumentTooltip } from "./Tooltip";
import { eyeIcon, microphoneIcon, microphoneMutedIcon } from "./icons";

import type { Collaborator, SocketId } from "../types";

type CollaboratorProfilePopoverProps = {
  collaborator: Collaborator;
  socketId: SocketId;
  isBeingFollowed: boolean;
  onToggleFollow: () => void;
  children: React.ReactNode;
};

export const CollaboratorProfilePopover = ({
  collaborator,
  socketId,
  isBeingFollowed,
  onToggleFollow,
  children,
}: CollaboratorProfilePopoverProps) => {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement | null>(null);

  const background = getClientColor(socketId, collaborator);
  const statusInfo = getCollaboratorStatusInfo(collaborator);
  const activityLabel = getCollaboratorActivityLabel(collaborator);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen && triggerRef.current) {
      hideDocumentTooltip(triggerRef.current.ownerDocument);
    }
  };

  const handleFollowClick = () => {
    onToggleFollow();
    setOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
        <div
          ref={triggerRef}
          className="UserList__profile-trigger"
          data-testid={`collaborator-avatar-${socketId}`}
        >
          {children}
        </div>
      </Popover.Trigger>
      <Popover.Content
        className="focus-visible-none UserList__profile-popover"
        style={{
          zIndex: 4,
          width: "16.5rem",
          textAlign: "left",
        }}
        align="end"
        sideOffset={10}
      >
        <Island padding={3}>
          <div
            className="UserList__profile-card"
            data-testid={`collaborator-profile-${socketId}`}
          >
            <div className="UserList__profile-header">
              <div
                className="UserList__profile-avatar"
                style={{ [`--avatar-size` as any]: "2.5rem" }}
              >
                <Avatar
                  color={background}
                  onClick={() => {}}
                  name={collaborator.username || ""}
                  src={collaborator.avatarUrl}
                />
                <span
                  className={clsx(
                    "UserList__profile-presence-dot",
                    `is-${statusInfo.state}`,
                  )}
                  title={statusInfo.label}
                />
              </div>
              <div className="UserList__profile-meta">
                <div
                  className="UserList__profile-name"
                  title={collaborator.username || ""}
                >
                  {collaborator.username || "Unknown user"}
                </div>
                <div className="UserList__profile-status">
                  <span>{statusInfo.label}</span>
                  {collaborator.isInCall && (
                    <span className="UserList__profile-call-badge">
                      {collaborator.isMuted
                        ? microphoneMutedIcon
                        : microphoneIcon}
                      <span>
                        {collaborator.isSpeaking
                          ? t("userList.hint.isSpeaking")
                          : collaborator.isMuted
                          ? t("userList.hint.micMuted")
                          : t("userList.hint.inCall")}
                      </span>
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="UserList__profile-activity">
              <span className="UserList__profile-activity-label">
                {t("userList.profile.currentActivity")}
              </span>
              <span className="UserList__profile-activity-value">
                {activityLabel}
              </span>
            </div>

            <button
              type="button"
              className={clsx("UserList__profile-follow-btn", {
                "is-following": isBeingFollowed,
              })}
              onClick={handleFollowClick}
              data-testid="collaborator-follow-button"
            >
              <span className="UserList__profile-follow-icon">{eyeIcon}</span>
              <span>
                {isBeingFollowed
                  ? t("userList.profile.stopFollowing")
                  : t("userList.profile.follow")}
              </span>
            </button>
            {!isBeingFollowed && (
              <div className="UserList__profile-hint">
                {t("userList.profile.followHint")}
              </div>
            )}
          </div>
          <Popover.Arrow
            width={20}
            height={10}
            style={{
              fill: "var(--popup-bg-color)",
              filter: "drop-shadow(rgba(0, 0, 0, 0.05) 0px 3px 2px)",
            }}
          />
        </Island>
      </Popover.Content>
    </Popover.Root>
  );
};
