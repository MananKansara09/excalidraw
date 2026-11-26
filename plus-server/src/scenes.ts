import { all, get, newId, now, run, transaction } from "./db.ts";
import { badRequest } from "./http.ts";

import type { DB } from "./db.ts";
import type { SceneRole, SceneRow } from "./access.ts";
import type { User } from "./auth.ts";

/** The subset of an Excalidraw element the server relies on. */
export type SceneElement = {
  id: string;
  type?: string;
  version?: number;
  versionNonce?: number;
  index?: string | null;
  isDeleted?: boolean;
  [key: string]: unknown;
};

export type SceneFile = {
  id: string;
  mimeType: string;
  dataURL: string;
  created?: number;
};

/** appState keys worth keeping in the cloud; the rest is per-viewer. */
const PERSISTED_APP_STATE_KEYS = [
  "viewBackgroundColor",
  "gridSize",
  "gridStep",
  "gridModeEnabled",
  "name",
  "lockedMultiSelections",
] as const;

export const pickAppState = (appState: unknown) => {
  const picked: Record<string, unknown> = {};
  if (appState && typeof appState === "object") {
    for (const key of PERSISTED_APP_STATE_KEYS) {
      if (key in appState) {
        picked[key] = (appState as any)[key];
      }
    }
  }
  return picked;
};

const validateElements = (elements: unknown): SceneElement[] => {
  if (!Array.isArray(elements)) {
    throw badRequest('"elements" must be an array');
  }
  for (const element of elements) {
    if (
      !element ||
      typeof element !== "object" ||
      typeof element.id !== "string"
    ) {
      throw badRequest("Every element needs a string id");
    }
  }
  return elements as SceneElement[];
};

/**
 * Merges incoming elements into the stored ones using Excalidraw's rule: the
 * higher `version` wins, ties broken by the lower `versionNonce`. Returns the
 * merged list and the elements whose incoming copy won (to broadcast).
 */
export const mergeElements = (
  stored: SceneElement[],
  incoming: SceneElement[],
) => {
  const byId = new Map(stored.map((element) => [element.id, element]));
  const accepted: SceneElement[] = [];
  for (const element of incoming) {
    const existing = byId.get(element.id);
    const incomingVersion = element.version ?? 0;
    const existingVersion = existing?.version ?? -1;
    if (
      !existing ||
      incomingVersion > existingVersion ||
      (incomingVersion === existingVersion &&
        (element.versionNonce ?? 0) < (existing.versionNonce ?? 0))
    ) {
      byId.set(element.id, element);
      accepted.push(element);
    }
  }
  const merged = [...byId.values()];
  // fractional indices define z-order; keep elements without one in place
  if (merged.every((element) => typeof element.index === "string")) {
    merged.sort((a, b) =>
      a.index! < b.index! ? -1 : a.index! > b.index! ? 1 : 0,
    );
  }
  return { merged, accepted };
};

const validateFiles = (files: unknown): SceneFile[] => {
  if (files === undefined || files === null) {
    return [];
  }
  if (typeof files !== "object") {
    throw badRequest('"files" must be an object keyed by file id');
  }
  return Object.values(files as Record<string, SceneFile>).filter(
    (file) =>
      file &&
      typeof file.id === "string" &&
      typeof file.dataURL === "string" &&
      file.dataURL.startsWith("data:") &&
      typeof file.mimeType === "string",
  );
};

const storeFiles = (db: DB, sceneId: string, files: SceneFile[]) => {
  for (const file of files) {
    run(
      db,
      `INSERT OR IGNORE INTO scene_files (scene_id, file_id, mime_type, data_url, created)
       VALUES (?, ?, ?, ?, ?)`,
      sceneId,
      file.id,
      file.mimeType,
      file.dataURL,
      file.created ?? now(),
    );
  }
};

export const getSceneFiles = (db: DB, sceneId: string) => {
  const files: Record<string, SceneFile> = {};
  for (const row of all<{
    file_id: string;
    mime_type: string;
    data_url: string;
    created: number;
  }>(db, "SELECT * FROM scene_files WHERE scene_id = ?", sceneId)) {
    files[row.file_id] = {
      id: row.file_id,
      mimeType: row.mime_type,
      dataURL: row.data_url,
      created: row.created,
    };
  }
  return files;
};

export const sceneSummary = (scene: SceneRow, role?: SceneRole | null) => {
  const elements = JSON.parse(scene.elements) as SceneElement[];
  return {
    id: scene.id,
    name: scene.name,
    ownerId: scene.owner_id,
    teamId: scene.team_id,
    folderId: scene.folder_id,
    version: scene.version,
    elementCount: elements.filter((element) => !element.isDeleted).length,
    createdAt: scene.created_at,
    updatedAt: scene.updated_at,
    /** When the preview image was rendered; `null` if there is none yet. */
    thumbnailAt: scene.thumbnail ? scene.thumbnail_at ?? null : null,
    ...(role ? { role } : {}),
  };
};

export const sceneDetail = (
  db: DB,
  scene: SceneRow,
  role: SceneRole,
  { includeFiles = true } = {},
) => ({
  ...sceneSummary(scene, role),
  elements: JSON.parse(scene.elements) as SceneElement[],
  appState: JSON.parse(scene.app_state),
  presentation: JSON.parse(scene.presentation) as string[],
  ...(includeFiles ? { files: getSceneFiles(db, scene.id) } : {}),
});

export const createScene = (
  db: DB,
  user: User,
  input: {
    name: string;
    teamId?: string | null;
    folderId?: string | null;
    elements?: unknown;
    appState?: unknown;
    files?: unknown;
  },
) => {
  const elements = validateElements(input.elements ?? []);
  const files = validateFiles(input.files);
  const id = newId();
  const timestamp = now();
  transaction(db, () => {
    run(
      db,
      `INSERT INTO scenes (id, owner_id, team_id, folder_id, name, elements, app_state, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      id,
      user.id,
      input.teamId ?? null,
      input.folderId ?? null,
      input.name,
      JSON.stringify(elements),
      JSON.stringify(pickAppState(input.appState)),
      timestamp,
      timestamp,
    );
    storeFiles(db, id, files);
  });
  return get<SceneRow>(db, "SELECT * FROM scenes WHERE id = ?", id)!;
};

/**
 * Applies an update from an editor. With `replace`, elements missing from
 * the payload are dropped (REST "PUT" semantics for API clients); otherwise
 * the payload is merged in (what the editor sends while collaborating).
 */
export const updateSceneContent = (
  db: DB,
  sceneId: string,
  input: {
    elements?: unknown;
    appState?: unknown;
    files?: unknown;
    replace?: boolean;
  },
) =>
  transaction(db, () => {
    const scene = get<SceneRow>(
      db,
      "SELECT * FROM scenes WHERE id = ?",
      sceneId,
    )!;
    let accepted: SceneElement[] = [];
    let elements = JSON.parse(scene.elements) as SceneElement[];
    if (input.elements !== undefined) {
      const incoming = validateElements(input.elements);
      if (input.replace) {
        const incomingIds = new Set(incoming.map((element) => element.id));
        const removed = elements
          .filter(
            (element) => !incomingIds.has(element.id) && !element.isDeleted,
          )
          .map((element) => ({
            ...element,
            isDeleted: true,
            version: (element.version ?? 0) + 1,
          }));
        const result = mergeElements(elements, [...incoming, ...removed]);
        elements = result.merged;
        accepted = result.accepted;
      } else {
        const result = mergeElements(elements, incoming);
        elements = result.merged;
        accepted = result.accepted;
      }
    }
    const files = validateFiles(input.files);
    storeFiles(db, sceneId, files);
    const appState =
      input.appState !== undefined
        ? { ...JSON.parse(scene.app_state), ...pickAppState(input.appState) }
        : JSON.parse(scene.app_state);
    const changed =
      accepted.length > 0 || files.length > 0 || input.appState !== undefined;
    const version = changed ? scene.version + 1 : scene.version;
    if (changed) {
      run(
        db,
        `UPDATE scenes SET elements = ?, app_state = ?, version = ?, updated_at = ? WHERE id = ?`,
        JSON.stringify(elements),
        JSON.stringify(appState),
        version,
        now(),
        sceneId,
      );
    }
    return { version, accepted, files, appState, changed };
  });

/** Scenes the user can see, optionally narrowed to a team / folder / scope. */
export const listScenes = (
  db: DB,
  user: User,
  filter: {
    teamId?: string | null;
    folderId?: string | null;
    scope?: "personal" | "team" | "shared" | "all";
    q?: string | null;
  },
) => {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const scope = filter.scope ?? (filter.teamId ? "team" : "personal");

  if (scope === "personal") {
    clauses.push("scenes.owner_id = ? AND scenes.team_id IS NULL");
    params.push(user.id);
  } else if (scope === "team") {
    clauses.push(
      "scenes.team_id = ? AND EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id = scenes.team_id AND tm.user_id = ?)",
    );
    params.push(filter.teamId, user.id);
  } else if (scope === "shared") {
    clauses.push(
      "EXISTS (SELECT 1 FROM scene_access sa WHERE sa.scene_id = scenes.id AND sa.user_id = ?)",
    );
    params.push(user.id);
  } else {
    clauses.push(`(
      (scenes.owner_id = ? AND scenes.team_id IS NULL)
      OR EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id = scenes.team_id AND tm.user_id = ?)
      OR EXISTS (SELECT 1 FROM scene_access sa WHERE sa.scene_id = scenes.id AND sa.user_id = ?)
    )`);
    params.push(user.id, user.id, user.id);
  }

  if (filter.folderId !== undefined && scope !== "shared" && scope !== "all") {
    if (filter.folderId === null) {
      clauses.push("scenes.folder_id IS NULL");
    } else {
      clauses.push("scenes.folder_id = ?");
      params.push(filter.folderId);
    }
  }
  if (filter.q) {
    clauses.push("scenes.name LIKE ? ESCAPE '\\'");
    params.push(`%${filter.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  }

  return all<SceneRow>(
    db,
    `SELECT * FROM scenes WHERE ${clauses.join(
      " AND ",
    )} ORDER BY updated_at DESC`,
    ...params,
  );
};
