import {
  getScenePeople,
  resolveSceneRole,
  loadFolder,
  loadSceneForRole,
  requireTeamRole,
  roleAtLeast,
} from "../access.ts";
import { getUser, requireUser } from "../auth.ts";
import { all, get, newId, now, run } from "../db.ts";
import {
  badRequest,
  forbidden,
  notFound,
  optionalString,
  requireOneOf,
  requireString,
} from "../http.ts";
import { BROADCAST_SIGNALS, TARGETED_SIGNALS } from "../realtime.ts";
import {
  createScene,
  getSceneFiles,
  listScenes,
  sceneDetail,
  sceneSummary,
  updateSceneContent,
} from "../scenes.ts";

import type { AppContext } from "../context.ts";
import type { Request, Router } from "../http.ts";

import type { FolderRow, SceneRow } from "../access.ts";
import type { User } from "../auth.ts";

const sceneChannel = (sceneId: string) => `scene:${sceneId}`;

/** Checks the caller may put a scene or folder in this team/folder. */
const resolveLocation = (
  ctx: AppContext,
  user: User,
  teamId: unknown,
  folderId: unknown,
) => {
  const team = optionalString(teamId, "teamId");
  const folder = optionalString(folderId, "folderId");
  if (team) {
    requireTeamRole(ctx.db, team, user);
  }
  if (folder) {
    const row = loadFolder(ctx.db, user, folder);
    if ((row.team_id ?? null) !== (team ?? null)) {
      throw badRequest("The folder belongs to a different workspace");
    }
  }
  return { teamId: team, folderId: folder };
};

const folderJSON = (folder: FolderRow) => ({
  id: folder.id,
  name: folder.name,
  parentId: folder.parent_id,
  teamId: folder.team_id,
  ownerId: folder.owner_id,
  createdAt: folder.created_at,
});

type CommentRow = {
  id: string;
  scene_id: string;
  parent_id: string | null;
  author_id: string;
  author_name: string;
  element_id: string | null;
  x: number | null;
  y: number | null;
  body: string;
  mentions: string;
  resolved: number;
  created_at: number;
  updated_at: number;
};

const commentJSON = (comment: CommentRow) => ({
  id: comment.id,
  sceneId: comment.scene_id,
  parentId: comment.parent_id,
  author: { id: comment.author_id, name: comment.author_name },
  elementId: comment.element_id,
  x: comment.x,
  y: comment.y,
  body: comment.body,
  mentions: JSON.parse(comment.mentions || "[]") as {
    userId: string;
    name: string;
  }[],
  resolved: !!comment.resolved,
  createdAt: comment.created_at,
  updatedAt: comment.updated_at,
});

const loadComment = (ctx: AppContext, commentId: string) => {
  const comment = get<CommentRow>(
    ctx.db,
    `SELECT comments.*, users.name AS author_name FROM comments
     JOIN users ON users.id = comments.author_id WHERE comments.id = ?`,
    commentId,
  );
  if (!comment) {
    throw notFound("Comment not found");
  }
  return comment;
};

const shareLinkJSON = (
  ctx: AppContext,
  link: { token: string; role: string; created_at: number },
) => ({
  token: link.token,
  role: link.role,
  createdAt: link.created_at,
  url: ctx.config.publicUrl
    ? `${ctx.config.publicUrl}/#share=${link.token}`
    : null,
});

export const registerSceneRoutes = (router: Router, ctx: AppContext) => {
  const { db, hub } = ctx;

  // scenes ---------------------------------------------------------------------

  router.get("/api/v1/scenes", (req) => {
    const user = requireUser(db, req);
    const scope = req.query.get("scope");
    const teamId = req.query.get("teamId");
    if (teamId) {
      requireTeamRole(db, teamId, user);
    }
    const folderParam = req.query.get("folderId");
    return {
      scenes: listScenes(db, user, {
        teamId,
        scope: (scope as any) || undefined,
        folderId:
          folderParam === null
            ? undefined
            : folderParam === "root"
            ? null
            : folderParam,
        q: req.query.get("q"),
      }).map((scene) => sceneSummary(scene)),
    };
  });

  router.post("/api/v1/scenes", async (req) => {
    const user = requireUser(db, req);
    const body = await req.body();
    const location = resolveLocation(ctx, user, body.teamId, body.folderId);
    const scene = createScene(db, user, {
      name: requireString(body.name ?? "Untitled", "name", { max: 200 }),
      ...location,
      elements: body.elements,
      appState: body.appState,
      files: body.files,
    });
    return { scene: sceneDetail(db, scene, "owner") };
  });

  router.get("/api/v1/scenes/:sceneId", (req) => {
    const user = getUser(db, req);
    const { scene, role } = loadSceneForRole(
      db,
      req,
      user,
      req.params.sceneId,
      "viewer",
    );
    return {
      scene: sceneDetail(db, scene, role, {
        includeFiles: req.query.get("files") !== "0",
      }),
    };
  });

  /**
   * Saves scene content. The editor sends changed elements and they are
   * merged; `?replace=1` (REST clients) makes the payload the whole scene.
   */
  const saveContent = async (req: Request, replace: boolean) => {
    const user = getUser(db, req);
    const { scene } = loadSceneForRole(
      db,
      req,
      user,
      req.params.sceneId,
      "editor",
    );
    const body = await req.body();
    const result = updateSceneContent(db, scene.id, {
      elements: body.elements,
      appState: body.appState,
      files: body.files,
      replace: replace || req.query.get("replace") === "1",
    });
    if (result.changed) {
      hub.broadcast(
        sceneChannel(scene.id),
        "scene-update",
        {
          version: result.version,
          elements: result.accepted,
          appState: body.appState !== undefined ? result.appState : undefined,
          fileIds: result.files.map((file) => file.id),
        },
        typeof body.connectionId === "string" ? body.connectionId : null,
      );
    }
    return { version: result.version, accepted: result.accepted.length };
  };

  router.put("/api/v1/scenes/:sceneId", (req) => saveContent(req, true));
  router.post("/api/v1/scenes/:sceneId/sync", (req) => saveContent(req, false));

  router.get("/api/v1/scenes/:sceneId/files", (req) => {
    const user = getUser(db, req);
    loadSceneForRole(db, req, user, req.params.sceneId, "viewer");
    const ids = req.query.get("ids")?.split(",").filter(Boolean);
    const files = getSceneFiles(db, req.params.sceneId);
    return {
      files: ids
        ? Object.fromEntries(
            ids.filter((id) => files[id]).map((id) => [id, files[id]]),
          )
        : files,
    };
  });

  router.patch("/api/v1/scenes/:sceneId", async (req) => {
    const user = requireUser(db, req);
    const body = await req.body();
    const moving = body.teamId !== undefined || body.folderId !== undefined;
    const { scene, role } = loadSceneForRole(
      db,
      req,
      user,
      req.params.sceneId,
      moving ? "owner" : "editor",
    );
    if (body.name !== undefined) {
      run(
        db,
        "UPDATE scenes SET name = ?, updated_at = ? WHERE id = ?",
        requireString(body.name, "name", { max: 200 }),
        now(),
        scene.id,
      );
    }
    if (body.presentation !== undefined) {
      if (
        !Array.isArray(body.presentation) ||
        body.presentation.some((id: unknown) => typeof id !== "string")
      ) {
        throw badRequest('"presentation" must be a list of frame ids');
      }
      run(
        db,
        "UPDATE scenes SET presentation = ? WHERE id = ?",
        JSON.stringify(body.presentation),
        scene.id,
      );
    }
    if (moving) {
      const location = resolveLocation(
        ctx,
        user,
        body.teamId !== undefined ? body.teamId : scene.team_id,
        body.folderId !== undefined ? body.folderId : null,
      );
      run(
        db,
        "UPDATE scenes SET team_id = ?, folder_id = ? WHERE id = ?",
        location.teamId,
        location.folderId,
        scene.id,
      );
    }
    const updated = get<any>(db, "SELECT * FROM scenes WHERE id = ?", scene.id);
    hub.broadcast(sceneChannel(scene.id), "scene-meta", {
      name: updated.name,
      presentation: JSON.parse(updated.presentation),
    });
    return { scene: sceneSummary(updated, role) };
  });

  router.post("/api/v1/scenes/:sceneId/duplicate", async (req) => {
    const user = requireUser(db, req);
    const { scene } = loadSceneForRole(
      db,
      req,
      user,
      req.params.sceneId,
      "viewer",
    );
    const body = await req.body();
    const location = resolveLocation(ctx, user, body.teamId, body.folderId);
    const copy = createScene(db, user, {
      name: requireString(body.name ?? `${scene.name} (copy)`, "name", {
        max: 200,
      }),
      ...location,
      elements: JSON.parse(scene.elements),
      appState: JSON.parse(scene.app_state),
      files: getSceneFiles(db, scene.id),
    });
    return { scene: sceneSummary(copy, "owner") };
  });

  router.delete("/api/v1/scenes/:sceneId", (req) => {
    const user = requireUser(db, req);
    const { scene } = loadSceneForRole(
      db,
      req,
      user,
      req.params.sceneId,
      "owner",
    );
    run(db, "DELETE FROM scenes WHERE id = ?", scene.id);
    hub.closeChannel(sceneChannel(scene.id));
    return { ok: true };
  });

  // access management ----------------------------------------------------------

  /** Who can open a scene; every access endpoint answers with this. */
  const accessList = (sceneId: string) => {
    const scene = get<SceneRow>(
      db,
      "SELECT * FROM scenes WHERE id = ?",
      sceneId,
    )!;
    const owner = get<{ id: string; name: string; email: string }>(
      db,
      "SELECT id, name, email FROM users WHERE id = ?",
      scene.owner_id,
    )!;
    return {
      owner: { userId: owner.id, name: owner.name, email: owner.email },
      teamId: scene.team_id,
      collaborators: all<any>(
        db,
        `SELECT users.id, users.name, users.email, scene_access.role FROM scene_access
         JOIN users ON users.id = scene_access.user_id WHERE scene_access.scene_id = ?
         ORDER BY users.name`,
        sceneId,
      ).map((row) => ({
        userId: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
      })),
      links: all<any>(
        db,
        "SELECT token, role, created_at FROM share_links WHERE scene_id = ? ORDER BY created_at",
        sceneId,
      ).map((link) => shareLinkJSON(ctx, link)),
    };
  };

  router.get("/api/v1/scenes/:sceneId/access", (req) => {
    const user = requireUser(db, req);
    const { scene } = loadSceneForRole(
      db,
      req,
      user,
      req.params.sceneId,
      "owner",
    );
    return accessList(scene.id);
  });

  router.post("/api/v1/scenes/:sceneId/access", async (req) => {
    const user = requireUser(db, req);
    const { scene } = loadSceneForRole(
      db,
      req,
      user,
      req.params.sceneId,
      "owner",
    );
    const body = await req.body();
    const email = requireString(body.email, "email", { max: 254 });
    const role = requireOneOf(body.role ?? "editor", "role", [
      "editor",
      "viewer",
    ] as const);
    const invitee = get<{ id: string }>(
      db,
      "SELECT id FROM users WHERE email = ?",
      email,
    );
    if (!invitee) {
      throw notFound(
        "No account uses this email. Ask them to sign up first, or share a link instead.",
      );
    }
    if (invitee.id === scene.owner_id) {
      throw badRequest("That's the scene owner");
    }
    run(
      db,
      `INSERT INTO scene_access (scene_id, user_id, role) VALUES (?, ?, ?)
       ON CONFLICT (scene_id, user_id) DO UPDATE SET role = excluded.role`,
      scene.id,
      invitee.id,
      role,
    );
    return accessList(scene.id);
  });

  router.delete("/api/v1/scenes/:sceneId/access/:userId", (req) => {
    const user = requireUser(db, req);
    const { scene } = loadSceneForRole(
      db,
      req,
      user,
      req.params.sceneId,
      "owner",
    );
    run(
      db,
      "DELETE FROM scene_access WHERE scene_id = ? AND user_id = ?",
      scene.id,
      req.params.userId,
    );
    return accessList(scene.id);
  });

  router.post("/api/v1/scenes/:sceneId/links", async (req) => {
    const user = requireUser(db, req);
    const { scene } = loadSceneForRole(
      db,
      req,
      user,
      req.params.sceneId,
      "owner",
    );
    const body = await req.body();
    const role = requireOneOf(body.role ?? "viewer", "role", [
      "editor",
      "viewer",
    ] as const);
    run(
      db,
      "INSERT INTO share_links (token, scene_id, role, created_by, created_at) VALUES (?, ?, ?, ?, ?)",
      newId(18),
      scene.id,
      role,
      user.id,
      now(),
    );
    return accessList(scene.id);
  });

  router.delete("/api/v1/scenes/:sceneId/links/:token", (req) => {
    const user = requireUser(db, req);
    const { scene } = loadSceneForRole(
      db,
      req,
      user,
      req.params.sceneId,
      "owner",
    );
    run(
      db,
      "DELETE FROM share_links WHERE scene_id = ? AND token = ?",
      scene.id,
      req.params.token,
    );
    return accessList(scene.id);
  });

  /** Resolves a share link to its scene; public, the token is the secret. */
  router.get("/api/v1/share/:token", (req) => {
    const link = get<{ scene_id: string; role: string }>(
      db,
      "SELECT scene_id, role FROM share_links WHERE token = ?",
      req.params.token,
    );
    if (!link) {
      throw notFound("This link doesn't exist or was revoked");
    }
    return { sceneId: link.scene_id, role: link.role };
  });

  // folders --------------------------------------------------------------------

  router.get("/api/v1/folders", (req) => {
    const user = requireUser(db, req);
    const teamId = req.query.get("teamId");
    if (teamId) {
      requireTeamRole(db, teamId, user);
    }
    const folders = teamId
      ? all<FolderRow>(
          db,
          "SELECT * FROM folders WHERE team_id = ? ORDER BY name",
          teamId,
        )
      : all<FolderRow>(
          db,
          "SELECT * FROM folders WHERE owner_id = ? AND team_id IS NULL ORDER BY name",
          user.id,
        );
    return { folders: folders.map(folderJSON) };
  });

  router.post("/api/v1/folders", async (req) => {
    const user = requireUser(db, req);
    const body = await req.body();
    const { teamId, folderId: parentId } = resolveLocation(
      ctx,
      user,
      body.teamId,
      body.parentId,
    );
    const id = newId();
    run(
      db,
      "INSERT INTO folders (id, owner_id, team_id, parent_id, name, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      id,
      user.id,
      teamId,
      parentId,
      requireString(body.name, "name", { max: 100 }),
      now(),
    );
    return {
      folder: folderJSON(
        get<FolderRow>(db, "SELECT * FROM folders WHERE id = ?", id)!,
      ),
    };
  });

  router.patch("/api/v1/folders/:folderId", async (req) => {
    const user = requireUser(db, req);
    const folder = loadFolder(db, user, req.params.folderId);
    const body = await req.body();
    if (body.name !== undefined) {
      run(
        db,
        "UPDATE folders SET name = ? WHERE id = ?",
        requireString(body.name, "name", { max: 100 }),
        folder.id,
      );
    }
    if (body.parentId !== undefined) {
      const parentId = optionalString(body.parentId, "parentId");
      if (parentId) {
        const parent = loadFolder(db, user, parentId);
        if (parent.team_id !== folder.team_id) {
          throw badRequest("The folder belongs to a different workspace");
        }
        // walk up from the new parent: it can't be the folder or inside it
        let cursor: FolderRow | undefined = parent;
        while (cursor) {
          if (cursor.id === folder.id) {
            throw badRequest("A folder can't be moved inside itself");
          }
          cursor = cursor.parent_id
            ? get<FolderRow>(
                db,
                "SELECT * FROM folders WHERE id = ?",
                cursor.parent_id,
              )
            : undefined;
        }
      }
      run(
        db,
        "UPDATE folders SET parent_id = ? WHERE id = ?",
        parentId,
        folder.id,
      );
    }
    return {
      folder: folderJSON(
        get<FolderRow>(db, "SELECT * FROM folders WHERE id = ?", folder.id)!,
      ),
    };
  });

  router.delete("/api/v1/folders/:folderId", (req) => {
    const user = requireUser(db, req);
    const folder = loadFolder(db, user, req.params.folderId);
    if (folder.team_id && folder.owner_id !== user.id) {
      requireTeamRole(db, folder.team_id, user, "admin");
    }
    // scenes in it (and in sub-folders) move to the workspace root
    run(db, "DELETE FROM folders WHERE id = ?", folder.id);
    return { ok: true };
  });

  // comments -------------------------------------------------------------------

  /**
   * Keeps the mentions that name someone with access and still appear in the
   * text as "@Name"; anything else a client sends is dropped.
   */
  const resolveMentions = (
    scene: SceneRow,
    mentions: unknown,
    text: string,
  ) => {
    if (!Array.isArray(mentions)) {
      return [];
    }
    const people = new Map(
      getScenePeople(db, scene).map((person) => [person.userId, person]),
    );
    const seen = new Set<string>();
    const result: { userId: string; name: string }[] = [];
    for (const mention of mentions) {
      const person = people.get(mention?.userId);
      if (
        person &&
        !seen.has(person.userId) &&
        text.includes(`@${person.name}`)
      ) {
        seen.add(person.userId);
        result.push({ userId: person.userId, name: person.name });
      }
    }
    return result;
  };

  router.get("/api/v1/scenes/:sceneId/people", (req) => {
    const user = requireUser(db, req);
    const { scene } = loadSceneForRole(
      db,
      req,
      user,
      req.params.sceneId,
      "viewer",
    );
    return { people: getScenePeople(db, scene) };
  });

  /** Comments that mention the caller, newest first, with an unread count. */
  router.get("/api/v1/me/mentions", (req) => {
    const user = requireUser(db, req);
    const rows = all<CommentRow & { scene_name: string; seen_at: number }>(
      db,
      `SELECT comments.*, users.name AS author_name, scenes.name AS scene_name
       FROM comments
       JOIN users ON users.id = comments.author_id
       JOIN scenes ON scenes.id = comments.scene_id
       WHERE comments.mentions LIKE ? ESCAPE '\\'
       ORDER BY comments.created_at DESC LIMIT 100`,
      `%"userId":"${user.id.replace(/[\\%_]/g, (c) => `\\${c}`)}"%`,
    );
    const seenAt =
      get<{ mentions_seen_at: number }>(
        db,
        "SELECT mentions_seen_at FROM users WHERE id = ?",
        user.id,
      )?.mentions_seen_at ?? 0;
    // drop mentions in scenes the user can no longer open
    const visible = rows.filter((row) => {
      const scene = get<SceneRow>(
        db,
        "SELECT * FROM scenes WHERE id = ?",
        row.scene_id,
      );
      return !!scene && !!resolveSceneRole(db, scene, user, null);
    });
    return {
      unread: visible.filter(
        (row) => row.created_at > seenAt && row.author_id !== user.id,
      ).length,
      mentions: visible.map((row) => ({
        ...commentJSON(row),
        sceneName: row.scene_name,
        unread: row.created_at > seenAt,
      })),
    };
  });

  router.post("/api/v1/me/mentions/seen", (req) => {
    const user = requireUser(db, req);
    run(
      db,
      "UPDATE users SET mentions_seen_at = ? WHERE id = ?",
      now(),
      user.id,
    );
    return { ok: true };
  });

  router.get("/api/v1/scenes/:sceneId/comments", (req) => {
    const user = getUser(db, req);
    const { scene } = loadSceneForRole(
      db,
      req,
      user,
      req.params.sceneId,
      "viewer",
    );
    return {
      comments: all<CommentRow>(
        db,
        `SELECT comments.*, users.name AS author_name FROM comments
         JOIN users ON users.id = comments.author_id
         WHERE comments.scene_id = ? ORDER BY comments.created_at`,
        scene.id,
      ).map(commentJSON),
    };
  });

  router.post("/api/v1/scenes/:sceneId/comments", async (req) => {
    const user = requireUser(db, req);
    const { scene } = loadSceneForRole(
      db,
      req,
      user,
      req.params.sceneId,
      "viewer",
    );
    const body = await req.body();
    const parentId = optionalString(body.parentId, "parentId");
    if (parentId) {
      const parent = loadComment(ctx, parentId);
      if (parent.scene_id !== scene.id || parent.parent_id) {
        throw badRequest(
          "Replies must target a top-level comment of this scene",
        );
      }
    }
    const text = requireString(body.body, "body", { max: 5000 });
    const mentions = resolveMentions(scene, body.mentions, text);
    const id = newId();
    const timestamp = now();
    run(
      db,
      `INSERT INTO comments (id, scene_id, parent_id, author_id, element_id, x, y, body, mentions, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      scene.id,
      parentId,
      user.id,
      optionalString(body.elementId, "elementId"),
      typeof body.x === "number" ? body.x : null,
      typeof body.y === "number" ? body.y : null,
      text,
      JSON.stringify(mentions),
      timestamp,
      timestamp,
    );
    const comment = commentJSON(loadComment(ctx, id));
    hub.broadcast(sceneChannel(scene.id), "comment", {
      action: "upsert",
      comment,
    });
    return { comment };
  });

  router.patch("/api/v1/comments/:commentId", async (req) => {
    const user = requireUser(db, req);
    const comment = loadComment(ctx, req.params.commentId);
    const { role } = loadSceneForRole(
      db,
      req,
      user,
      comment.scene_id,
      "viewer",
    );
    const body = await req.body();
    if (body.body !== undefined) {
      if (comment.author_id !== user.id) {
        throw forbidden("Only the author can edit a comment");
      }
      const text = requireString(body.body, "body", { max: 5000 });
      const scene = get<SceneRow>(
        db,
        "SELECT * FROM scenes WHERE id = ?",
        comment.scene_id,
      )!;
      run(
        db,
        "UPDATE comments SET body = ?, mentions = ?, updated_at = ? WHERE id = ?",
        text,
        JSON.stringify(
          resolveMentions(
            scene,
            body.mentions ?? JSON.parse(comment.mentions || "[]"),
            text,
          ),
        ),
        now(),
        comment.id,
      );
    }
    if (body.resolved !== undefined) {
      if (comment.author_id !== user.id && !roleAtLeast(role, "editor")) {
        throw forbidden("Only editors can resolve comments");
      }
      run(
        db,
        "UPDATE comments SET resolved = ?, updated_at = ? WHERE id = ?",
        body.resolved ? 1 : 0,
        now(),
        comment.id,
      );
    }
    const updated = commentJSON(loadComment(ctx, comment.id));
    hub.broadcast(sceneChannel(comment.scene_id), "comment", {
      action: "upsert",
      comment: updated,
    });
    return { comment: updated };
  });

  router.delete("/api/v1/comments/:commentId", (req) => {
    const user = requireUser(db, req);
    const comment = loadComment(ctx, req.params.commentId);
    const { role } = loadSceneForRole(
      db,
      req,
      user,
      comment.scene_id,
      "viewer",
    );
    if (comment.author_id !== user.id && role !== "owner") {
      throw forbidden(
        "Only the author or the scene owner can delete a comment",
      );
    }
    run(db, "DELETE FROM comments WHERE id = ?", comment.id);
    hub.broadcast(sceneChannel(comment.scene_id), "comment", {
      action: "delete",
      commentId: comment.id,
    });
    return { ok: true };
  });

  // realtime -------------------------------------------------------------------

  router.get("/api/v1/scenes/:sceneId/events", (req, res) => {
    const user = getUser(db, req);
    const { scene } = loadSceneForRole(
      db,
      req,
      user,
      req.params.sceneId,
      "viewer",
    );
    const name =
      user?.name ||
      (req.query.get("name") || "").trim().slice(0, 50) ||
      "Guest";
    hub.connect(sceneChannel(scene.id), res, { id: user?.id ?? null, name });
  });

  /**
   * Relays hangout / screen-share signaling between peers on a scene. Offers,
   * answers and ICE candidates go to one peer; the rest is broadcast.
   */
  router.post("/api/v1/scenes/:sceneId/signal", async (req) => {
    const user = getUser(db, req);
    const { scene } = loadSceneForRole(
      db,
      req,
      user,
      req.params.sceneId,
      "viewer",
    );
    const body = await req.body();
    const channel = sceneChannel(scene.id);
    const from = hub.get(channel, requireString(body.from, "from"));
    if (!from || (from.userId && from.userId !== user?.id)) {
      throw forbidden("Unknown connection");
    }
    const type = requireOneOf(body.type, "type", [
      ...TARGETED_SIGNALS,
      ...BROADCAST_SIGNALS,
    ]);
    const message = { type, from: from.id, data: body.data ?? null };

    if ((TARGETED_SIGNALS as readonly string[]).includes(type)) {
      const to = hub.get(channel, requireString(body.to, "to"));
      if (!to) {
        throw notFound("That participant left");
      }
      hub.send(to, "signal", message);
      return { ok: true };
    }

    // the id of the media stream a camera / screen track travels in, so
    // receivers can tell the two video tracks apart
    const streamId =
      typeof body.data?.streamId === "string" &&
      body.data.streamId.length <= 100
        ? (body.data.streamId as string)
        : null;

    if (type === "chat") {
      // chat belongs to the talk: only people who joined it can send or see it
      if (!from.inHangout) {
        throw forbidden("Join the talk to chat");
      }
      const text = requireString(body.data?.text, "text", { max: 1000 });
      hub.broadcastToHangout(channel, "signal", {
        type: "chat",
        from: from.id,
        // the server vouches for the name and the time
        data: { id: newId(8), name: from.name, text, at: now() },
      });
      return { ok: true };
    }

    if (type === "hangout-join" || type === "hangout-leave") {
      from.inHangout = type === "hangout-join";
      if (!from.inHangout) {
        from.sharingScreen = false;
        from.cameraOn = false;
        from.cameraStreamId = null;
        from.screenStreamId = null;
      }
      hub.broadcastPresence(channel);
    } else if (type === "screen-share-start" || type === "screen-share-stop") {
      from.sharingScreen = type === "screen-share-start";
      from.screenStreamId = from.sharingScreen ? streamId : null;
      hub.broadcastPresence(channel);
    } else if (type === "camera-start" || type === "camera-stop") {
      from.cameraOn = type === "camera-start" && from.inHangout;
      from.cameraStreamId = from.cameraOn ? streamId : null;
      hub.broadcastPresence(channel);
    }
    hub.broadcast(channel, "signal", message, from.id);
    return { ok: true };
  });
};
