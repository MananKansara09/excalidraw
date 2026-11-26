import { Dialog } from "@excalidraw/excalidraw/components/Dialog";
import { FilledButton } from "@excalidraw/excalidraw/components/FilledButton";
import { Select } from "@excalidraw/excalidraw/components/Select";
import { useEffect, useRef, useState } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { useAtom, useAtomValue, useSetAtom } from "../../app-jotai";
import { notificationEngine } from "../../notifications";
import { plusAPI, PlusAPIError } from "../api";
import { startPlusNotificationsSync } from "../notificationsSync";
import {
  activeCommentIdAtom,
  cloudSceneAtom,
  cloudStatusAtom,
  connectionIdAtom,
  participantsAtom,
  mentionsUnreadAtom,
  pendingCommentFocusAtom,
  plusDialogAtom,
  plusUserAtom,
} from "../state";
import { hangout, hangoutAtom } from "../hangout";
import { goToSignIn } from "../auth";

import { AccountDialog } from "./AccountDialog";
import { CloudShareDialog } from "./CloudShareDialog";
import { CommentPins } from "./Comments";
import { ExportFramesDialog } from "./ExportFramesDialog";
import { HangoutMedia } from "./HangoutControls";
import { PresentationMode } from "./Presentation";
import { ErrorText, Field, useAsyncAction } from "./ui";
import {
  openCloudScene,
  saveCanvasToCloud,
  WorkspaceDialog,
} from "./WorkspaceDialog";

import type { TeamSummary } from "../api";

/** Checks for a signed-in session once on startup. */
export const usePlusSession = () => {
  const setUser = useSetAtom(plusUserAtom);
  useEffect(() => {
    let cancelled = false;
    plusAPI
      .me()
      .then(({ user }) => !cancelled && setUser(user))
      .catch((error) => {
        if (!cancelled) {
          setUser(null);
          if (!(error instanceof PlusAPIError) || error.status !== 401) {
            console.info("Excalidraw Plus server unavailable:", error.message);
          }
        }
      });
    return () => {
      cancelled = true;
    };
  }, [setUser]);
};

const SaveToCloudDialog = ({ api }: { api: ExcalidrawImperativeAPI }) => {
  const setDialog = useSetAtom(plusDialogAtom);
  const [name, setName] = useState(api.getName() || "Untitled");
  const [teamId, setTeamId] = useState("");
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const { pending, error, run } = useAsyncAction();

  useEffect(() => {
    run(async () => setTeams((await plusAPI.listTeams()).teams));
  }, [run]);

  const save = async () => {
    const scene = await run(() =>
      saveCanvasToCloud(api, {
        name: name.trim() || "Untitled",
        teamId: teamId || null,
        folderId: null,
      }),
    );
    if (scene) {
      setDialog(null);
      openCloudScene(scene.id);
    }
  };

  return (
    <Dialog
      size="small"
      title="Save to workspace"
      onCloseRequest={() => setDialog(null)}
      className="plus-dialog"
    >
      <form
        className="plus-form"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <p className="plus-muted">
          Saves this canvas to the cloud, where you can share it, comment on it
          and present it. Your local canvas stays as it is.
        </p>
        <Field label="Name">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="Workspace">
          <Select
            className="plus-select"
            label="Workspace"
            value={teamId}
            options={[
              { value: "", label: "My scenes" },
              ...teams.map((team) => ({ value: team.id, label: team.name })),
            ]}
            onChange={setTeamId}
          />
        </Field>
        <ErrorText error={error} />
        <FilledButton
          size="large"
          fullWidth
          label="Save"
          status={pending ? "loading" : null}
          onClick={save}
        />
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
};

/** Mounts every Plus dialog and canvas overlay. */
export const PlusRoot = ({ api }: { api: ExcalidrawImperativeAPI }) => {
  const [dialog, setDialog] = useAtom(plusDialogAtom);
  const user = useAtomValue(plusUserAtom);
  const scene = useAtomValue(cloudSceneAtom);

  const cloudStatus = useAtomValue(cloudStatusAtom);

  // warn before closing the tab with edits not yet on the server
  useEffect(() => {
    if (cloudStatus.state !== "saving" && cloudStatus.state !== "offline") {
      return;
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [cloudStatus.state]);

  // real-time server notifications + workspace user directory sync
  useEffect(() => {
    if (!user) {
      return;
    }
    return startPlusNotificationsSync(user);
  }, [user]);

  // seed knownUsers from active cloud scene participants/members for canvas @mentions
  useEffect(() => {
    if (!scene?.id || !user) {
      return;
    }
    let cancelled = false;
    plusAPI
      .listPeople(scene.id)
      .then(({ people }) => {
        if (!cancelled) {
          notificationEngine.registerKnownUsers(
            people.map((person) => ({
              id: person.userId,
              username: person.name,
              email: person.email,
              avatarUrl: person.avatarUrl,
              source: "plus",
            })),
          );
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [scene?.id, user]);

  // unread @-mentions for the Workspace badge
  const setUnreadMentions = useSetAtom(mentionsUnreadAtom);
  useEffect(() => {
    if (!user) {
      setUnreadMentions(0);
      return;
    }
    let cancelled = false;
    const refresh = () =>
      plusAPI
        .myMentions()
        .then((inbox) => !cancelled && setUnreadMentions(inbox.unread))
        .catch(() => {});
    refresh();
    const interval = setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, [user, setUnreadMentions]);

  // a mention opened from the inbox: show its thread once the scene is open
  const [pendingFocus, setPendingFocus] = useAtom(pendingCommentFocusAtom);
  const setActiveComment = useSetAtom(activeCommentIdAtom);
  useEffect(() => {
    if (pendingFocus && scene?.id === pendingFocus.sceneId) {
      setActiveComment(pendingFocus.commentId);
      api.toggleSidebar({ name: "default", tab: "comments", force: true });
      setPendingFocus(null);
    }
  }, [pendingFocus, scene?.id, api, setActiveComment, setPendingFocus]);

  // tell people outside the call when someone starts sharing their screen
  const participants = useAtomValue(participantsAtom);
  const connectionId = useAtomValue(connectionIdAtom);
  const hangoutState = useAtomValue(hangoutAtom);
  const announcedSharers = useRef(new Set<string>());
  useEffect(() => {
    const sharing = participants.filter(
      (p) => p.sharingScreen && p.connectionId !== connectionId,
    );
    const current = new Set(sharing.map((p) => p.connectionId));
    for (const id of announcedSharers.current) {
      if (!current.has(id)) {
        announcedSharers.current.delete(id);
      }
    }
    for (const sharer of sharing) {
      if (announcedSharers.current.has(sharer.connectionId)) {
        continue;
      }
      announcedSharers.current.add(sharer.connectionId);
      if (!hangoutState.joined) {
        api.setToast({
          message: `${sharer.name} is sharing their screen`,
          duration: 10000,
          closable: true,
          action: {
            label: "Watch",
            onClick: () => hangout.join({ mic: false }),
          },
        });
      }
    }
  }, [participants, connectionId, hangoutState.joined, api]);

  // joined some other way (e.g. the top bar): the "Watch" prompt is done
  useEffect(() => {
    const toast = api.getAppState().toast;
    if (
      hangoutState.joined &&
      typeof toast?.message === "string" &&
      toast.message.endsWith("is sharing their screen")
    ) {
      api.setToast(null);
    }
  }, [hangoutState.joined, api]);

  // leaving a scene ends its hangout
  useEffect(() => {
    if (!scene) {
      hangout.leave();
    }
  }, [scene]);

  // Escape normally reaches a dialog through its focused content; when a
  // clicked button replaced itself, focus falls back to <body>
  useEffect(() => {
    if (!dialog) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        (!document.activeElement || document.activeElement === document.body)
      ) {
        setDialog(null);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [dialog, setDialog]);

  // dialogs that need an account ask to sign in first
  useEffect(() => {
    if (
      user === null &&
      dialog &&
      ["workspace", "account", "save-to-cloud"].includes(dialog.name)
    ) {
      setDialog(null);
      goToSignIn("signin", "workspace");
    }
  }, [user, dialog, setDialog]);

  return (
    <>
      {dialog?.name === "workspace" && user && (
        <WorkspaceDialog excalidrawAPI={api} />
      )}
      {dialog?.name === "account" && user && <AccountDialog />}
      {dialog?.name === "share" && scene && <CloudShareDialog />}
      {dialog?.name === "export-frames" && <ExportFramesDialog api={api} />}
      {dialog?.name === "save-to-cloud" && user && (
        <SaveToCloudDialog api={api} />
      )}
      {scene && <CommentPins api={api} />}
      <PresentationMode api={api} />
      <HangoutMedia />
    </>
  );
};
