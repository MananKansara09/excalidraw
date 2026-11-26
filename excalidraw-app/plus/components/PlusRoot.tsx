import { Dialog } from "@excalidraw/excalidraw/components/Dialog";
import { FilledButton } from "@excalidraw/excalidraw/components/FilledButton";
import { useEffect, useState } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { useAtom, useAtomValue, useSetAtom } from "../../app-jotai";
import { plusAPI, PlusAPIError } from "../api";
import {
  cloudSceneAtom,
  cloudStatusAtom,
  plusDialogAtom,
  plusUserAtom,
} from "../state";
import { hangout } from "../hangout";
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
          <select
            className="plus-select"
            value={teamId}
            onChange={(event) => setTeamId(event.target.value)}
          >
            <option value="">My scenes</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
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
