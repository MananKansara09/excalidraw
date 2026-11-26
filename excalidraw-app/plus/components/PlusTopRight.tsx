import { getClientColor } from "@excalidraw/excalidraw/clients";
import clsx from "clsx";

import type { SocketId } from "@excalidraw/excalidraw/types";

import { useAtomValue, useSetAtom } from "../../app-jotai";
import {
  cloudSceneAtom,
  cloudStatusAtom,
  mentionsUnreadAtom,
  participantsAtom,
  plusDialogAtom,
  plusUserAtom,
} from "../state";

import { goToSignIn } from "../auth";

import { HangoutButtons } from "./HangoutControls";
import { initials } from "./ui";

const StatusPill = () => {
  const status = useAtomValue(cloudStatusAtom);
  const scene = useAtomValue(cloudSceneAtom);
  if (!scene) {
    return null;
  }
  const label =
    scene.role === "viewer"
      ? "View only"
      : status.state === "saving"
      ? "Saving…"
      : status.state === "offline"
      ? "Offline"
      : status.state === "error"
      ? "Not saved"
      : "Saved";
  return (
    <span
      className={clsx("plus-status", status.state)}
      title={
        status.state === "error"
          ? status.message
          : `${scene.name} — cloud scene`
      }
      role="status"
    >
      <span className="plus-status__dot" aria-hidden="true" />
      {label}
    </span>
  );
};

const Participants = () => {
  const participants = useAtomValue(participantsAtom);
  const user = useAtomValue(plusUserAtom);
  // one avatar per person, even with several tabs open
  const people = new Map<string, typeof participants[number]>();
  for (const participant of participants) {
    const key = participant.userId ?? participant.connectionId;
    const known = people.get(key);
    if (!known || participant.inHangout) {
      people.set(key, participant);
    }
  }
  const others = [...people.values()].filter(
    (participant) => !user || participant.userId !== user.id,
  );
  if (!others.length) {
    return null;
  }
  return (
    <span
      className="plus-participants"
      aria-label={`${others.length} others here`}
    >
      {others.slice(0, 4).map((participant) => (
        <span
          key={participant.connectionId}
          className={clsx("plus-avatar small", {
            speaking: participant.inHangout,
          })}
          // the same colour the editor gives this person's cursor
          style={{
            background: getClientColor(participant.connectionId as SocketId, {
              id: participant.userId ?? participant.connectionId,
            }),
            color: "#1e1e1e",
          }}
          title={`${participant.name}${
            participant.inHangout ? " (in voice)" : ""
          }${participant.sharingScreen ? " (sharing screen)" : ""}`}
        >
          {initials(participant.name)}
        </span>
      ))}
      {others.length > 4 && (
        <span className="plus-avatar small more">+{others.length - 4}</span>
      )}
    </span>
  );
};

export const PlusTopRight = () => {
  const user = useAtomValue(plusUserAtom);
  const scene = useAtomValue(cloudSceneAtom);
  const setDialog = useSetAtom(plusDialogAtom);
  const unreadMentions = useAtomValue(mentionsUnreadAtom);

  if (scene?.embed) {
    return null;
  }

  return (
    <div className="plus-top-right">
      {scene && (
        <>
          <StatusPill />
          <Participants />
          <HangoutButtons />
          <button
            className="plus-pill-button primary"
            onClick={() => setDialog({ name: "share" })}
          >
            Share
          </button>
        </>
      )}
      {user === undefined ? null : user ? (
        <>
          <button
            className="plus-pill-button"
            onClick={() => setDialog({ name: "workspace" })}
            title={
              unreadMentions
                ? `${unreadMentions} unread mention${
                    unreadMentions > 1 ? "s" : ""
                  }`
                : "Your scenes, folders and teams"
            }
          >
            Workspace
            {unreadMentions > 0 && (
              <span className="plus-count">{unreadMentions}</span>
            )}
          </button>
          <button
            className="plus-avatar plus-avatar-button"
            onClick={() => setDialog({ name: "account" })}
            title={`${user.name} — account settings`}
            aria-label="Account settings"
          >
            {initials(user.name)}
          </button>
        </>
      ) : (
        <button className="plus-pill-button" onClick={() => goToSignIn()}>
          Sign in
        </button>
      )}
    </div>
  );
};
