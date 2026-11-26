import { trackEvent } from "@excalidraw/excalidraw/analytics";
import { copyTextToSystemClipboard } from "@excalidraw/excalidraw/clipboard";
import { Dialog } from "@excalidraw/excalidraw/components/Dialog";
import { FilledButton } from "@excalidraw/excalidraw/components/FilledButton";
import { Select } from "@excalidraw/excalidraw/components/Select";
import { TextField } from "@excalidraw/excalidraw/components/TextField";
import {
  copyIcon,
  LinkIcon,
  playerPlayIcon,
  playerStopFilledIcon,
  share,
  shareIOS,
  shareWindows,
} from "@excalidraw/excalidraw/components/icons";
import { useUIAppState } from "@excalidraw/excalidraw/context/ui-appState";
import { useCopyStatus } from "@excalidraw/excalidraw/hooks/useCopiedIndicator";
import { useI18n } from "@excalidraw/excalidraw/i18n";
import { KEYS, getFrame } from "@excalidraw/common";
import { useEffect, useRef, useState } from "react";

import { atom, useAtom, useAtomValue } from "../app-jotai";
import { activeRoomLinkAtom } from "../collab/Collab";
import { getCollaborationLinkData } from "../data";
import {
  currentUserAtom,
  knownUsersAtom,
  notificationEngine,
  normalizeHandle,
  sharedUsersByRoomAtom,
  type ShareRole,
} from "../notifications";

import "./ShareDialog.scss";
import { QRCode } from "./QRCode";

import type { CollabAPI } from "../collab/Collab";

type OnExportToBackend = () => void;
type ShareDialogType = "share" | "collaborationOnly";

export const shareDialogStateAtom = atom<
  { isOpen: false } | { isOpen: true; type: ShareDialogType }
>({ isOpen: false });

const getShareIcon = () => {
  const navigator = window.navigator as any;
  const isAppleBrowser = /Apple/.test(navigator.vendor);
  const isWindowsBrowser = navigator.appVersion.indexOf("Win") !== -1;

  if (isAppleBrowser) {
    return shareIOS;
  } else if (isWindowsBrowser) {
    return shareWindows;
  }

  return share;
};

export type ShareDialogProps = {
  collabAPI: CollabAPI | null;
  handleClose: () => void;
  onExportToBackend: OnExportToBackend;
  type: ShareDialogType;
};

const SharePeopleSection = ({
  collabAPI,
  activeRoomLink,
}: {
  collabAPI: CollabAPI;
  activeRoomLink: string | null;
}) => {
  const [inviteInput, setInviteInput] = useState("");
  const [role, setRole] = useState<ShareRole>("editor");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isInviting, setIsInviting] = useState(false);
  const sectionRef = useRef<HTMLDivElement | null>(null);

  const currentUser = useAtomValue(currentUserAtom);
  const knownUsers = useAtomValue(knownUsersAtom);
  const sharedUsersByRoom = useAtomValue(sharedUsersByRoomAtom);

  const roomData = activeRoomLink
    ? getCollaborationLinkData(activeRoomLink)
    : null;
  const currentRoomId = collabAPI.getRoomId() || roomData?.roomId || "local";
  const sharedUsers = sharedUsersByRoom[currentRoomId] ?? [];

  const suggestedUsers = knownUsers
    .filter(
      (u) =>
        u.handle !== currentUser.handle &&
        !sharedUsers.some((s) => s.handle === u.handle) &&
        (!inviteInput.trim() ||
          u.username.toLowerCase().includes(inviteInput.trim().toLowerCase()) ||
          u.handle.includes(normalizeHandle(inviteInput))),
    )
    .slice(0, 5);

  const handleInvite = async (targetName?: string) => {
    const rawTarget = (targetName ?? inviteInput).trim();
    if (!rawTarget || isInviting) {
      return;
    }

    setIsInviting(true);
    setStatusMessage(null);
    try {
      let roomLink = activeRoomLink || collabAPI.getActiveRoomLink();
      if (!roomLink) {
        await collabAPI.startCollaboration(null);
        const ownerWin =
          sectionRef.current?.ownerDocument.defaultView ?? window;
        roomLink = collabAPI.getActiveRoomLink() || ownerWin.location.href;
      }

      const parsed = getCollaborationLinkData(roomLink);
      const roomId = parsed?.roomId || collabAPI.getRoomId() || "local";

      const { entry } = await notificationEngine.addSharedUser({
        roomId,
        roomKey: parsed?.roomKey,
        roomLink,
        targetUsername: rawTarget,
        role,
      });

      setInviteInput("");
      setStatusMessage(`Real-time invite sent to @${entry.handle}`);
    } finally {
      setIsInviting(false);
    }
  };

  return (
    <div className="ShareDialog__people" ref={sectionRef}>
      <div className="ShareDialog__people__header">
        <span>Share with people</span>
        <span className="ShareDialog__people__badge">Real-time notify</span>
      </div>

      <div className="ShareDialog__people__form">
        <TextField
          value={inviteInput}
          placeholder="Enter username or @handle"
          fullWidth
          onChange={(val) => {
            setInviteInput(val);
            if (statusMessage) {
              setStatusMessage(null);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === KEYS.ENTER) {
              event.preventDefault();
              void handleInvite();
            }
          }}
        />
        <Select
          className="ShareDialog__people__role"
          label="Share role"
          value={role}
          options={[
            { value: "editor", label: "Editor" },
            { value: "viewer", label: "Viewer" },
          ]}
          onChange={setRole}
          align="end"
        />
        <FilledButton
          size="medium"
          label={isInviting ? "Sending..." : "Add"}
          disabled={!inviteInput.trim() || isInviting}
          onClick={() => void handleInvite()}
        />
      </div>

      {suggestedUsers.length > 0 && (
        <div className="ShareDialog__people__suggestions">
          <span className="ShareDialog__people__suggestionsLabel">
            Quick add:
          </span>
          {suggestedUsers.map((user) => (
            <button
              key={user.handle}
              type="button"
              className="ShareDialog__people__chip"
              onClick={() => void handleInvite(user.username)}
            >
              +{user.username}
            </button>
          ))}
        </div>
      )}

      {statusMessage && (
        <div
          className="ShareDialog__people__status"
          role="status"
          data-testid="share-invite-status"
        >
          {statusMessage}
        </div>
      )}

      {sharedUsers.length > 0 && (
        <div className="ShareDialog__people__list">
          {sharedUsers.map((entry) => (
            <div key={entry.handle} className="ShareDialog__people__row">
              <div className="ShareDialog__people__user">
                <strong>{entry.username}</strong>
                <span>@{entry.handle}</span>
              </div>
              <div className="ShareDialog__people__rowActions">
                <span className="ShareDialog__people__roleBadge">
                  {entry.role}
                </span>
                <button
                  type="button"
                  className="ShareDialog__people__removeBtn"
                  onClick={() =>
                    notificationEngine.removeSharedUser(
                      currentRoomId,
                      entry.handle,
                    )
                  }
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const ActiveRoomDialog = ({
  collabAPI,
  activeRoomLink,
  handleClose,
}: {
  collabAPI: CollabAPI;
  activeRoomLink: string;
  handleClose: () => void;
}) => {
  const { t } = useI18n();
  const [, setJustCopied] = useState(false);
  const timerRef = useRef<number>(0);
  const ref = useRef<HTMLInputElement>(null);
  const isShareSupported = "share" in navigator;
  const { onCopy, copyStatus } = useCopyStatus();

  const copyRoomLink = async () => {
    try {
      await copyTextToSystemClipboard(activeRoomLink);
    } catch (e) {
      collabAPI.setCollabError(t("errors.copyToSystemClipboardFailed"));
    }

    setJustCopied(true);

    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
    }

    timerRef.current = window.setTimeout(() => {
      setJustCopied(false);
    }, 3000);

    ref.current?.select();
  };

  const shareRoomLink = async () => {
    try {
      await navigator.share({
        title: t("roomDialog.shareTitle"),
        text: t("roomDialog.shareTitle"),
        url: activeRoomLink,
      });
    } catch (error: any) {
      // Just ignore.
    }
  };

  return (
    <>
      <h3 className="ShareDialog__active__header">
        {t("labels.liveCollaboration").replace(/\./g, "")}
      </h3>
      <TextField
        defaultValue={collabAPI.getUsername()}
        placeholder="Your name"
        label="Your name"
        onChange={collabAPI.setUsername}
        onKeyDown={(event) => event.key === KEYS.ENTER && handleClose()}
      />
      <div className="ShareDialog__active__linkRow">
        <TextField
          ref={ref}
          label="Link"
          readonly
          fullWidth
          value={activeRoomLink}
        />
        {isShareSupported && (
          <FilledButton
            size="large"
            variant="icon"
            label="Share"
            icon={getShareIcon()}
            className="ShareDialog__active__share"
            onClick={shareRoomLink}
          />
        )}
        <FilledButton
          size="large"
          label={t("buttons.copyLink")}
          icon={copyIcon}
          status={copyStatus}
          onClick={() => {
            copyRoomLink();
            onCopy();
          }}
        />
      </div>
      <QRCode value={activeRoomLink} />
      <SharePeopleSection
        collabAPI={collabAPI}
        activeRoomLink={activeRoomLink}
      />
      <div className="ShareDialog__active__description">
        <p>
          <span
            role="img"
            aria-hidden="true"
            className="ShareDialog__active__description__emoji"
          >
            🔒{" "}
          </span>
          {t("roomDialog.desc_privacy")}
        </p>
        <p>{t("roomDialog.desc_exitSession")}</p>
      </div>

      <div className="ShareDialog__active__actions">
        <FilledButton
          size="large"
          variant="outlined"
          color="danger"
          label={t("roomDialog.button_stopSession")}
          icon={playerStopFilledIcon}
          onClick={() => {
            trackEvent("share", "room closed");
            collabAPI.stopCollaboration();
            if (!collabAPI.isCollaborating()) {
              handleClose();
            }
          }}
        />
      </div>
    </>
  );
};

const ShareDialogPicker = (props: ShareDialogProps) => {
  const { t } = useI18n();

  const { collabAPI } = props;

  const startCollabJSX = collabAPI ? (
    <>
      <div className="ShareDialog__picker__header">
        {t("labels.liveCollaboration").replace(/\./g, "")}
      </div>

      <div className="ShareDialog__picker__description">
        <div style={{ marginBottom: "1em" }}>{t("roomDialog.desc_intro")}</div>
        {t("roomDialog.desc_privacy")}
      </div>

      <div className="ShareDialog__picker__button">
        <FilledButton
          size="large"
          label={t("roomDialog.button_startSession")}
          icon={playerPlayIcon}
          onClick={() => {
            trackEvent("share", "room creation", `ui (${getFrame()})`);
            collabAPI.startCollaboration(null);
          }}
        />
      </div>

      <SharePeopleSection collabAPI={collabAPI} activeRoomLink={null} />

      {props.type === "share" && (
        <div className="ShareDialog__separator">
          <span>{t("shareDialog.or")}</span>
        </div>
      )}
    </>
  ) : null;

  return (
    <>
      {startCollabJSX}

      {props.type === "share" && (
        <>
          <div className="ShareDialog__picker__header">
            {t("exportDialog.link_title")}
          </div>
          <div className="ShareDialog__picker__description">
            {t("exportDialog.link_details")}
          </div>

          <div className="ShareDialog__picker__button">
            <FilledButton
              size="large"
              label={t("exportDialog.link_button")}
              icon={LinkIcon}
              onClick={async () => {
                await props.onExportToBackend();
                props.handleClose();
              }}
            />
          </div>
        </>
      )}
    </>
  );
};

const ShareDialogInner = (props: ShareDialogProps) => {
  const activeRoomLink = useAtomValue(activeRoomLinkAtom);

  return (
    <Dialog size="small" onCloseRequest={props.handleClose} title={false}>
      <div className="ShareDialog">
        {props.collabAPI && activeRoomLink ? (
          <ActiveRoomDialog
            collabAPI={props.collabAPI}
            activeRoomLink={activeRoomLink}
            handleClose={props.handleClose}
          />
        ) : (
          <ShareDialogPicker {...props} />
        )}
      </div>
    </Dialog>
  );
};

export const ShareDialog = (props: {
  collabAPI: CollabAPI | null;
  onExportToBackend: OnExportToBackend;
}) => {
  const [shareDialogState, setShareDialogState] = useAtom(shareDialogStateAtom);

  const { openDialog } = useUIAppState();

  useEffect(() => {
    if (openDialog) {
      setShareDialogState({ isOpen: false });
    }
  }, [openDialog, setShareDialogState]);

  if (!shareDialogState.isOpen) {
    return null;
  }

  return (
    <ShareDialogInner
      handleClose={() => setShareDialogState({ isOpen: false })}
      collabAPI={props.collabAPI}
      onExportToBackend={props.onExportToBackend}
      type={shareDialogState.type}
    />
  );
};
