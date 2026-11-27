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
  HttpError,
  notFound,
  optionalString,
  parseCookies,
  requireOneOf,
  requireString,
} from "../http.ts";
import { BROADCAST_SIGNALS, TARGETED_SIGNALS } from "../realtime.ts";
import {
  createScene,
  filesForElements,
  getSceneFiles,
  listScenes,
  sceneDetail,
  sceneSummary,
  slidesView,
  updateSceneContent,
} from "../scenes.ts";

import { acceptWebSocket } from "../websocket.ts";

import {
  createAndPushNotification,
  extractCanvasMentionsFromElements,
} from "./notifications.ts";

import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { AppContext } from "../context.ts";
import type { Request, Router } from "../http.ts";
import type { Connection } from "../realtime.ts";

import type { FolderRow, SceneRole, SceneRow } from "../access.ts";
import type { User } from "../auth.ts";

export const sceneChannel = (sceneId: string) => `scene:${sceneId}`;

const slideIndex = (value: unknown) =>
  typeof value === "number" && Number.isInteger(value) && value >= 0
    ? Math.min(value, 10_000)
    : 0;

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
  author_avatar_url: string | null;
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
  author: {
    id: comment.author_id,
    name: comment.author_name,
    avatarUrl: comment.author_avatar_url ?? null,
  },
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
    `SELECT comments.*, users.name AS author_name, users.avatar_url AS author_avatar_url FROM comments
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
  link: { token: string; role: string; kind: string; created_at: number },
) => ({
  token: link.token,
  role: link.role,
  kind: link.kind,
  createdAt: link.created_at,
  url: ctx.config.publicUrl
    ? `${ctx.config.publicUrl}/#share=${link.token}`
    : null,
});

export const registerSceneRoutes = (router: Router, ctx: AppContext) => {
  const { db, hub } = ctx;

  const notifyTeamOnSceneAssigned = (
    actor: User,
    scene: SceneRow,
    teamId: string,
  ) => {
    const team = get<{ name: string }>(
      db,
      "SELECT name FROM teams WHERE id = ?",
      teamId,
    );
    if (!team) {
      return;
    }
    const members = all<{ user_id: string }>(
      db,
      "SELECT user_id FROM team_members WHERE team_id = ?",
      teamId,
    );
    for (const member of members) {
      createAndPushNotification(ctx, {
        userId: member.user_id,
        actorId: actor.id,
        actorName: actor.name,
        actorAvatarUrl: actor.avatar_url ?? null,
        type: "scene_assigned",
        title: "New team scene",
        message: `${actor.name} shared scene "${scene.name}" in team "${team.name}"`,
        sceneId: scene.id,
        sceneName: scene.name,
        teamId,
        teamName: team.name,
        dedupeKey: `scene-assigned:${scene.id}:${teamId}:${member.user_id}`,
      });
    }
  };

  const notifyCanvasMentionsFromElements = (
    actor: User,
    scene: SceneRow,
    elements: readonly any[],
  ) => {
    const people = getScenePeople(db, scene);
    const hits = extractCanvasMentionsFromElements(elements, people);
    for (const hit of hits) {
      createAndPushNotification(ctx, {
        userId: hit.userId,
        actorId: actor.id,
        actorName: actor.name,
        actorAvatarUrl: actor.avatar_url ?? null,
        type: "canvas_mention",
        title: `Mentioned in ${scene.name}`,
        message: `${actor.name} mentioned you on canvas: "${hit.textSnippet}"`,
        sceneId: scene.id,
        sceneName: scene.name,
        elementId: hit.elementId,
        dedupeKey: `canvas-mention:${scene.id}:${hit.elementId}:${hit.userId}`,
        payload: {
          elementId: hit.elementId,
          textSnippet: hit.textSnippet,
          x: hit.x,
          y: hit.y,
        },
      });
    }
  };

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
    if (scene.team_id) {
      notifyTeamOnSceneAssigned(user, scene, scene.team_id);
    }
    if (Array.isArray(body.elements) && body.elements.length > 0) {
      notifyCanvasMentionsFromElements(user, scene, body.elements);
    }
    return { scene: sceneDetail(db, scene, "owner") };
  });

  router.get("/api/v1/scenes/:sceneId", (req) => {
    const user = getUser(db, req);
    const { scene, role, slidesOnly } = loadSceneForRole(
      db,
      req,
      user,
      req.params.sceneId,
      "viewer",
      { allowSlidesOnly: true },
    );
    return {
      scene: sceneDetail(db, scene, role, {
        includeFiles: req.query.get("files") !== "0",
        slidesOnly,
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
    return applySceneSync(
      ctx,
      scene.id,
      body,
      replace || req.query.get("replace") === "1",
    );
  };

  // thumbnails: a small image the editor renders when it saves. Stored as a
  // data URL, served as the image itself so a card can use it as `<img src>`.
  const THUMBNAIL_RE =
    /^data:(image\/(?:png|webp|jpeg));base64,([A-Za-z0-9+/=]+)$/;
  const MAX_THUMBNAIL_CHARS = 400_000;

  router.put("/api/v1/scenes/:sceneId/thumbnail", async (req) => {
    const user = requireUser(db, req);
    const { scene } = loadSceneForRole(
      db,
      req,
      user,
      req.params.sceneId,
      "editor",
    );
    const body = await req.body();
    const image = body.image;
    if (
      typeof image !== "string" ||
      image.length > MAX_THUMBNAIL_CHARS ||
      !THUMBNAIL_RE.test(image)
    ) {
      throw badRequest(
        '"image" must be a png, webp or jpeg data URL of at most 400 KB',
      );
    }
    // not `updated_at`/`version`: a preview isn't an edit
    run(
      db,
      "UPDATE scenes SET thumbnail = ?, thumbnail_at = ? WHERE id = ?",
      image,
      now(),
      scene.id,
    );
    return { thumbnailAt: now() };
  });

  router.get("/api/v1/scenes/:sceneId/thumbnail", (req, res) => {
    const user = getUser(db, req);
    const { scene } = loadSceneForRole(
      db,
      req,
      user,
      req.params.sceneId,
      "viewer",
    );
    const match = scene.thumbnail ? THUMBNAIL_RE.exec(scene.thumbnail) : null;
    if (!match) {
      throw notFound("No thumbnail");
    }
    const bytes = Buffer.from(match[2], "base64");
    res.writeHead(200, {
      "Content-Type": match[1],
      "Content-Length": bytes.length,
      // the client adds ?v=<thumbnailAt>, so a changed image has a new URL
      "Cache-Control": "private, max-age=86400",
    });
    res.end(bytes);
  });

  router.put("/api/v1/scenes/:sceneId", (req) => saveContent(req, true));
  router.post("/api/v1/scenes/:sceneId/sync", (req) => saveContent(req, false));

  router.get("/api/v1/scenes/:sceneId/files", (req) => {
    const user = getUser(db, req);
    const { scene, slidesOnly } = loadSceneForRole(
      db,
      req,
      user,
      req.params.sceneId,
      "viewer",
      { allowSlidesOnly: true },
    );
    const ids = req.query.get("ids")?.split(",").filter(Boolean);
    let files = getSceneFiles(db, scene.id);
    if (slidesOnly) {
      files = filesForElements(files, slidesView(JSON.parse(scene.elements)));
    }
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
    const updated = get<SceneRow>(
      db,
      "SELECT * FROM scenes WHERE id = ?",
      scene.id,
    )!;
    if (moving && updated.team_id && updated.team_id !== scene.team_id) {
      notifyTeamOnSceneAssigned(user, updated, updated.team_id);
    }
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
    if (scene.thumbnail) {
      run(
        db,
        "UPDATE scenes SET thumbnail = ?, thumbnail_at = ? WHERE id = ?",
        scene.thumbnail,
        scene.thumbnail_at ?? now(),
        copy.id,
      );
      copy.thumbnail = scene.thumbnail;
      copy.thumbnail_at = scene.thumbnail_at ?? null;
    }
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
    const owner = get<{
      id: string;
      name: string;
      email: string;
      avatar_url: string | null;
    }>(
      db,
      "SELECT id, name, email, avatar_url FROM users WHERE id = ?",
      scene.owner_id,
    )!;
    return {
      owner: {
        userId: owner.id,
        name: owner.name,
        email: owner.email,
        avatarUrl: owner.avatar_url ?? null,
      },
      teamId: scene.team_id,
      collaborators: all<any>(
        db,
        `SELECT users.id, users.name, users.email, users.avatar_url, scene_access.role FROM scene_access
         JOIN users ON users.id = scene_access.user_id WHERE scene_access.scene_id = ?
         ORDER BY users.name`,
        sceneId,
      ).map((row) => ({
        userId: row.id,
        name: row.name,
        email: row.email,
        avatarUrl: row.avatar_url ?? null,
        role: row.role,
      })),
      links: all<any>(
        db,
        "SELECT token, role, kind, created_at FROM share_links WHERE scene_id = ? ORDER BY created_at",
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
    createAndPushNotification(ctx, {
      userId: invitee.id,
      actorId: user.id,
      actorName: user.name,
      actorAvatarUrl: user.avatar_url ?? null,
      type: "scene_share",
      title: "Scene shared with you",
      message: `${user.name} added you as ${role} on "${scene.name}"`,
      sceneId: scene.id,
      sceneName: scene.name,
      dedupeKey: `scene-share:${scene.id}:${invitee.id}:${role}:${Math.floor(
        now() / 5000,
      )}`,
      payload: { role },
    });
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
    const kind = requireOneOf(body.kind ?? "full", "kind", [
      "full",
      "presentation",
    ] as const);
    // a presentation link never edits, whatever role was asked for
    const role =
      kind === "presentation"
        ? "viewer"
        : requireOneOf(body.role ?? "viewer", "role", [
            "editor",
            "viewer",
          ] as const);
    run(
      db,
      "INSERT INTO share_links (token, scene_id, role, kind, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      newId(18),
      scene.id,
      role,
      kind,
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
    const link = get<{ scene_id: string; role: string; kind: string }>(
      db,
      "SELECT scene_id, role, kind FROM share_links WHERE token = ?",
      req.params.token,
    );
    if (!link) {
      throw notFound("This link doesn't exist or was revoked");
    }
    return {
      sceneId: link.scene_id,
      role: link.role,
      kind: link.kind,
      live: !!hub.presenter(sceneChannel(link.scene_id)),
    };
  });

  /**
   * Presentations running right now in scenes the caller can open, so they
   * can jump in and watch.
   */
  router.get("/api/v1/presentations/live", (req) => {
    const user = requireUser(db, req);
    const live = hub.presentingChannels();
    if (!live.size) {
      return { presentations: [] };
    }
    return {
      presentations: listScenes(db, user, { scope: "all" }).flatMap((scene) => {
        const entry = live.get(sceneChannel(scene.id));
        if (!entry) {
          return [];
        }
        return [
          {
            sceneId: scene.id,
            name: scene.name,
            presenter: entry.presenter.name,
            slide: entry.presenter.slide,
            viewers: entry.viewers,
            hasPublicLink:
              get(
                db,
                "SELECT 1 AS found FROM share_links WHERE scene_id = ? AND kind = 'presentation'",
                scene.id,
              ) !== undefined,
          },
        ];
      }),
    };
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
   * text as "@Name" (from explicit mentions list OR inline @handle/@name/@email).
   */
  const resolveMentions = (
    scene: SceneRow,
    mentions: unknown,
    text: string,
  ) => {
    const peopleList = getScenePeople(db, scene);
    const people = new Map(peopleList.map((person) => [person.userId, person]));
    const seen = new Set<string>();
    const result: { userId: string; name: string }[] = [];

    if (Array.isArray(mentions)) {
      for (const mention of mentions) {
        const person = people.get(mention?.userId);
        if (
          person &&
          !seen.has(person.userId) &&
          text.toLowerCase().includes(`@${person.name.toLowerCase()}`)
        ) {
          seen.add(person.userId);
          result.push({ userId: person.userId, name: person.name });
        }
      }
    }

    // Also resolve inline @mentions typed directly without picking autocomplete
    const textLower = text.toLowerCase();
    for (const person of peopleList) {
      if (seen.has(person.userId)) {
        continue;
      }
      const handle = person.name
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/[^a-z0-9._-]/g, "");
      const emailLocal = person.email.split("@")[0]?.toLowerCase();
      if (
        textLower.includes(`@${person.name.toLowerCase()}`) ||
        (handle && textLower.includes(`@${handle}`)) ||
        (emailLocal && textLower.includes(`@${emailLocal}`))
      ) {
        seen.add(person.userId);
        result.push({ userId: person.userId, name: person.name });
      }
    }

    return result;
  };

  router.post("/api/v1/scenes/:sceneId/mentions/sync", async (req) => {
    const user = requireUser(db, req);
    const { scene } = loadSceneForRole(
      db,
      req,
      user,
      req.params.sceneId,
      "editor",
    );
    const body = await req.body();
    const people = getScenePeople(db, scene);
    let notified = 0;

    if (Array.isArray(body.elements)) {
      const hits = extractCanvasMentionsFromElements(body.elements, people);
      for (const hit of hits) {
        const created = createAndPushNotification(ctx, {
          userId: hit.userId,
          actorId: user.id,
          actorName: user.name,
          actorAvatarUrl: user.avatar_url ?? null,
          type: "canvas_mention",
          title: `Mentioned in ${scene.name}`,
          message: `${user.name} mentioned you on canvas: "${hit.textSnippet}"`,
          sceneId: scene.id,
          sceneName: scene.name,
          elementId: hit.elementId,
          dedupeKey: `canvas-mention:${scene.id}:${hit.elementId}:${hit.userId}`,
          payload: {
            elementId: hit.elementId,
            textSnippet: hit.textSnippet,
            x: hit.x,
            y: hit.y,
          },
        });
        if (created) {
          notified++;
        }
      }
    }

    if (Array.isArray(body.mentions)) {
      const normalize = (val: string) =>
        val
          .trim()
          .replace(/^@+/, "")
          .toLowerCase()
          .replace(/\s+/g, "_")
          .replace(/[^a-z0-9._-]/g, "");

      for (const item of body.mentions) {
        const elementId = optionalString(item?.elementId, "elementId");
        const target = optionalString(
          item?.recipientNameOrHandle,
          "recipientNameOrHandle",
        );
        const textSnippet =
          typeof item?.textSnippet === "string"
            ? item.textSnippet.slice(0, 140)
            : "";
        if (!elementId || !target) {
          continue;
        }
        const targetNorm = normalize(target);
        const matchedPeople =
          targetNorm === "everyone" || targetNorm === "all"
            ? people
            : people.filter((person) => {
                const handle = normalize(person.name);
                const first = normalize(person.name.split(/\s+/)[0] || "");
                const emailLocal = normalize(person.email.split("@")[0] || "");
                return (
                  person.userId === target ||
                  handle === targetNorm ||
                  first === targetNorm ||
                  emailLocal === targetNorm
                );
              });

        for (const person of matchedPeople) {
          const created = createAndPushNotification(ctx, {
            userId: person.userId,
            actorId: user.id,
            actorName: user.name,
            actorAvatarUrl: user.avatar_url ?? null,
            type: "canvas_mention",
            title: `Mentioned in ${scene.name}`,
            message: `${user.name} mentioned you on canvas: "${textSnippet}"`,
            sceneId: scene.id,
            sceneName: scene.name,
            elementId,
            dedupeKey: `canvas-mention:${scene.id}:${elementId}:${person.userId}`,
            payload: {
              elementId,
              textSnippet,
              x: typeof item.x === "number" ? item.x : undefined,
              y: typeof item.y === "number" ? item.y : undefined,
            },
          });
          if (created) {
            notified++;
          }
        }
      }
    }

    return { ok: true, notified };
  });

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
    const rows = all<
      CommentRow & {
        scene_name: string;
        scene_thumbnail_at: number | null;
        seen_at: number;
      }
    >(
      db,
      `SELECT comments.*, users.name AS author_name, users.avatar_url AS author_avatar_url, scenes.name AS scene_name,
         CASE WHEN scenes.thumbnail IS NOT NULL THEN scenes.thumbnail_at END AS scene_thumbnail_at
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
        sceneThumbnailAt: row.scene_thumbnail_at,
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
        `SELECT comments.*, users.name AS author_name, users.avatar_url AS author_avatar_url FROM comments
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

    const snippet = text.length > 100 ? `${text.slice(0, 100).trim()}…` : text;
    const targetCommentId = parentId ?? id;
    const mentionedIds = new Set<string>();

    for (const mention of mentions) {
      mentionedIds.add(mention.userId);
      createAndPushNotification(ctx, {
        userId: mention.userId,
        actorId: user.id,
        actorName: user.name,
        actorAvatarUrl: user.avatar_url ?? null,
        type: "comment_mention",
        title: `Mentioned in ${scene.name}`,
        message: `${user.name} mentioned you in chat: "${snippet}"`,
        sceneId: scene.id,
        sceneName: scene.name,
        commentId: targetCommentId,
        elementId: comment.elementId,
        dedupeKey: `comment-mention:${id}:${mention.userId}`,
        payload: {
          commentId: targetCommentId,
          elementId: comment.elementId,
          textSnippet: snippet,
        },
      });
    }

    if (parentId) {
      const threadParticipants = all<{ author_id: string }>(
        db,
        `SELECT DISTINCT author_id FROM comments WHERE id = ? OR parent_id = ?`,
        parentId,
        parentId,
      );
      for (const participant of threadParticipants) {
        if (
          participant.author_id !== user.id &&
          !mentionedIds.has(participant.author_id)
        ) {
          createAndPushNotification(ctx, {
            userId: participant.author_id,
            actorId: user.id,
            actorName: user.name,
            actorAvatarUrl: user.avatar_url ?? null,
            type: "comment_reply",
            title: `New reply in ${scene.name}`,
            message: `${user.name} replied on "${scene.name}": "${snippet}"`,
            sceneId: scene.id,
            sceneName: scene.name,
            commentId: targetCommentId,
            elementId: comment.elementId,
            dedupeKey: `comment-reply:${id}:${participant.author_id}`,
            payload: {
              commentId: targetCommentId,
              elementId: comment.elementId,
              textSnippet: snippet,
            },
          });
        }
      }
    }

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
    loadSceneForRole(db, req, user, comment.scene_id, "viewer");
    if (comment.author_id !== user.id) {
      throw forbidden("Only the author can delete a comment");
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
    const { scene, slidesOnly } = loadSceneForRole(
      db,
      req,
      user,
      req.params.sceneId,
      "viewer",
      { allowSlidesOnly: true },
    );
    const name =
      user?.name ||
      (req.query.get("name") || "").trim().slice(0, 50) ||
      "Guest";
    hub.connectSSE(
      sceneChannel(scene.id),
      res,
      { id: user?.id ?? null, name, avatarUrl: user?.avatar_url ?? null },
      { restricted: slidesOnly },
    );
  });

  /**
   * Relays hangout / screen-share signaling between peers on a scene. Offers,
   * answers and ICE candidates go to one peer; the rest is broadcast.
   */
  router.post("/api/v1/scenes/:sceneId/signal", async (req) => {
    const user = getUser(db, req);
    const { scene, role, slidesOnly } = loadSceneForRole(
      db,
      req,
      user,
      req.params.sceneId,
      "viewer",
      { allowSlidesOnly: true },
    );
    const body = await req.body();
    return relaySignal(ctx, scene.id, user?.id ?? null, body, {
      role,
      slidesOnly,
    });
  });
};

/**
 * Merges changed elements into the scene, saves them and tells everyone else
 * on the scene. Shared by the HTTP sync endpoint and the WebSocket channel.
 */
export const applySceneSync = (
  ctx: AppContext,
  sceneId: string,
  body: any,
  replace = false,
) => {
  const result = updateSceneContent(ctx.db, sceneId, {
    elements: body.elements,
    appState: body.appState,
    files: body.files,
    replace,
  });
  if (result.changed) {
    ctx.hub.broadcast(
      sceneChannel(sceneId),
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

/**
 * Relays hangout / screen-share / pointer signaling between peers on a scene.
 * Offers, answers and ICE candidates go to one peer; the rest is broadcast.
 */
export const relaySignal = (
  ctx: AppContext,
  sceneId: string,
  userId: string | null,
  body: any,
  access: { role: SceneRole; slidesOnly: boolean },
) => {
  const { hub } = ctx;
  const channel = sceneChannel(sceneId);
  const from = hub.get(channel, requireString(body.from, "from"));
  if (!from || (from.userId && from.userId !== userId)) {
    throw forbidden("Unknown connection");
  }
  const type = requireOneOf(body.type, "type", [
    ...TARGETED_SIGNALS,
    ...BROADCAST_SIGNALS,
  ]);
  const message = { type, from: from.id, data: body.data ?? null };

  // only people who can edit run a presentation; everyone else follows
  if (
    type === "presentation-start" &&
    (access.slidesOnly || access.role === "viewer")
  ) {
    throw forbidden("You have view-only access to this scene");
  }
  if (type === "presentation-start") {
    const current = hub.presenter(channel);
    if (current && current.id !== from.id) {
      throw badRequest(`${current.name} is already presenting`);
    }
  }

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
    typeof body.data?.streamId === "string" && body.data.streamId.length <= 100
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
  } else if (type === "presentation-start" || type === "presentation-stop") {
    from.presenting = type === "presentation-start";
    from.slide = from.presenting ? slideIndex(body.data?.index) : 0;
    hub.broadcastPresence(channel);
  } else if (type === "follow-slide") {
    // only the running presentation's presenter moves everyone's slide
    if (!from.presenting) {
      throw forbidden("You aren't presenting");
    }
    from.slide = slideIndex(body.data?.index);
    message.data = { index: from.slide };
  }
  hub.broadcast(channel, "signal", message, from.id);
  return { ok: true };
};

const SOCKET_PATH = /^\/api\/v1\/scenes\/([^/]+)\/ws\/?$/;

const rejectUpgrade = (socket: Duplex, status: number, message: string) => {
  const body = JSON.stringify({ statusCode: status, message });
  socket.end(
    `HTTP/1.1 ${status} ${message.replace(/[^\w .,'-]/g, "")}\r\n` +
      `Content-Type: application/json\r\nContent-Length: ${Buffer.byteLength(
        body,
      )}\r\nConnection: close\r\n\r\n${body}`,
  );
};

/**
 * `GET /api/v1/scenes/:id/ws` (WebSocket upgrade): the low-latency twin of the
 * SSE `events` stream. Server → client frames are `{ event, data }` exactly
 * like the SSE events. Client → server frames:
 *
 *   { type: "sync", id, elements?, appState?, files? }  → { event: "sync-ack" | "sync-error", data: { id, ... } }
 *   { type: "signal", signal, to?, data? }               (pointers, hangouts, WebRTC)
 *   { type: "ping" }                                      → { event: "pong" }
 *
 * Returns false when the path isn't a scene socket.
 */
export const handleSceneSocket = (
  ctx: AppContext,
  raw: IncomingMessage,
  socket: Duplex,
  head: Buffer,
) => {
  const url = new URL(raw.url || "/", "http://localhost");
  const match = SOCKET_PATH.exec(url.pathname);
  if (!match) {
    return false;
  }
  const { db, hub } = ctx;
  const sceneId = decodeURIComponent(match[1]);
  const req: Request = {
    raw,
    method: "GET",
    path: url.pathname,
    query: url.searchParams,
    params: { sceneId },
    headers: raw.headers,
    cookies: parseCookies(raw.headers.cookie),
    ip: raw.socket.remoteAddress || "unknown",
    body: async () => ({}),
  };

  let user;
  let slidesOnly = false;
  try {
    user = getUser(db, req);
    ({ slidesOnly } = loadSceneForRole(db, req, user, sceneId, "viewer", {
      allowSlidesOnly: true,
    }));
  } catch (error) {
    if (error instanceof HttpError) {
      rejectUpgrade(socket, error.status, error.message);
    } else {
      console.error(error);
      rejectUpgrade(socket, 500, "Internal server error");
    }
    return true;
  }

  const ws = acceptWebSocket(raw, socket, head);
  if (!ws) {
    return true;
  }
  const name =
    user?.name ||
    (url.searchParams.get("name") || "").trim().slice(0, 50) ||
    "Guest";
  const connection: Connection = hub.connectWebSocket(
    sceneChannel(sceneId),
    ws,
    { id: user?.id ?? null, name, avatarUrl: user?.avatar_url ?? null },
    { restricted: slidesOnly },
  );

  const reply = (event: string, data: unknown) =>
    hub.send(connection, event, data);

  ws.onMessage((text) => {
    let message: any;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (!message || typeof message !== "object") {
      return;
    }
    // access is re-checked per message: roles and sessions can change while
    // a socket stays open
    const current = getUserSafe(ctx, req);
    try {
      if (message.type === "sync") {
        loadSceneForRole(db, req, current, sceneId, "editor");
        const result = applySceneSync(ctx, sceneId, {
          elements: message.elements,
          appState: message.appState,
          files: message.files,
          connectionId: connection.id,
        });
        reply("sync-ack", { id: message.id, ...result });
      } else if (message.type === "signal") {
        const access = loadSceneForRole(db, req, current, sceneId, "viewer", {
          allowSlidesOnly: true,
        });
        relaySignal(
          ctx,
          sceneId,
          current?.id ?? null,
          {
            from: connection.id,
            to: message.to,
            type: message.signal,
            data: message.data,
          },
          access,
        );
      } else if (message.type === "ping") {
        reply("pong", { t: message.t ?? null });
      }
    } catch (error: any) {
      if (message.type === "sync") {
        reply("sync-error", {
          id: message.id,
          status: error instanceof HttpError ? error.status : 500,
          message:
            error instanceof HttpError
              ? error.message
              : "Couldn't save changes",
        });
      } else if (!(error instanceof HttpError)) {
        console.error(error);
      }
    }
  });
  return true;
};

const getUserSafe = (ctx: AppContext, req: Request) => {
  try {
    return getUser(ctx.db, req);
  } catch {
    return null;
  }
};
