import { Dialog } from "@excalidraw/excalidraw/components/Dialog";
import { FilledButton } from "@excalidraw/excalidraw/components/FilledButton";
import { getNonDeletedElements } from "@excalidraw/excalidraw";
import clsx from "clsx";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { useAtom, useAtomValue, useSetAtom } from "../../app-jotai";
import { pendingTeamOpenAtom } from "../../notifications";
import { plusAPI } from "../api";
import { cloudSceneHash } from "../cloud";
import {
  cloudSceneAtom,
  mentionsUnreadAtom,
  plusDialogAtom,
  plusUserAtom,
} from "../state";

import { MentionsPanel } from "./MentionsPanel";
import { TeamPanel } from "./TeamPanel";
import { ErrorText, SmallButton, timeAgo, useAsyncAction } from "./ui";

import type { Folder, PlusFile, SceneSummary, TeamSummary } from "../api";

type View =
  | { kind: "personal" }
  | { kind: "shared" }
  | { kind: "mentions" }
  | { kind: "team"; teamId: string; tab: "scenes" | "members" };

const viewTeamId = (view: View) => (view.kind === "team" ? view.teamId : null);

/** Opens a cloud scene in the editor. */
export const openCloudScene = (sceneId: string) => {
  window.location.hash = cloudSceneHash(sceneId);
};

/** Uploads the current canvas as a new cloud scene. */
export const saveCanvasToCloud = async (
  api: ExcalidrawImperativeAPI,
  location: { name: string; teamId: string | null; folderId: string | null },
) => {
  const elements = api.getSceneElementsIncludingDeleted();
  const allFiles = api.getFiles();
  const files: Record<string, PlusFile> = {};
  for (const element of getNonDeletedElements(elements)) {
    if (
      element.type === "image" &&
      element.fileId &&
      allFiles[element.fileId]
    ) {
      const file = allFiles[element.fileId];
      files[file.id] = {
        id: file.id,
        mimeType: file.mimeType,
        dataURL: file.dataURL,
        created: file.created,
      };
    }
  }
  const { scene } = await plusAPI.createScene({
    ...location,
    elements: getNonDeletedElements(elements),
    appState: { viewBackgroundColor: api.getAppState().viewBackgroundColor },
    files,
  });
  return scene;
};

export const WorkspaceDialog = ({
  excalidrawAPI,
}: {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
}) => {
  const setDialog = useSetAtom(plusDialogAtom);
  const [user] = useAtom(plusUserAtom);
  const cloudScene = useAtomValue(cloudSceneAtom);
  const unreadMentions = useAtomValue(mentionsUnreadAtom);
  const [pendingTeamId, setPendingTeamId] = useAtom(pendingTeamOpenAtom);

  const [view, setView] = useState<View>(
    pendingTeamId
      ? { kind: "team", teamId: pendingTeamId, tab: "members" }
      : cloudScene?.teamId
      ? { kind: "team", teamId: cloudScene.teamId, tab: "scenes" }
      : { kind: "personal" },
  );

  useEffect(() => {
    if (pendingTeamId) {
      setView({ kind: "team", teamId: pendingTeamId, tab: "members" });
      setPendingTeamId(null);
    }
  }, [pendingTeamId, setPendingTeamId]);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [scenes, setScenes] = useState<SceneSummary[]>([]);
  const [query, setQuery] = useState("");
  const [newTeamName, setNewTeamName] = useState<string | null>(null);
  const [movingScene, setMovingScene] = useState<SceneSummary | null>(null);
  const { pending, error, run } = useAsyncAction();

  const loadTeams = useCallback(
    () => run(async () => setTeams((await plusAPI.listTeams()).teams)),
    [run],
  );

  const load = useCallback(() => {
    const teamId = viewTeamId(view);
    return run(async () => {
      if (view.kind === "mentions") {
        return;
      }
      if (view.kind === "shared") {
        setFolders([]);
        setScenes(
          (await plusAPI.listScenes({ scope: "shared", q: query })).scenes,
        );
        return;
      }
      const [folderResult, sceneResult] = await Promise.all([
        plusAPI.listFolders(teamId),
        plusAPI.listScenes({
          scope: teamId ? "team" : "personal",
          teamId,
          // searching looks through every folder
          folderId: query ? undefined : folderId,
          q: query,
        }),
      ]);
      setFolders(folderResult.folders);
      setScenes(sceneResult.scenes);
    });
  }, [view, folderId, query, run]);

  useEffect(() => {
    loadTeams();
  }, [loadTeams]);

  useEffect(() => {
    const timeout = setTimeout(load, query ? 250 : 0);
    return () => clearTimeout(timeout);
  }, [load, query]);

  const breadcrumb = useMemo(() => {
    const path: Folder[] = [];
    let cursor = folders.find((folder) => folder.id === folderId);
    while (cursor) {
      path.unshift(cursor);
      const parentId: string | null = cursor.parentId;
      cursor = folders.find((folder) => folder.id === parentId);
    }
    return path;
  }, [folders, folderId]);

  const childFolders = folders.filter((folder) => folder.parentId === folderId);
  const team = teams.find((t) => t.id === viewTeamId(view));
  const workspaceName =
    view.kind === "personal"
      ? "My scenes"
      : view.kind === "shared"
      ? "Shared with me"
      : view.kind === "mentions"
      ? "Mentions"
      : team?.name ?? "Team";

  const switchView = (next: View) => {
    setView(next);
    setFolderId(null);
    setQuery("");
  };

  if (!user) {
    return null;
  }

  const canCreateHere = view.kind !== "shared" && view.kind !== "mentions";

  return (
    <Dialog
      size="wide"
      onCloseRequest={() => setDialog(null)}
      title="Workspace"
      className="plus-dialog plus-workspace"
    >
      <div className="plus-workspace__layout">
        <nav className="plus-workspace__nav" aria-label="Workspaces">
          <button
            className={clsx({ active: view.kind === "personal" })}
            onClick={() => switchView({ kind: "personal" })}
          >
            My scenes
          </button>
          <button
            className={clsx({ active: view.kind === "shared" })}
            onClick={() => switchView({ kind: "shared" })}
          >
            Shared with me
          </button>
          <button
            className={clsx({ active: view.kind === "mentions" })}
            onClick={() => switchView({ kind: "mentions" })}
          >
            Mentions
            {unreadMentions > 0 && (
              <span className="plus-count">{unreadMentions}</span>
            )}
          </button>
          <div className="plus-workspace__nav-heading">Teams</div>
          {teams.map((t) => (
            <button
              key={t.id}
              className={clsx({ active: viewTeamId(view) === t.id })}
              onClick={() =>
                switchView({ kind: "team", teamId: t.id, tab: "scenes" })
              }
            >
              {t.name}
              <span className="plus-muted"> · {t.memberCount}</span>
            </button>
          ))}
          {newTeamName === null ? (
            <button
              className="plus-workspace__nav-add"
              onClick={() => setNewTeamName("")}
            >
              + New team
            </button>
          ) : (
            <form
              className="plus-workspace__nav-form"
              onSubmit={async (event) => {
                event.preventDefault();
                if (!newTeamName.trim()) {
                  return;
                }
                const result = await run(() =>
                  plusAPI.createTeam(newTeamName.trim()),
                );
                if (result) {
                  setNewTeamName(null);
                  await loadTeams();
                  switchView({
                    kind: "team",
                    teamId: result.team.id,
                    tab: "members",
                  });
                }
              }}
            >
              <input
                autoFocus
                placeholder="Team name"
                aria-label="New team name"
                value={newTeamName}
                onChange={(event) => setNewTeamName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.stopPropagation();
                    setNewTeamName(null);
                  }
                }}
              />
            </form>
          )}
        </nav>

        <div className="plus-workspace__main">
          <header className="plus-workspace__header">
            <div className="plus-breadcrumb">
              <button onClick={() => setFolderId(null)}>{workspaceName}</button>
              {breadcrumb.map((folder) => (
                <span key={folder.id}>
                  {" / "}
                  <button onClick={() => setFolderId(folder.id)}>
                    {folder.name}
                  </button>
                </span>
              ))}
            </div>
            {view.kind === "team" && (
              <div className="plus-tabs" role="tablist">
                <button
                  role="tab"
                  aria-selected={view.tab === "scenes"}
                  onClick={() => setView({ ...view, tab: "scenes" })}
                >
                  Scenes
                </button>
                <button
                  role="tab"
                  aria-selected={view.tab === "members"}
                  onClick={() => setView({ ...view, tab: "members" })}
                >
                  Members
                </button>
              </div>
            )}
          </header>

          {view.kind === "mentions" ? (
            <MentionsPanel user={user} />
          ) : view.kind === "team" && view.tab === "members" ? (
            <TeamPanel
              teamId={view.teamId}
              user={user}
              onTeamsChanged={loadTeams}
              onLeft={() => switchView({ kind: "personal" })}
            />
          ) : (
            <>
              <div className="plus-toolbar">
                <input
                  type="search"
                  className="plus-search"
                  placeholder="Search scenes"
                  aria-label="Search scenes"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                {canCreateHere && (
                  <>
                    <SmallButton
                      onClick={async () => {
                        const name = window.prompt("Folder name");
                        if (name?.trim()) {
                          await run(() =>
                            plusAPI.createFolder({
                              name: name.trim(),
                              parentId: folderId,
                              teamId: viewTeamId(view),
                            }),
                          );
                          load();
                        }
                      }}
                    >
                      New folder
                    </SmallButton>
                    {excalidrawAPI && (
                      <SmallButton
                        onClick={async () => {
                          const name =
                            window.prompt(
                              "Name for the scene",
                              excalidrawAPI.getName() || "Untitled",
                            ) ?? null;
                          if (!name?.trim()) {
                            return;
                          }
                          const scene = await run(() =>
                            saveCanvasToCloud(excalidrawAPI, {
                              name: name.trim(),
                              teamId: viewTeamId(view),
                              folderId,
                            }),
                          );
                          if (scene) {
                            setDialog(null);
                            openCloudScene(scene.id);
                          }
                        }}
                      >
                        Save current canvas here
                      </SmallButton>
                    )}
                    <FilledButton
                      label="New scene"
                      onClick={async () => {
                        const result = await run(() =>
                          plusAPI.createScene({
                            name: "Untitled",
                            teamId: viewTeamId(view),
                            folderId,
                          }),
                        );
                        if (result) {
                          setDialog(null);
                          openCloudScene(result.scene.id);
                        }
                      }}
                    />
                  </>
                )}
              </div>

              <ErrorText error={error} />

              {!query && childFolders.length > 0 && (
                <ul className="plus-folders">
                  {childFolders.map((folder) => (
                    <li key={folder.id} className="plus-folder">
                      <button
                        className="plus-folder__open"
                        onClick={() => setFolderId(folder.id)}
                      >
                        <span aria-hidden="true">📁</span> {folder.name}
                      </button>
                      <span className="plus-folder__actions">
                        <SmallButton
                          title="Rename folder"
                          onClick={async () => {
                            const name = window.prompt(
                              "Rename folder",
                              folder.name,
                            );
                            if (name?.trim() && name !== folder.name) {
                              await run(() =>
                                plusAPI.updateFolder(folder.id, {
                                  name: name.trim(),
                                }),
                              );
                              load();
                            }
                          }}
                        >
                          Rename
                        </SmallButton>
                        <SmallButton
                          danger
                          title="Delete folder"
                          onClick={async () => {
                            if (
                              window.confirm(
                                `Delete "${folder.name}"? Scenes inside move to ${workspaceName}.`,
                              )
                            ) {
                              await run(() => plusAPI.deleteFolder(folder.id));
                              load();
                            }
                          }}
                        >
                          Delete
                        </SmallButton>
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {scenes.length === 0 && !pending ? (
                <div className="plus-empty">
                  {query
                    ? "No scenes match your search."
                    : view.kind === "shared"
                    ? "Scenes people share with you show up here."
                    : "No scenes here yet. Create one, or save your current canvas."}
                </div>
              ) : (
                <ul className="plus-scenes">
                  {scenes.map((scene) => (
                    <li
                      key={scene.id}
                      className={clsx("plus-scene", {
                        current: scene.id === cloudScene?.id,
                      })}
                    >
                      <button
                        className="plus-scene__open"
                        onClick={() => {
                          setDialog(null);
                          openCloudScene(scene.id);
                        }}
                      >
                        <span className="plus-scene__name">{scene.name}</span>
                        <span className="plus-muted">
                          {scene.elementCount} elements · edited{" "}
                          {timeAgo(scene.updatedAt)}
                        </span>
                      </button>
                      {view.kind !== "shared" && (
                        <span className="plus-scene__actions">
                          <SmallButton
                            onClick={async () => {
                              const name = window.prompt(
                                "Rename scene",
                                scene.name,
                              );
                              if (name?.trim() && name !== scene.name) {
                                await run(() =>
                                  plusAPI.updateScene(scene.id, {
                                    name: name.trim(),
                                  }),
                                );
                                load();
                              }
                            }}
                          >
                            Rename
                          </SmallButton>
                          <SmallButton
                            onClick={async () => {
                              await run(() => plusAPI.duplicateScene(scene.id));
                              load();
                            }}
                          >
                            Duplicate
                          </SmallButton>
                          {scene.ownerId === user.id ||
                          team?.role !== "member" ? (
                            <>
                              <SmallButton
                                onClick={() => setMovingScene(scene)}
                              >
                                Move
                              </SmallButton>
                              <SmallButton
                                danger
                                onClick={async () => {
                                  if (
                                    window.confirm(
                                      `Delete "${scene.name}"? This can't be undone.`,
                                    )
                                  ) {
                                    await run(() =>
                                      plusAPI.deleteScene(scene.id),
                                    );
                                    load();
                                  }
                                }}
                              >
                                Delete
                              </SmallButton>
                            </>
                          ) : null}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>

      {movingScene && (
        <MoveSceneForm
          scene={movingScene}
          teams={teams}
          onCancel={() => setMovingScene(null)}
          onMoved={() => {
            setMovingScene(null);
            load();
          }}
        />
      )}
    </Dialog>
  );
};

const MoveSceneForm = ({
  scene,
  teams,
  onCancel,
  onMoved,
}: {
  scene: SceneSummary;
  teams: TeamSummary[];
  onCancel: () => void;
  onMoved: () => void;
}) => {
  const [teamId, setTeamId] = useState<string>(scene.teamId ?? "");
  const [folderId, setFolderId] = useState<string>(scene.folderId ?? "");
  const [folders, setFolders] = useState<Folder[]>([]);
  const { pending, error, run } = useAsyncAction();

  useEffect(() => {
    run(async () =>
      setFolders((await plusAPI.listFolders(teamId || null)).folders),
    );
  }, [teamId, run]);

  const folderLabel = (folder: Folder): string => {
    const parent = folders.find((f) => f.id === folder.parentId);
    return parent ? `${folderLabel(parent)} / ${folder.name}` : folder.name;
  };

  return (
    <div className="plus-move" role="group" aria-label={`Move ${scene.name}`}>
      <strong>Move “{scene.name}”</strong>
      <select
        className="plus-select"
        aria-label="Workspace"
        value={teamId}
        onChange={(event) => {
          setTeamId(event.target.value);
          setFolderId("");
        }}
      >
        <option value="">My scenes</option>
        {teams.map((team) => (
          <option key={team.id} value={team.id}>
            {team.name}
          </option>
        ))}
      </select>
      <select
        className="plus-select"
        aria-label="Folder"
        value={folderId}
        onChange={(event) => setFolderId(event.target.value)}
      >
        <option value="">(no folder)</option>
        {folders
          .map((folder) => ({ folder, label: folderLabel(folder) }))
          .sort((a, b) => a.label.localeCompare(b.label))
          .map(({ folder, label }) => (
            <option key={folder.id} value={folder.id}>
              {label}
            </option>
          ))}
      </select>
      <SmallButton
        disabled={pending}
        onClick={async () => {
          const moved = await run(() =>
            plusAPI.updateScene(scene.id, {
              teamId: teamId || null,
              folderId: folderId || null,
            }),
          );
          if (moved) {
            onMoved();
          }
        }}
      >
        Move
      </SmallButton>
      <SmallButton onClick={onCancel}>Cancel</SmallButton>
      <ErrorText error={error} />
    </div>
  );
};
