import clsx from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { STORAGE_KEYS } from "../../app_constants";
import { appJotaiStore, Provider, useAtomValue } from "../../app-jotai";
import {
  notificationEngine,
  unreadNotificationCountAtom,
} from "../../notifications";
import { plusAPI, PlusAPIError, sceneThumbnailURL } from "../api";
import { goToSignIn } from "../auth";
import { MentionsPanel } from "../components/MentionsPanel";
import { TeamPanel } from "../components/TeamPanel";
import { AvatarContent, timeAgo, useAsyncAction } from "../components/ui";
import { folderAncestry, folderDescendants, folderTree } from "../folders";
import { startPlusNotificationsSync } from "../notificationsSync";
import { openCloudScene, watchCloudPresentation } from "../scenes";
import { plusUserAtom } from "../state";

import { FormModal, ModalProvider, useModal } from "./Modal";
import { parseSettingsTab, SettingsPage } from "./SettingsPage";

import "./dashboard.scss";

import type { SettingsTab } from "./SettingsPage";

import type {
  Folder,
  LivePresentation,
  PlusUser,
  SceneSummary,
  TeamSummary,
} from "../api";

type View =
  | { kind: "scenes" }
  | { kind: "shared" }
  | { kind: "mentions" }
  | { kind: "members" }
  | { kind: "settings"; tab: SettingsTab };

type SortKey = "created" | "updated" | "name";

const SORT_LABELS: Record<SortKey, string> = {
  created: "Last created",
  updated: "Last edited",
  name: "Name",
};

/** Where a scene can be dropped. */
type Destination = { teamId: string | null; folderId: string | null };

const getTheme = (): "light" | "dark" => {
  const stored = localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_THEME);
  if (stored === "dark" || stored === "light") {
    return stored;
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
};

const DRAG_TYPE = "application/x-excalidraw-scene";

// icons -----------------------------------------------------------------------

const Icon = ({ d, size = 18 }: { d: string; size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d={d} />
  </svg>
);

const ICONS = {
  lock: "M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3",
  folder:
    "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  plus: "M12 5v14M5 12h14",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  users:
    "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14a6.5 6.5 0 0 1 3.5 6",
  share: "M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13",
  at: "M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1",
  import: "M4 12h11M11 8l4 4-4 4M20 4v16",
  file: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M12 11v6M9 14h6",
  edit: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  trash:
    "M4 7h16M10 11v6M14 11v6M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V4h6v3",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  sort: "M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3",
  chevron: "M6 9l6 6 6-6",
  chevronRight: "M9 6l6 6-6 6",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  folderPlus:
    "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 11v6M9 14h6",
};

// page ------------------------------------------------------------------------

export const DashboardPage = () => {
  const [theme] = useState(getTheme);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Dashboard | Excalidraw";
    plusAPI
      .me()
      .then(({ user }) => appJotaiStore.set(plusUserAtom, user))
      .catch((error) => {
        if (error instanceof PlusAPIError && error.status === 401) {
          goToSignIn("signin", "workspace");
        } else {
          setFailed(error?.message || "Can't reach the server.");
        }
      });
  }, []);

  return (
    <div className={`dash theme--${theme}`}>
      <Provider store={appJotaiStore}>
        <SignedInDashboard theme={theme} failed={failed} />
      </Provider>
    </div>
  );
};

const SignedInDashboard = ({
  theme,
  failed,
}: {
  theme: "light" | "dark";
  failed: string | null;
}) => {
  const user = useAtomValue(plusUserAtom);

  // the editor isn't mounted here: run the notification engine ourselves,
  // once per account (not again when the name or avatar changes)
  const userId = user?.id;
  useEffect(() => {
    const current = appJotaiStore.get(plusUserAtom);
    if (!userId || !current) {
      return;
    }
    let stopped = false;
    let stopSync: (() => void) | null = null;
    notificationEngine.init().then(() => {
      if (!stopped) {
        stopSync = startPlusNotificationsSync(current);
      }
    });
    return () => {
      stopped = true;
      stopSync?.();
      notificationEngine.destroy();
    };
  }, [userId]);

  return user ? (
    <ModalProvider>
      <Dashboard user={user} theme={theme} />
    </ModalProvider>
  ) : (
    <div className="dash__splash" role="status">
      {failed ?? "Loading…"}
    </div>
  );
};

const Dashboard = ({
  user,
  theme,
}: {
  user: PlusUser;
  theme: "light" | "dark";
}) => {
  const modal = useModal();
  const { pending, error, setError, run } = useAsyncAction();

  const [teams, setTeams] = useState<TeamSummary[]>([]);
  // `?team=<id>` (from a "you were added to a team" notification) opens
  // that team's members
  const [openTeamId] = useState(() =>
    new URLSearchParams(window.location.search).get("team"),
  );
  const [teamId, setTeamId] = useState<string | null>(openTeamId);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [scenes, setScenes] = useState<SceneSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  // presentations running right now, refreshed while the page is open
  const [live, setLive] = useState<LivePresentation[]>([]);
  useEffect(() => {
    let cancelled = false;
    const refresh = () =>
      plusAPI
        .livePresentations()
        .then((result) => !cancelled && setLive(result.presentations))
        .catch(() => {});
    refresh();
    const interval = setInterval(refresh, 10_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);
  // `?settings=<tab>` is where the editor's profile button leads
  const [view, setView] = useState<View>(() => {
    const tab = parseSettingsTab(
      new URLSearchParams(window.location.search).get("settings"),
    );
    return tab
      ? { kind: "settings", tab }
      : { kind: openTeamId ? "members" : "scenes" };
  });
  const unreadNotifications = useAtomValue(unreadNotificationCountAtom);
  /** `null` is the workspace's top level (Private / General). */
  const [folderId, setFolderId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("created");
  const [dragging, setDragging] = useState<SceneSummary | null>(null);
  const [draggingFolder, setDraggingFolder] = useState<Folder | null>(null);
  /** Collections whose sub-collections are hidden in the sidebar. */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [movingFolder, setMovingFolder] = useState<Folder | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [movingScene, setMovingScene] = useState<SceneSummary | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const team = teams.find((t) => t.id === teamId) ?? null;
  const rootName = team ? "General" : "Private";

  const loadTeams = useCallback(
    () => run(async () => setTeams((await plusAPI.listTeams()).teams)),
    [run],
  );

  const load = useCallback(
    () =>
      run(async () => {
        if (view.kind === "settings") {
          return;
        }
        if (view.kind === "shared") {
          setFolders([]);
          setScenes((await plusAPI.listScenes({ scope: "shared" })).scenes);
        } else if (view.kind === "scenes" || view.kind === "members") {
          const [folderResult, sceneResult] = await Promise.all([
            plusAPI.listFolders(teamId),
            // every scene of the workspace: filtered by collection here, so
            // counts and drops update without a round trip
            plusAPI.listScenes({
              scope: teamId ? "team" : "personal",
              teamId,
            }),
          ]);
          setFolders(folderResult.folders);
          setScenes(sceneResult.scenes);
        }
        setLoaded(true);
      }),
    [run, teamId, view.kind],
  );

  useEffect(() => {
    loadTeams();
  }, [loadTeams]);
  useEffect(() => {
    load();
  }, [load]);

  // Ctrl/⌘ + K focuses the search
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const goToWorkspace = (nextTeamId: string | null) => {
    setTeamId(nextTeamId);
    setView({ kind: "scenes" });
    setFolderId(null);
    setQuery("");
    setLoaded(false);
  };

  const goToView = (next: View) => {
    setView(next);
    setFolderId(null);
    setQuery("");
    if (next.kind === "shared") {
      setLoaded(false);
    }
  };

  const canManage = (scene: SceneSummary) =>
    scene.ownerId === user.id || (!!team && team.role !== "member");

  // collections as a depth-first list, nested ones indented; the ones inside
  // a collapsed collection are left out
  const tree = useMemo(() => folderTree(folders), [folders]);
  const collections = useMemo(
    () =>
      tree.filter(
        ({ folder }) =>
          !folderAncestry(folders, folder.id)
            .slice(0, -1)
            .some((ancestor) => collapsed.has(ancestor.id)),
      ),
    [tree, folders, collapsed],
  );

  const toggleCollapsed = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });

  /** Opens a collection, revealing it in the sidebar if it was tucked away. */
  const openCollection = (id: string | null) => {
    setView({ kind: "scenes" });
    setFolderId(id);
    setQuery("");
    const ancestors = folderAncestry(folders, id).slice(0, -1);
    if (ancestors.some((ancestor) => collapsed.has(ancestor.id))) {
      setCollapsed((current) => {
        const next = new Set(current);
        ancestors.forEach((ancestor) => next.delete(ancestor.id));
        return next;
      });
    }
  };

  const countIn = (id: string | null) =>
    scenes.filter((scene) => scene.folderId === id).length;

  const breadcrumb = folderAncestry(folders, folderId);
  const subFolders = folders
    .filter((folder) => folder.parentId === folderId)
    .sort((a, b) => a.name.localeCompare(b.name));

  const currentFolder = folders.find((folder) => folder.id === folderId);
  const searching =
    query.trim().length > 0 &&
    view.kind !== "mentions" &&
    view.kind !== "settings";

  const visibleScenes = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = scenes.filter((scene) =>
      needle
        ? scene.name.toLowerCase().includes(needle)
        : view.kind === "shared" || scene.folderId === folderId,
    );
    return list.sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : sort === "updated"
        ? b.updatedAt - a.updatedAt
        : b.createdAt - a.createdAt,
    );
  }, [scenes, query, view.kind, folderId, sort]);

  const folderName = (id: string | null) =>
    id
      ? tree.find(({ folder }) => folder.id === id)?.path ?? "Collection"
      : rootName;

  // actions -------------------------------------------------------------------

  const createCollection = async (parent: Folder | null = null) => {
    const name = await modal.prompt({
      title: parent ? `New collection in “${parent.name}”` : "New collection",
      label: "Name",
      placeholder: "e.g. Wireframes",
      description: team
        ? `Everyone in ${team.name} will see it.`
        : "Only you will see it.",
      submitLabel: "Create",
    });
    if (!name) {
      return;
    }
    const result = await run(() =>
      plusAPI.createFolder({ name, parentId: parent?.id ?? null, teamId }),
    );
    if (result) {
      await load();
      openCollection(result.folder.id);
    }
  };

  const moveCollection = async (folder: Folder, parentId: string | null) => {
    if (
      parentId === folder.parentId ||
      parentId === folder.id ||
      (parentId && folderDescendants(folders, folder.id).has(parentId))
    ) {
      return;
    }
    const previous = folders;
    setFolders((current) =>
      current.map((f) => (f.id === folder.id ? { ...f, parentId } : f)),
    );
    const moved = await run(() =>
      plusAPI.updateFolder(folder.id, { parentId }),
    );
    if (!moved) {
      setFolders(previous);
    }
    load();
  };

  const renameCollection = async (folder: Folder) => {
    const name = await modal.prompt({
      title: "Rename collection",
      label: "Name",
      initialValue: folder.name,
    });
    if (name && name !== folder.name) {
      await run(() => plusAPI.updateFolder(folder.id, { name }));
      load();
    }
  };

  const deleteCollection = async (folder: Folder) => {
    const nestedCount = folderDescendants(folders, folder.id).size;
    const ok = await modal.confirm({
      title: "Delete collection",
      message: nestedCount
        ? `Delete “${folder.name}” and its ${nestedCount} sub-collection${
            nestedCount === 1 ? "" : "s"
          }? Their scenes move to ${rootName}.`
        : `Delete “${folder.name}”? Its scenes move to ${rootName}.`,
      submitLabel: "Delete",
      danger: true,
    });
    if (ok) {
      const deleted = await run(() => plusAPI.deleteFolder(folder.id));
      if (
        deleted !== undefined &&
        breadcrumb.some((ancestor) => ancestor.id === folder.id)
      ) {
        // the open collection was inside the deleted one
        setFolderId(folder.parentId);
      }
      load();
    }
  };

  const renameScene = async (scene: SceneSummary, name: string) => {
    const next = name.trim();
    if (!next || next === scene.name) {
      return;
    }
    const previous = scenes;
    setScenes((current) =>
      current.map((s) => (s.id === scene.id ? { ...s, name: next } : s)),
    );
    const updated = await run(() =>
      plusAPI.updateScene(scene.id, { name: next }),
    );
    if (!updated) {
      setScenes(previous);
    }
  };

  const deleteScene = async (scene: SceneSummary) => {
    const ok = await modal.confirm({
      title: "Delete scene",
      message: `Delete “${scene.name}”? This can't be undone.`,
      submitLabel: "Delete",
      danger: true,
    });
    if (ok) {
      await run(() => plusAPI.deleteScene(scene.id));
      load();
    }
  };

  const duplicateScene = async (scene: SceneSummary) => {
    await run(() => plusAPI.duplicateScene(scene.id));
    load();
  };

  const createTeam = async () => {
    const name = await modal.prompt({
      title: "New team",
      label: "Team name",
      description: "Teams share scenes and collections with their members.",
      submitLabel: "Create team",
    });
    if (!name) {
      return;
    }
    const result = await run(() => plusAPI.createTeam(name));
    if (result) {
      await loadTeams();
      setTeamId(result.team.id);
      setView({ kind: "members" });
      setFolderId(null);
      setLoaded(false);
    }
  };

  const moveScene = async (scene: SceneSummary, to: Destination) => {
    if (to.teamId === scene.teamId && to.folderId === scene.folderId) {
      return;
    }
    const previous = scenes;
    // show it in its new place straight away
    setScenes((current) =>
      to.teamId === scene.teamId
        ? current.map((s) =>
            s.id === scene.id ? { ...s, folderId: to.folderId } : s,
          )
        : current.filter((s) => s.id !== scene.id),
    );
    const moved = await run(() =>
      plusAPI.updateScene(scene.id, {
        teamId: to.teamId,
        folderId: to.folderId,
      }),
    );
    if (!moved) {
      setScenes(previous);
    }
    load();
  };

  const importFiles = async (files: FileList | null) => {
    if (!files?.length) {
      return;
    }
    const total = files.length;
    let imported = 0;
    for (const file of Array.from(files)) {
      const result = await run(async () => {
        const data = JSON.parse(await file.text());
        if (!Array.isArray(data?.elements)) {
          throw new Error(`“${file.name}” isn't an Excalidraw file.`);
        }
        return plusAPI.createScene({
          name: file.name.replace(/\.(excalidraw|json)$/i, "") || "Untitled",
          teamId,
          folderId,
          elements: data.elements.filter((el: any) => !el.isDeleted),
          appState: {
            viewBackgroundColor: data.appState?.viewBackgroundColor,
          },
          files: data.files ?? {},
        });
      });
      if (result) {
        imported++;
      }
    }
    if (imported < total && imported > 0) {
      setError(`Imported ${imported} of ${total} files.`);
    }
    if (importRef.current) {
      importRef.current.value = "";
    }
    load();
  };

  // drag and drop -------------------------------------------------------------

  /** Can what's being dragged be dropped here? */
  const canDrop = (destination: Destination) => {
    if (dragging) {
      return true;
    }
    if (draggingFolder) {
      // a collection can only move within its own workspace, and not into
      // itself or what's inside it
      return (
        destination.teamId === teamId &&
        destination.folderId !== draggingFolder.id &&
        !(
          destination.folderId &&
          folderDescendants(folders, draggingFolder.id).has(
            destination.folderId,
          )
        )
      );
    }
    return false;
  };

  const dropTarget = (key: string, destination: Destination) => ({
    "data-drop-key": key,
    onDragOver: (event: React.DragEvent) => {
      if (!canDrop(destination)) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDropKey(key);
    },
    onDragLeave: (event: React.DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        setDropKey((current) => (current === key ? null : current));
      }
    },
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const scene = dragging;
      const folder = draggingFolder;
      setDropKey(null);
      setDragging(null);
      setDraggingFolder(null);
      if (scene) {
        moveScene(scene, destination);
      } else if (folder && canDrop(destination)) {
        moveCollection(folder, destination.folderId);
      }
    },
  });

  // render --------------------------------------------------------------------

  const title =
    view.kind === "settings"
      ? "Profile settings"
      : view.kind === "shared"
      ? "Shared with me"
      : view.kind === "mentions"
      ? "Mentions"
      : view.kind === "members"
      ? `${team?.name ?? "Team"} members`
      : searching
      ? "Search results"
      : currentFolder?.name ?? rootName;

  const description =
    view.kind === "settings"
      ? "Your profile, keys and notifications."
      : view.kind === "shared"
      ? "Scenes other people shared with you."
      : view.kind === "mentions"
      ? "Scenes where someone mentioned you in a comment."
      : view.kind === "members"
      ? "Invite people and manage their roles."
      : searching
      ? `Scenes matching “${query.trim()}” in ${
          team?.name ?? "your workspace"
        }.`
      : currentFolder
      ? `${
          team
            ? `Visible to everyone in ${team.name}.`
            : "Only you can see this collection."
        } Drag a scene onto another collection to move it.`
      : team
      ? `Top level of ${team.name}, visible to all team members. Drag a scene onto a collection to organize it.`
      : "This is your private collection. No other team members can see it. Drag a scene to a team to make it visible to them.";

  const showScenes = view.kind === "scenes" || view.kind === "shared";
  const canCreate = view.kind === "scenes";

  return (
    <div className="dash__layout">
      <aside className="dash-sidebar">
        <div className="dash-sidebar__user">
          <button
            className="dash-sidebar__profile"
            onClick={() => goToView({ kind: "settings", tab: "profile" })}
            title="Profile settings"
          >
            <span className="dash-avatar" aria-hidden="true">
              <AvatarContent
                name={user.name || user.email}
                avatarUrl={user.avatarUrl}
                imgClassName="dash-avatar__img"
              />
            </span>
            <span className="dash-sidebar__user-name">
              {user.name || user.email}
            </span>
          </button>
          <a className="dash-sidebar__editor" href="/" title="Back to editor">
            Editor
          </a>
        </div>

        <div className="dash-sidebar__scroll">
          <label className="dash-search">
            <Icon d={ICONS.search} />
            <input
              ref={searchRef}
              type="search"
              placeholder="Quick search"
              aria-label="Search scenes"
              value={query}
              disabled={
                view.kind === "mentions" ||
                view.kind === "members" ||
                view.kind === "settings"
              }
              onChange={(event) => setQuery(event.target.value)}
            />
            <kbd>
              {/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl"}+K
            </kbd>
          </label>

          <nav className="dash-nav" aria-label="Dashboard">
            <button
              className={clsx({ active: view.kind === "scenes" && !folderId })}
              onClick={() => goToView({ kind: "scenes" })}
            >
              <Icon d={ICONS.grid} /> Dashboard
            </button>
            <button
              className={clsx({ active: view.kind === "shared" })}
              onClick={() => goToView({ kind: "shared" })}
            >
              <Icon d={ICONS.share} /> Shared with me
            </button>
            <button
              className={clsx({ active: view.kind === "mentions" })}
              onClick={() => goToView({ kind: "mentions" })}
            >
              <Icon d={ICONS.at} /> Mentions
            </button>
            <button
              className={clsx({ active: view.kind === "settings" })}
              onClick={() => goToView({ kind: "settings", tab: "profile" })}
            >
              <Icon d={ICONS.user} /> Profile settings
              {unreadNotifications > 0 && (
                <span
                  className="dash-count"
                  title={`${unreadNotifications} unread notifications`}
                >
                  {unreadNotifications}
                </span>
              )}
            </button>
            {team && (
              <button
                className={clsx({ active: view.kind === "members" })}
                onClick={() => goToView({ kind: "members" })}
              >
                <Icon d={ICONS.users} /> Team members
              </button>
            )}
          </nav>

          <div className="dash-section">
            <h3>Workspaces</h3>
          </div>
          <ul className="dash-list">
            <li>
              <button
                className={clsx("dash-item", {
                  active:
                    !team &&
                    view.kind !== "shared" &&
                    view.kind !== "mentions" &&
                    view.kind !== "settings",
                  "is-drop": dropKey === "ws:personal",
                })}
                onClick={() => goToWorkspace(null)}
                {...dropTarget("ws:personal", { teamId: null, folderId: null })}
              >
                <Icon d={ICONS.lock} /> <span>Private</span>
              </button>
            </li>
            {teams.map((t) => (
              <li key={t.id}>
                <button
                  className={clsx("dash-item", {
                    active:
                      teamId === t.id &&
                      view.kind !== "shared" &&
                      view.kind !== "mentions" &&
                      view.kind !== "settings",
                    "is-drop": dropKey === `ws:${t.id}`,
                  })}
                  onClick={() => goToWorkspace(t.id)}
                  {...dropTarget(`ws:${t.id}`, {
                    teamId: t.id,
                    folderId: null,
                  })}
                >
                  <Icon d={ICONS.users} /> <span>{t.name}</span>
                  <span className="dash-item__count">{t.memberCount}</span>
                </button>
              </li>
            ))}
            <li>
              <button className="dash-item dash-item--add" onClick={createTeam}>
                <Icon d={ICONS.plus} /> <span>New team</span>
              </button>
            </li>
          </ul>

          {(view.kind === "scenes" || view.kind === "members") && (
            <>
              <div className="dash-section">
                <h3>Collections</h3>
                <button
                  className="dash-icon-btn dash-icon-btn--primary"
                  onClick={() => createCollection(null)}
                  aria-label="New collection"
                  title="New collection"
                >
                  <Icon d={ICONS.plus} size={16} />
                </button>
              </div>
              <ul className="dash-list dash-collections">
                <li>
                  <button
                    className={clsx("dash-item", {
                      active: view.kind === "scenes" && folderId === null,
                      "is-drop": dropKey === "root",
                    })}
                    onClick={() => openCollection(null)}
                    {...dropTarget("root", { teamId, folderId: null })}
                  >
                    <Icon d={team ? ICONS.users : ICONS.lock} />
                    <span>{rootName}</span>
                    <span className="dash-item__count">{countIn(null)}</span>
                  </button>
                </li>
                {collections.map(({ folder, depth, hasChildren }) => (
                  <li
                    key={folder.id}
                    className={clsx("dash-collection", {
                      "is-dragging": draggingFolder?.id === folder.id,
                    })}
                    style={{ paddingLeft: `${Math.min(depth, 6) * 0.9}rem` }}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData(
                        DRAG_TYPE,
                        `folder:${folder.id}`,
                      );
                      event.dataTransfer.effectAllowed = "move";
                      setDraggingFolder(folder);
                    }}
                    onDragEnd={() => {
                      setDraggingFolder(null);
                      setDropKey(null);
                    }}
                  >
                    {hasChildren && (
                      <button
                        className="dash-collection__toggle"
                        aria-label={`${
                          collapsed.has(folder.id) ? "Expand" : "Collapse"
                        } ${folder.name}`}
                        aria-expanded={!collapsed.has(folder.id)}
                        onClick={() => toggleCollapsed(folder.id)}
                      >
                        <Icon
                          d={
                            collapsed.has(folder.id)
                              ? ICONS.chevronRight
                              : ICONS.chevron
                          }
                          size={14}
                        />
                      </button>
                    )}
                    <button
                      className={clsx("dash-item", {
                        active:
                          view.kind === "scenes" && folderId === folder.id,
                        "is-drop": dropKey === `folder:${folder.id}`,
                      })}
                      onClick={() => openCollection(folder.id)}
                      {...dropTarget(`folder:${folder.id}`, {
                        teamId,
                        folderId: folder.id,
                      })}
                    >
                      <Icon d={ICONS.folder} />
                      <span>{folder.name}</span>
                      <span className="dash-item__count">
                        {countIn(folder.id)}
                      </span>
                    </button>
                    <CollectionMenu
                      onNew={() => createCollection(folder)}
                      onRename={() => renameCollection(folder)}
                      onMove={() => setMovingFolder(folder)}
                      onDelete={() => deleteCollection(folder)}
                    />
                  </li>
                ))}
                {loaded && collections.length === 0 && (
                  <li className="dash-hint">
                    No collections yet. Use + to create one, then drag scenes
                    into it.
                  </li>
                )}
              </ul>
            </>
          )}
        </div>
      </aside>

      <main className="dash-main">
        <header className="dash-main__header">
          <div className="dash-main__heading">
            {view.kind === "scenes" && !searching && breadcrumb.length > 0 && (
              <nav className="dash-crumbs" aria-label="Collection path">
                <button onClick={() => openCollection(null)}>{rootName}</button>
                {breadcrumb.slice(0, -1).map((folder) => (
                  <span key={folder.id}>
                    <span aria-hidden="true"> / </span>
                    <button onClick={() => openCollection(folder.id)}>
                      {folder.name}
                    </button>
                  </span>
                ))}
              </nav>
            )}
            <h1>
              <Icon
                d={
                  view.kind === "settings"
                    ? ICONS.user
                    : view.kind === "shared"
                    ? ICONS.share
                    : view.kind === "mentions"
                    ? ICONS.at
                    : view.kind === "members"
                    ? ICONS.users
                    : currentFolder
                    ? ICONS.folder
                    : team
                    ? ICONS.users
                    : ICONS.lock
                }
                size={24}
              />
              {title}
            </h1>
            <p>{description}</p>
          </div>
          {showScenes && (
            <label className="dash-sort">
              <Icon d={ICONS.sort} size={16} />
              <select
                aria-label="Sort scenes"
                value={sort}
                onChange={(event) => setSort(event.target.value as SortKey)}
              >
                {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                  <option key={key} value={key}>
                    {SORT_LABELS[key]}
                  </option>
                ))}
              </select>
            </label>
          )}
        </header>

        {error && (
          <div className="dash-error" role="alert">
            {error}
            <button
              className="dash-link"
              onClick={() => {
                setError(null);
              }}
            >
              Dismiss
            </button>
          </div>
        )}

        {view.kind === "settings" ? (
          <div className="excalidraw dash-embed">
            <SettingsPage
              user={user}
              tab={view.tab}
              onTabChange={(tab) => setView({ kind: "settings", tab })}
            />
          </div>
        ) : view.kind === "mentions" ? (
          <MentionsPanel user={user} />
        ) : view.kind === "members" && team ? (
          <div className={clsx("excalidraw dash-embed", `theme--${theme}`)}>
            <TeamPanel
              teamId={team.id}
              user={user}
              onTeamsChanged={loadTeams}
              onLeft={() => goToWorkspace(null)}
            />
          </div>
        ) : (
          <>
            {canCreate && (
              <div className="dash-actions">
                <button
                  className="dash-action"
                  onClick={() => importRef.current?.click()}
                >
                  <span className="dash-action__icon">
                    <Icon d={ICONS.import} size={22} />
                  </span>
                  <span>Import scenes</span>
                  <Icon d={ICONS.plus} />
                </button>
                <button
                  className="dash-action"
                  onClick={() => setCreating(true)}
                >
                  <span className="dash-action__icon">
                    <Icon d={ICONS.file} size={22} />
                  </span>
                  <span>Create scene</span>
                  <Icon d={ICONS.plus} />
                </button>
                <button
                  className="dash-action"
                  onClick={() => createCollection(currentFolder ?? null)}
                >
                  <span className="dash-action__icon">
                    <Icon d={ICONS.folderPlus} size={22} />
                  </span>
                  <span>
                    {currentFolder ? "New sub-collection" : "New collection"}
                  </span>
                  <Icon d={ICONS.plus} />
                </button>
                <input
                  ref={importRef}
                  type="file"
                  hidden
                  multiple
                  accept=".excalidraw,.json,application/json"
                  onChange={(event) => importFiles(event.target.files)}
                />
              </div>
            )}

            {live.length > 0 && (
              <section className="dash-live" aria-label="Presenting now">
                <h2 className="dash-subheading">
                  <span className="dash-live-badge">Live</span> Presenting now
                </h2>
                <ul className="dash-live__list">
                  {live.map((item) => (
                    <li key={item.sceneId} className="dash-live__item">
                      <span className="dash-live__main">
                        <span className="dash-live__name">{item.name}</span>
                        <span className="dash-live__sub">
                          {item.presenter} · {item.viewers} watching
                          {item.hasPublicLink ? " · public link on" : ""}
                        </span>
                      </span>
                      <button
                        className="dash-btn dash-btn--primary"
                        onClick={() => watchCloudPresentation(item.sceneId)}
                      >
                        Watch
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {loaded && !searching && subFolders.length > 0 && (
              <>
                <h2 className="dash-subheading">
                  {currentFolder ? "Sub-collections" : "Collections"}
                </h2>
                <ul className="dash-folders">
                  {subFolders.map((folder) => (
                    <li key={folder.id}>
                      <button
                        className={clsx("dash-folder", {
                          "is-drop": dropKey === `tile:${folder.id}`,
                        })}
                        onClick={() => openCollection(folder.id)}
                        {...dropTarget(`tile:${folder.id}`, {
                          teamId,
                          folderId: folder.id,
                        })}
                      >
                        <Icon d={ICONS.folder} size={20} />
                        <span>{folder.name}</span>
                        <span className="dash-item__count">
                          {countIn(folder.id)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <h2 className="dash-subheading">Scenes</h2>
              </>
            )}

            {!loaded ? (
              <div className="dash-grid" aria-busy="true">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="dash-card dash-card--skeleton" />
                ))}
              </div>
            ) : visibleScenes.length === 0 ? (
              <div className="dash-empty">
                {searching
                  ? "No scenes match your search."
                  : view.kind === "shared"
                  ? "Scenes people share with you show up here."
                  : "No scenes here yet. Create one or import an .excalidraw file."}
              </div>
            ) : (
              <ul className="dash-grid">
                {visibleScenes.map((scene) => (
                  <SceneCard
                    key={scene.id}
                    scene={scene}
                    collection={
                      searching && view.kind === "scenes"
                        ? folderName(scene.folderId)
                        : null
                    }
                    draggable={view.kind === "scenes" && canManage(scene)}
                    isDragging={dragging?.id === scene.id}
                    manageable={view.kind === "scenes" && canManage(scene)}
                    editable={view.kind === "scenes"}
                    live={live.some((item) => item.sceneId === scene.id)}
                    onOpen={() => openCloudScene(scene.id)}
                    onDragStart={(event) => {
                      event.dataTransfer.setData(DRAG_TYPE, scene.id);
                      event.dataTransfer.effectAllowed = "move";
                      setDragging(scene);
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setDropKey(null);
                    }}
                    onRename={(name) => renameScene(scene, name)}
                    onDuplicate={() => duplicateScene(scene)}
                    onMove={() => setMovingScene(scene)}
                    onDelete={() => deleteScene(scene)}
                  />
                ))}
              </ul>
            )}
          </>
        )}
        {pending && (
          <span className="dash-busy" role="status" aria-label="Working" />
        )}
      </main>

      {creating && (
        <CreateSceneModal
          folders={folders}
          initialFolderId={folderId}
          rootName={rootName}
          onClose={() => setCreating(false)}
          onCreate={async (name, targetFolderId) => {
            const result = await run(() =>
              plusAPI.createScene({ name, teamId, folderId: targetFolderId }),
            );
            if (result) {
              setCreating(false);
              openCloudScene(result.scene.id);
            }
          }}
          pending={pending}
          error={error}
        />
      )}

      {movingFolder && (
        <MoveCollectionModal
          folder={movingFolder}
          folders={folders}
          rootName={rootName}
          onClose={() => setMovingFolder(null)}
          onMove={(parentId) => {
            const folder = movingFolder;
            setMovingFolder(null);
            moveCollection(folder, parentId);
          }}
        />
      )}

      {movingScene && (
        <MoveSceneModal
          scene={movingScene}
          teams={teams}
          onClose={() => setMovingScene(null)}
          onMove={async (to) => {
            const scene = movingScene;
            setMovingScene(null);
            await moveScene(scene, to);
          }}
        />
      )}
    </div>
  );
};

// pieces ----------------------------------------------------------------------

const useDismissOnOutsideClick = (open: boolean, close: () => void) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) {
      return;
    }
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) {
        close();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
};

const Menu = ({
  label,
  className,
  items,
}: {
  label: string;
  className?: string;
  items: { label: string; onSelect: () => void; danger?: boolean }[];
}) => {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismissOnOutsideClick(open, close);
  return (
    <div className={clsx("dash-menu", className)} ref={ref}>
      <button
        className="dash-icon-btn"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(!open);
        }}
      >
        <Icon d={ICONS.more} size={16} />
      </button>
      {open && (
        <div className="dash-menu__popup" role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              className={clsx({ danger: item.danger })}
              onClick={(event) => {
                event.stopPropagation();
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const CollectionMenu = ({
  onNew,
  onRename,
  onMove,
  onDelete,
}: {
  onNew: () => void;
  onRename: () => void;
  onMove: () => void;
  onDelete: () => void;
}) => (
  <Menu
    label="Collection options"
    className="dash-collection__menu"
    items={[
      { label: "New sub-collection", onSelect: onNew },
      { label: "Rename", onSelect: onRename },
      { label: "Move to…", onSelect: onMove },
      { label: "Delete", onSelect: onDelete, danger: true },
    ]}
  />
);

const SceneCard = ({
  scene,
  collection,
  draggable,
  isDragging,
  manageable,
  editable,
  live,
  onOpen,
  onDragStart,
  onDragEnd,
  onRename,
  onDuplicate,
  onMove,
  onDelete,
}: {
  scene: SceneSummary;
  collection: string | null;
  draggable: boolean;
  isDragging: boolean;
  manageable: boolean;
  editable: boolean;
  live: boolean;
  onOpen: () => void;
  onDragStart: (event: React.DragEvent) => void;
  onDragEnd: () => void;
  onRename: (name: string) => void;
  onDuplicate: () => void;
  onMove: () => void;
  onDelete: () => void;
}) => {
  const [editing, setEditing] = useState(false);
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const [draft, setDraft] = useState(scene.name);

  const startEditing = () => {
    setDraft(scene.name);
    setEditing(true);
  };
  const finishEditing = (save: boolean) => {
    setEditing(false);
    if (save) {
      onRename(draft);
    }
  };

  const items = [
    { label: "Rename", onSelect: startEditing },
    { label: "Duplicate", onSelect: onDuplicate },
    ...(manageable ? [{ label: "Move to…", onSelect: onMove }] : []),
    ...(manageable
      ? [{ label: "Delete", onSelect: onDelete, danger: true }]
      : []),
  ];
  return (
    <li
      className={clsx("dash-card", { "is-dragging": isDragging })}
      draggable={draggable && !editing}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <button className="dash-card__preview" onClick={onOpen}>
        {scene.thumbnailAt && !thumbnailFailed ? (
          <img
            className="dash-card__thumb"
            src={sceneThumbnailURL(scene.id, scene.thumbnailAt)}
            alt=""
            loading="lazy"
            draggable={false}
            onError={() => setThumbnailFailed(true)}
          />
        ) : (
          <span className="dash-card__initial" aria-hidden="true">
            {scene.name.trim()[0]?.toUpperCase() || "?"}
          </span>
        )}
        <span className="dash-card__time">{timeAgo(scene.updatedAt)}</span>
        {live && <span className="dash-live-badge dash-card__live">Live</span>}
      </button>
      {editable && !editing && (
        <div className="dash-card__quick">
          <button
            className="dash-icon-btn"
            title="Rename"
            aria-label={`Rename ${scene.name}`}
            onClick={startEditing}
          >
            <Icon d={ICONS.edit} size={16} />
          </button>
          {manageable && (
            <button
              className="dash-icon-btn dash-icon-btn--danger"
              title="Delete"
              aria-label={`Delete ${scene.name}`}
              onClick={onDelete}
            >
              <Icon d={ICONS.trash} size={16} />
            </button>
          )}
        </div>
      )}
      <div className="dash-card__meta">
        <div className="dash-card__row">
          {editing ? (
            <input
              className="dash-card__edit"
              aria-label="Scene name"
              value={draft}
              maxLength={120}
              autoFocus
              onFocus={(event) => event.target.select()}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => finishEditing(true)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  finishEditing(true);
                } else if (event.key === "Escape") {
                  event.stopPropagation();
                  finishEditing(false);
                }
              }}
            />
          ) : (
            <button
              className="dash-card__name"
              onClick={onOpen}
              title={scene.name}
            >
              {scene.name}
            </button>
          )}
          {editable && (
            <Menu label={`Options for ${scene.name}`} items={items} />
          )}
        </div>
        <span className="dash-card__sub">
          {collection ? `${collection} · ` : ""}
          {scene.elementCount}{" "}
          {scene.elementCount === 1 ? "element" : "elements"}
        </span>
      </div>
    </li>
  );
};

const MoveCollectionModal = ({
  folder,
  folders,
  rootName,
  onClose,
  onMove,
}: {
  folder: Folder;
  folders: Folder[];
  rootName: string;
  onClose: () => void;
  onMove: (parentId: string | null) => void;
}) => {
  const [parentId, setParentId] = useState(folder.parentId ?? "");
  // not into itself, nor anywhere inside itself
  const blocked = folderDescendants(folders, folder.id);
  blocked.add(folder.id);
  return (
    <FormModal
      title={`Move “${folder.name}”`}
      submitLabel="Move"
      onClose={onClose}
      onSubmit={() => onMove(parentId || null)}
    >
      <label className="dash-field">
        <span className="dash-field__label">Inside</span>
        <select
          className="dash-input"
          value={parentId}
          onChange={(event) => setParentId(event.target.value)}
        >
          <option value="">{rootName} (top level)</option>
          {folderTree(folders)
            .filter(({ folder: f }) => !blocked.has(f.id))
            .map(({ folder: f, path }) => (
              <option key={f.id} value={f.id}>
                {path}
              </option>
            ))}
        </select>
      </label>
    </FormModal>
  );
};

const CreateSceneModal = ({
  folders,
  initialFolderId,
  rootName,
  pending,
  error,
  onClose,
  onCreate,
}: {
  folders: Folder[];
  initialFolderId: string | null;
  rootName: string;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onCreate: (name: string, folderId: string | null) => void;
}) => {
  const [name, setName] = useState("Untitled");
  const [folderId, setFolderId] = useState(initialFolderId ?? "");
  return (
    <FormModal
      title="Create scene"
      submitLabel="Create & open"
      disabled={!name.trim()}
      pending={pending}
      error={error}
      onClose={onClose}
      onSubmit={() => onCreate(name.trim(), folderId || null)}
    >
      <label className="dash-field">
        <span className="dash-field__label">Name</span>
        <input
          className="dash-input"
          value={name}
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className="dash-field">
        <span className="dash-field__label">Collection</span>
        <select
          className="dash-input"
          value={folderId}
          onChange={(event) => setFolderId(event.target.value)}
        >
          <option value="">{rootName}</option>
          {folderTree(folders).map(({ folder, path }) => (
            <option key={folder.id} value={folder.id}>
              {path}
            </option>
          ))}
        </select>
      </label>
    </FormModal>
  );
};

const MoveSceneModal = ({
  scene,
  teams,
  onClose,
  onMove,
}: {
  scene: SceneSummary;
  teams: TeamSummary[];
  onClose: () => void;
  onMove: (to: Destination) => void;
}) => {
  const [teamId, setTeamId] = useState(scene.teamId ?? "");
  const [folderId, setFolderId] = useState(scene.folderId ?? "");
  const [folders, setFolders] = useState<Folder[]>([]);
  const { error, run } = useAsyncAction();

  useEffect(() => {
    run(async () =>
      setFolders((await plusAPI.listFolders(teamId || null)).folders),
    );
  }, [teamId, run]);

  return (
    <FormModal
      title={`Move “${scene.name}”`}
      submitLabel="Move"
      error={error}
      onClose={onClose}
      onSubmit={() =>
        onMove({ teamId: teamId || null, folderId: folderId || null })
      }
    >
      <label className="dash-field">
        <span className="dash-field__label">Team</span>
        <select
          className="dash-input"
          value={teamId}
          onChange={(event) => {
            setTeamId(event.target.value);
            setFolderId("");
          }}
        >
          <option value="">Private</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
      </label>
      <label className="dash-field">
        <span className="dash-field__label">Collection</span>
        <select
          className="dash-input"
          value={folderId}
          onChange={(event) => setFolderId(event.target.value)}
        >
          <option value="">{teamId ? "General" : "Private"}</option>
          {folderTree(folders).map(({ folder, path }) => (
            <option key={folder.id} value={folder.id}>
              {path}
            </option>
          ))}
        </select>
      </label>
    </FormModal>
  );
};
