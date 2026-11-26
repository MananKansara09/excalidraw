import { loadSceneForRole, requireTeamRole } from "./access.ts";
import { requireUser } from "./auth.ts";
import { all, get, newId, now, run } from "./db.ts";
import { describeElements, expandSimpleElements } from "./elements.ts";
import { badRequest, HttpError, requireOneOf, sendJSON } from "./http.ts";
import {
  createScene,
  listScenes,
  sceneSummary,
  updateSceneContent,
} from "./scenes.ts";

import type { AppContext } from "./context.ts";
import type { Request, Router } from "./http.ts";
import type { User } from "./auth.ts";
import type { SceneElement } from "./scenes.ts";

const SUPPORTED_PROTOCOL_VERSIONS = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
];

const SIMPLE_ELEMENT_SCHEMA = {
  type: "object",
  properties: {
    id: {
      type: "string",
      description: "Optional id, so arrows in the same call can reference it",
    },
    type: {
      type: "string",
      enum: [
        "rectangle",
        "ellipse",
        "diamond",
        "text",
        "arrow",
        "line",
        "frame",
      ],
    },
    x: { type: "number" },
    y: { type: "number" },
    width: { type: "number" },
    height: { type: "number" },
    label: {
      type: "string",
      description: "Text shown inside a shape or on an arrow",
    },
    text: { type: "string", description: "Content of a text element" },
    name: { type: "string", description: "Frame title (frames are slides)" },
    strokeColor: { type: "string", description: "CSS color, e.g. #1971c2" },
    backgroundColor: { type: "string", description: "CSS color fill" },
    fontSize: { type: "number" },
    start: { type: "string", description: "Arrow: id of the shape it leaves" },
    end: { type: "string", description: "Arrow: id of the shape it points to" },
    points: {
      type: "array",
      items: { type: "array", items: { type: "number" } },
      description:
        "Arrow/line points relative to x,y when not connecting shapes",
    },
  },
  required: ["type"],
};

type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly?: boolean;
  run: (args: any, user: User, req: Request) => unknown;
};

const sceneChannel = (sceneId: string) => `scene:${sceneId}`;

const buildTools = (ctx: AppContext): Tool[] => {
  const { db, hub } = ctx;

  const applyElements = (sceneId: string, elements: SceneElement[]) => {
    const result = updateSceneContent(db, sceneId, { elements });
    if (result.changed) {
      hub.broadcast(sceneChannel(sceneId), "scene-update", {
        version: result.version,
        elements: result.accepted,
        fileIds: [],
      });
    }
    return result;
  };

  return [
    {
      name: "list_teams",
      description: "List the teams you belong to, with your role in each.",
      inputSchema: { type: "object", properties: {} },
      readOnly: true,
      run: (_args, user) =>
        all<any>(
          db,
          `SELECT teams.id, teams.name, team_members.role FROM teams
           JOIN team_members ON team_members.team_id = teams.id
           WHERE team_members.user_id = ? ORDER BY teams.name`,
          user.id,
        ),
    },
    {
      name: "list_folders",
      description:
        "List folders in your personal workspace, or in a team's workspace when teamId is given.",
      inputSchema: {
        type: "object",
        properties: { teamId: { type: "string" } },
      },
      readOnly: true,
      run: (args, user) => {
        if (args.teamId) {
          requireTeamRole(db, args.teamId, user);
          return all(
            db,
            "SELECT id, name, parent_id AS parentId FROM folders WHERE team_id = ?",
            args.teamId,
          );
        }
        return all(
          db,
          "SELECT id, name, parent_id AS parentId FROM folders WHERE owner_id = ? AND team_id IS NULL",
          user.id,
        );
      },
    },
    {
      name: "list_scenes",
      description:
        "List scenes (drawings) you can access: personal, a team's (teamId), or all of them. Optionally filter by name.",
      inputSchema: {
        type: "object",
        properties: {
          teamId: { type: "string" },
          scope: {
            type: "string",
            enum: ["personal", "team", "shared", "all"],
          },
          query: { type: "string", description: "Substring of the scene name" },
        },
      },
      readOnly: true,
      run: (args, user) => {
        if (args.teamId) {
          requireTeamRole(db, args.teamId, user);
        }
        return listScenes(db, user, {
          teamId: args.teamId ?? null,
          scope: args.scope ?? (args.teamId ? "team" : "all"),
          q: args.query ?? null,
        }).map((scene) => sceneSummary(scene));
      },
    },
    {
      name: "get_scene",
      description:
        "Read a scene: its name and a digest of every element (id, type, position, size, label, arrow connections). Label text elements are folded into their shape.",
      inputSchema: {
        type: "object",
        properties: { sceneId: { type: "string" } },
        required: ["sceneId"],
      },
      readOnly: true,
      run: (args, user, req) => {
        const { scene, role } = loadSceneForRole(
          db,
          req,
          user,
          String(args.sceneId),
          "viewer",
        );
        return {
          ...sceneSummary(scene, role),
          elements: describeElements(JSON.parse(scene.elements)),
        };
      },
    },
    {
      name: "create_scene",
      description:
        "Create a new scene, optionally in a team or folder and with initial elements. Shapes with a label get the text centered inside; arrows with start/end ids are bound to those shapes. Frames act as presentation slides.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          teamId: { type: "string" },
          folderId: { type: "string" },
          elements: { type: "array", items: SIMPLE_ELEMENT_SCHEMA },
        },
        required: ["name"],
      },
      run: (args, user) => {
        if (args.teamId) {
          requireTeamRole(db, args.teamId, user);
        }
        if (args.folderId) {
          const folder = get<any>(
            db,
            "SELECT * FROM folders WHERE id = ?",
            args.folderId,
          );
          if (
            !folder ||
            (folder.team_id ?? null) !== (args.teamId ?? null) ||
            (!folder.team_id && folder.owner_id !== user.id)
          ) {
            throw badRequest("Folder not found in that workspace");
          }
        }
        const scene = createScene(db, user, {
          name: String(args.name || "Untitled"),
          teamId: args.teamId ?? null,
          folderId: args.folderId ?? null,
          elements: expandSimpleElements(args.elements ?? []),
        });
        return {
          ...sceneSummary(scene, "owner"),
          url: ctx.config.publicUrl
            ? `${ctx.config.publicUrl}/#cloud=${scene.id}`
            : null,
        };
      },
    },
    {
      name: "add_elements",
      description:
        "Add elements to an existing scene. Arrows may connect new shapes (by the ids you give them) or shapes already in the scene.",
      inputSchema: {
        type: "object",
        properties: {
          sceneId: { type: "string" },
          elements: { type: "array", items: SIMPLE_ELEMENT_SCHEMA },
        },
        required: ["sceneId", "elements"],
      },
      run: (args, user, req) => {
        const { scene } = loadSceneForRole(
          db,
          req,
          user,
          String(args.sceneId),
          "editor",
        );
        const created = expandSimpleElements(
          args.elements,
          JSON.parse(scene.elements),
        );
        const result = applyElements(scene.id, created);
        return {
          version: result.version,
          created: created.map((element) => ({
            id: element.id,
            type: element.type,
          })),
        };
      },
    },
    {
      name: "update_elements",
      description:
        "Change properties of existing elements (x, y, width, height, strokeColor, backgroundColor, text for text elements, name for frames). Pass one entry per element with its id.",
      inputSchema: {
        type: "object",
        properties: {
          sceneId: { type: "string" },
          updates: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                x: { type: "number" },
                y: { type: "number" },
                width: { type: "number" },
                height: { type: "number" },
                strokeColor: { type: "string" },
                backgroundColor: { type: "string" },
                text: { type: "string" },
                name: { type: "string" },
              },
              required: ["id"],
            },
          },
        },
        required: ["sceneId", "updates"],
      },
      run: (args, user, req) => {
        const { scene } = loadSceneForRole(
          db,
          req,
          user,
          String(args.sceneId),
          "editor",
        );
        if (!Array.isArray(args.updates)) {
          throw badRequest('"updates" must be an array');
        }
        const elements = new Map(
          (JSON.parse(scene.elements) as SceneElement[]).map((e) => [e.id, e]),
        );
        const allowed = [
          "x",
          "y",
          "width",
          "height",
          "strokeColor",
          "backgroundColor",
          "text",
          "name",
        ];
        const changed: SceneElement[] = [];
        for (const update of args.updates) {
          const element = elements.get(update?.id);
          if (!element || element.isDeleted) {
            throw badRequest(`Element "${update?.id}" not found`);
          }
          const next: SceneElement = { ...element };
          for (const key of allowed) {
            if (update[key] !== undefined) {
              next[key] = update[key];
            }
          }
          if (update.text !== undefined) {
            next.originalText = update.text;
          }
          next.version = (element.version ?? 0) + 1;
          next.versionNonce = Math.floor(Math.random() * 2 ** 31);
          next.updated = now();
          changed.push(next);
        }
        const result = applyElements(scene.id, changed);
        return { version: result.version, updated: changed.length };
      },
    },
    {
      name: "delete_elements",
      description: "Delete elements by id (their bound labels go with them).",
      inputSchema: {
        type: "object",
        properties: {
          sceneId: { type: "string" },
          ids: { type: "array", items: { type: "string" } },
        },
        required: ["sceneId", "ids"],
      },
      run: (args, user, req) => {
        const { scene } = loadSceneForRole(
          db,
          req,
          user,
          String(args.sceneId),
          "editor",
        );
        const ids = new Set<string>(Array.isArray(args.ids) ? args.ids : []);
        const deleted = (JSON.parse(scene.elements) as SceneElement[])
          .filter(
            (element) =>
              !element.isDeleted &&
              (ids.has(element.id) ||
                (typeof element.containerId === "string" &&
                  ids.has(element.containerId))),
          )
          .map((element) => ({
            ...element,
            isDeleted: true,
            version: (element.version ?? 0) + 1,
            updated: now(),
          }));
        const result = applyElements(scene.id, deleted);
        return { version: result.version, deleted: deleted.length };
      },
    },
    {
      name: "list_comments",
      description: "List the comment threads on a scene.",
      inputSchema: {
        type: "object",
        properties: { sceneId: { type: "string" } },
        required: ["sceneId"],
      },
      readOnly: true,
      run: (args, user, req) => {
        const { scene } = loadSceneForRole(
          db,
          req,
          user,
          String(args.sceneId),
          "viewer",
        );
        return all(
          db,
          `SELECT comments.id, comments.parent_id AS parentId, users.name AS author,
             comments.element_id AS elementId, comments.body, comments.resolved, comments.created_at AS createdAt
           FROM comments JOIN users ON users.id = comments.author_id
           WHERE comments.scene_id = ? ORDER BY comments.created_at`,
          scene.id,
        );
      },
    },
    {
      name: "add_comment",
      description:
        "Comment on a scene, optionally pinned to an element, or reply to a thread with parentId.",
      inputSchema: {
        type: "object",
        properties: {
          sceneId: { type: "string" },
          body: { type: "string" },
          elementId: { type: "string" },
          parentId: { type: "string" },
        },
        required: ["sceneId", "body"],
      },
      run: (args, user, req) => {
        const { scene } = loadSceneForRole(
          db,
          req,
          user,
          String(args.sceneId),
          "viewer",
        );
        const body = String(args.body ?? "").trim();
        if (!body) {
          throw badRequest('"body" is required');
        }
        const id = newId();
        run(
          db,
          `INSERT INTO comments (id, scene_id, parent_id, author_id, element_id, body, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          id,
          scene.id,
          args.parentId ?? null,
          user.id,
          args.elementId ?? null,
          body.slice(0, 5000),
          now(),
          now(),
        );
        hub.broadcast(sceneChannel(scene.id), "comment", {
          action: "upsert",
          comment: {
            id,
            sceneId: scene.id,
            parentId: args.parentId ?? null,
            author: { id: user.id, name: user.name },
            elementId: args.elementId ?? null,
            x: null,
            y: null,
            body,
            resolved: false,
            createdAt: now(),
            updatedAt: now(),
          },
        });
        return { id };
      },
    },
    {
      name: "create_share_link",
      description:
        "Create a share link for a scene you own. role 'viewer' gives a read-only link (also usable as an embed); 'editor' lets anyone with the link edit.",
      inputSchema: {
        type: "object",
        properties: {
          sceneId: { type: "string" },
          role: { type: "string", enum: ["viewer", "editor"] },
        },
        required: ["sceneId"],
      },
      run: (args, user, req) => {
        const { scene } = loadSceneForRole(
          db,
          req,
          user,
          String(args.sceneId),
          "owner",
        );
        const role = requireOneOf(args.role ?? "viewer", "role", [
          "viewer",
          "editor",
        ] as const);
        const token = newId(18);
        run(
          db,
          "INSERT INTO share_links (token, scene_id, role, created_by, created_at) VALUES (?, ?, ?, ?, ?)",
          token,
          scene.id,
          role,
          user.id,
          now(),
        );
        const base = ctx.config.publicUrl ?? "";
        return {
          token,
          role,
          url: `${base}/#share=${token}`,
          embedUrl: `${base}/#share=${token}&embed=1`,
        };
      },
    },
  ];
};

type JSONRPCRequest = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: any;
};

const rpcError = (id: JSONRPCRequest["id"], code: number, message: string) => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: { code, message },
});

export const registerMCPRoutes = (router: Router, ctx: AppContext) => {
  const tools = buildTools(ctx);

  const handleMessage = async (
    message: JSONRPCRequest,
    user: User,
    req: Request,
  ) => {
    if (
      !message ||
      message.jsonrpc !== "2.0" ||
      typeof message.method !== "string"
    ) {
      return rpcError(message?.id, -32600, "Invalid request");
    }
    // notifications get no response
    if (message.id === undefined || message.id === null) {
      return null;
    }
    const { id, method, params } = message;
    switch (method) {
      case "initialize": {
        const requested = params?.protocolVersion;
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
              ? requested
              : SUPPORTED_PROTOCOL_VERSIONS[0],
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "excalidraw-plus", version: "0.1.0" },
            instructions:
              "Tools for reading and drawing Excalidraw scenes. Coordinates are canvas pixels; y grows downward. Lay shapes out on a grid (e.g. 200px apart) and connect them with arrows using start/end ids. Frames are presentation slides.",
          },
        };
      }
      case "ping":
        return { jsonrpc: "2.0", id, result: {} };
      case "tools/list":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            tools: tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
              annotations: { readOnlyHint: !!tool.readOnly },
            })),
          },
        };
      case "tools/call": {
        const tool = tools.find((t) => t.name === params?.name);
        if (!tool) {
          return rpcError(id, -32602, `Unknown tool: ${params?.name}`);
        }
        try {
          const result = await tool.run(params?.arguments ?? {}, user, req);
          return {
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                { type: "text", text: JSON.stringify(result, null, 2) },
              ],
              structuredContent:
                result && typeof result === "object" && !Array.isArray(result)
                  ? result
                  : { result },
            },
          };
        } catch (error: any) {
          // tool failures are reported to the model, not as protocol errors
          return {
            jsonrpc: "2.0",
            id,
            result: {
              isError: true,
              content: [
                {
                  type: "text",
                  text:
                    error instanceof HttpError ? error.message : "Tool failed",
                },
              ],
            },
          };
        }
      }
      default:
        return rpcError(id, -32601, `Method not found: ${method}`);
    }
  };

  const handler = async (req: Request, res: any) => {
    let user: User;
    try {
      user = requireUser(ctx.db, req);
    } catch {
      res.setHeader(
        "WWW-Authenticate",
        'Bearer realm="excalidraw-plus", error="invalid_token", error_description="Create an API key in Account settings and send it as a Bearer token"',
      );
      throw new HttpError(401, "API key required");
    }
    const body = await req.body();
    if (Array.isArray(body)) {
      const responses = (
        await Promise.all(body.map((m) => handleMessage(m, user, req)))
      ).filter(Boolean);
      if (!responses.length) {
        res.writeHead(202).end();
        return;
      }
      sendJSON(res, 200, responses);
      return;
    }
    const response = await handleMessage(body, user, req);
    if (!response) {
      res.writeHead(202).end();
      return;
    }
    sendJSON(res, 200, response);
  };

  router.post("/mcp", handler);
  router.post("/api/mcp", handler);
  // this server doesn't push messages, so there's no stream to open
  router.get("/mcp", () => {
    throw new HttpError(405, "Use POST");
  });

  // REST convenience: same element expansion as the MCP tools
  router.post("/api/v1/scenes/:sceneId/elements", async (req) => {
    const user = requireUser(ctx.db, req);
    const body = await req.body();
    const tool = tools.find((t) => t.name === "add_elements")!;
    return tool.run(
      { sceneId: req.params.sceneId, elements: body.elements },
      user,
      req,
    );
  });
  router.get("/api/v1/scenes/:sceneId/summary", (req) => {
    const user = requireUser(ctx.db, req);
    return tools
      .find((t) => t.name === "get_scene")!
      .run({ sceneId: req.params.sceneId }, user, req);
  });
};
