import { all, get } from "./db.ts";
import { forbidden, notFound, unauthorized } from "./http.ts";

import type { DB } from "./db.ts";
import type { Request } from "./http.ts";
import type { User } from "./auth.ts";

export type SceneRole = "owner" | "editor" | "viewer";
export type TeamRole = "owner" | "admin" | "member";

const RANK: Record<SceneRole, number> = { viewer: 1, editor: 2, owner: 3 };

export const maxRole = (
  ...roles: (SceneRole | null | undefined)[]
): SceneRole | null =>
  roles.reduce<SceneRole | null>(
    (best, role) => (role && (!best || RANK[role] > RANK[best]) ? role : best),
    null,
  );

export const roleAtLeast = (role: SceneRole | null, required: SceneRole) =>
  !!role && RANK[role] >= RANK[required];

export type SceneRow = {
  id: string;
  owner_id: string;
  team_id: string | null;
  folder_id: string | null;
  name: string;
  elements: string;
  app_state: string;
  presentation: string;
  version: number;
  created_at: number;
  updated_at: number;
  thumbnail?: string | null;
  thumbnail_at?: number | null;
};

export const getTeamRole = (
  db: DB,
  teamId: string,
  userId: string,
): TeamRole | null =>
  get<{ role: TeamRole }>(
    db,
    "SELECT role FROM team_members WHERE team_id = ? AND user_id = ?",
    teamId,
    userId,
  )?.role ?? null;

export const requireTeamRole = (
  db: DB,
  teamId: string,
  user: User,
  required: "member" | "admin" = "member",
): TeamRole => {
  const role = getTeamRole(db, teamId, user.id);
  if (!role) {
    throw notFound("Team not found");
  }
  if (required === "admin" && role === "member") {
    throw forbidden("Only team admins can do this");
  }
  return role;
};

/** The share-link token a request carries, if any. */
export const getShareToken = (req: Request) =>
  (req.headers["x-share-token"] as string | undefined) ||
  req.query.get("share") ||
  null;

export const resolveSceneRole = (
  db: DB,
  scene: SceneRow,
  user: User | null,
  shareToken: string | null,
): SceneRole | null => {
  let userRole: SceneRole | null = null;
  if (user) {
    if (scene.owner_id === user.id) {
      return "owner";
    }
    if (scene.team_id) {
      const teamRole = getTeamRole(db, scene.team_id, user.id);
      if (teamRole === "owner" || teamRole === "admin") {
        userRole = "owner";
      } else if (teamRole === "member") {
        userRole = "editor";
      }
    }
    const direct = get<{ role: SceneRole }>(
      db,
      "SELECT role FROM scene_access WHERE scene_id = ? AND user_id = ?",
      scene.id,
      user.id,
    );
    userRole = maxRole(userRole, direct?.role);
  }
  let linkRole: SceneRole | null = null;
  if (shareToken) {
    linkRole =
      get<{ role: SceneRole }>(
        db,
        "SELECT role FROM share_links WHERE token = ? AND scene_id = ?",
        shareToken,
        scene.id,
      )?.role ?? null;
  }
  return maxRole(userRole, linkRole);
};

/**
 * Loads a scene and checks the caller has at least `required` on it.
 * Missing scenes and scenes the caller can't see both answer 404, so scene
 * ids can't be probed.
 */
export const loadSceneForRole = (
  db: DB,
  req: Request,
  user: User | null,
  sceneId: string,
  required: SceneRole,
) => {
  const scene = get<SceneRow>(db, "SELECT * FROM scenes WHERE id = ?", sceneId);
  if (!scene) {
    throw notFound("Scene not found");
  }
  const role = resolveSceneRole(db, scene, user, getShareToken(req));
  if (!role) {
    if (!user) {
      throw unauthorized();
    }
    throw notFound("Scene not found");
  }
  if (!roleAtLeast(role, required)) {
    throw forbidden(
      required === "owner"
        ? "Only the scene owner can do this"
        : "You have view-only access to this scene",
    );
  }
  return { scene, role };
};

export type Person = {
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
};

/**
 * Everyone with an account who can open the scene: its owner, people it's
 * shared with, and the members of its team. (Share-link visitors aren't
 * included: links are anonymous.)
 */
export const getScenePeople = (db: DB, scene: SceneRow): Person[] => {
  const rows = all<{
    id: string;
    name: string;
    email: string;
    avatar_url: string | null;
  }>(
    db,
    `SELECT id, name, email, avatar_url FROM users WHERE id = ?
     UNION
     SELECT users.id, users.name, users.email, users.avatar_url FROM scene_access
       JOIN users ON users.id = scene_access.user_id WHERE scene_access.scene_id = ?
     UNION
     SELECT users.id, users.name, users.email, users.avatar_url FROM team_members
       JOIN users ON users.id = team_members.user_id WHERE team_members.team_id = ?
     ORDER BY name`,
    scene.owner_id,
    scene.id,
    scene.team_id ?? "",
  );
  return rows.map((row) => ({
    userId: row.id,
    name: row.name,
    email: row.email,
    avatarUrl: row.avatar_url ?? null,
  }));
};

export type FolderRow = {
  id: string;
  owner_id: string;
  team_id: string | null;
  parent_id: string | null;
  name: string;
  created_at: number;
};

/** Personal folders belong to their owner; team folders to every member. */
export const loadFolder = (db: DB, user: User, folderId: string) => {
  const folder = get<FolderRow>(
    db,
    "SELECT * FROM folders WHERE id = ?",
    folderId,
  );
  if (!folder) {
    throw notFound("Folder not found");
  }
  if (folder.team_id) {
    requireTeamRole(db, folder.team_id, user);
  } else if (folder.owner_id !== user.id) {
    throw notFound("Folder not found");
  }
  return folder;
};
