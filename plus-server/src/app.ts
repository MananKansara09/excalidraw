import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";

import { registerAIRoutes } from "./ai.ts";
import { handleClaudeBridge } from "./claudeBridge.ts";
import { createSecretBox, getUser } from "./auth.ts";
import { Router, sendJSON } from "./http.ts";
import { registerMCPRoutes } from "./mcp.ts";
import { RealtimeHub } from "./realtime.ts";
import { registerAuthRoutes } from "./routes/auth.ts";
import {
  handleNotificationSocket,
  registerNotificationRoutes,
} from "./routes/notifications.ts";
import { handleSceneSocket, registerSceneRoutes } from "./routes/scenes.ts";
import { registerTeamRoutes } from "./routes/teams.ts";

import type { IncomingMessage, ServerResponse } from "node:http";
import type { AIProvider } from "./ai.ts";
import type { AppContext, ServerConfig } from "./context.ts";
import type { DB } from "./db.ts";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
};

const API_INDEX = {
  name: "Excalidraw Plus API",
  version: "v1",
  auth: "Send `Authorization: Bearer <api key>` (create keys in Profile settings), or use the web session cookie.",
  endpoints: [
    "POST /api/v1/auth/signup | /login | /logout",
    "GET|PATCH /api/v1/me",
    "GET|POST /api/v1/me/api-keys, DELETE /api/v1/me/api-keys/:id",
    "GET|POST /api/v1/teams, GET|PATCH|DELETE /api/v1/teams/:id",
    "POST /api/v1/teams/:id/invites, DELETE /api/v1/teams/:id/invites/:inviteId",
    "PATCH|DELETE /api/v1/teams/:id/members/:userId",
    "GET|POST /api/v1/folders, PATCH|DELETE /api/v1/folders/:id",
    "GET|POST /api/v1/scenes (?scope=personal|team|shared|all&teamId=&folderId=&q=)",
    "GET|PUT|PATCH|DELETE /api/v1/scenes/:id",
    "POST /api/v1/scenes/:id/sync (merge changed elements)",
    "POST /api/v1/scenes/:id/elements (simple element descriptions)",
    "GET /api/v1/scenes/:id/summary",
    "POST /api/v1/scenes/:id/duplicate",
    "GET|POST /api/v1/scenes/:id/access, DELETE /api/v1/scenes/:id/access/:userId",
    "POST /api/v1/scenes/:id/links, DELETE /api/v1/scenes/:id/links/:token",
    "GET|POST /api/v1/scenes/:id/comments, PATCH|DELETE /api/v1/comments/:id",
    "GET /api/v1/scenes/:id/ws (WebSocket: live edits, presence, pointers, signaling)",
    "GET /api/v1/scenes/:id/events (Server-Sent Events, fallback)",
    "GET|DELETE /api/v1/notifications, POST /api/v1/notifications/:id/read | /read-all",
    "GET /api/v1/notifications/events (SSE) | /ws (WebSocket)",
    "GET /api/v1/ai/usage",
    "POST /api/v1/ai/text-to-diagram/chat-streaming",
    "POST /api/v1/ai/diagram-to-code/generate-streaming",
    "POST /mcp (Model Context Protocol, Streamable HTTP)",
  ],
};

export type CreateAppOptions = {
  db: DB;
  secret: string;
  config: ServerConfig;
  ai: AIProvider;
  staticDir?: string | null;
};

export const createApp = (options: CreateAppOptions) => {
  const hub = new RealtimeHub();
  const ctx: AppContext = {
    db: options.db,
    hub,
    secrets: createSecretBox(options.secret),
    config: options.config,
    ai: options.ai,
  };

  const router = new Router();
  router.get("/api/health", () => ({ ok: true }));
  router.get("/api/v1", () => API_INDEX);
  router.get("/api/v1/rtc-config", () => ({
    iceServers: options.config.iceServers ?? [
      { urls: "stun:stun.l.google.com:19302" },
    ],
  }));
  registerAuthRoutes(router, ctx);
  registerTeamRoutes(router, ctx);
  registerSceneRoutes(router, ctx);
  registerNotificationRoutes(router, ctx);
  registerAIRoutes(router, ctx, (req) => getUser(ctx.db, req));
  registerMCPRoutes(router, ctx);

  const staticRoot = options.staticDir ? resolve(options.staticDir) : null;

  const serveStatic = (req: IncomingMessage, res: ServerResponse) => {
    if (!staticRoot || (req.method !== "GET" && req.method !== "HEAD")) {
      return false;
    }
    const pathname = decodeURIComponent(
      new URL(req.url || "/", "http://localhost").pathname,
    );
    let file = normalize(join(staticRoot, pathname));
    // must stay inside the root (a bare prefix check would admit siblings
    // such as `build-old/`)
    if (file !== staticRoot && !file.startsWith(staticRoot + sep)) {
      return false;
    }
    if (!existsSync(file) || statSync(file).isDirectory()) {
      // single-page app: unknown paths get the app shell
      file = join(staticRoot, "index.html");
      if (!existsSync(file)) {
        return false;
      }
    }
    res.writeHead(200, {
      "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
      "Cache-Control": file.includes(`${join(staticRoot, "assets")}`)
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    });
    if (req.method === "HEAD") {
      res.end();
    } else {
      createReadStream(file).pipe(res);
    }
    return true;
  };

  const server = createServer(async (req, res) => {
    const isApi = req.url?.startsWith("/api") || req.url?.startsWith("/mcp");
    if (isApi) {
      // API keys work from any origin; cookies are never sent cross-site
      // (SameSite=Lax and no Allow-Credentials)
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type, X-Share-Token, Mcp-Session-Id, Mcp-Protocol-Version",
      );
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      );
      res.setHeader(
        "Access-Control-Expose-Headers",
        "X-Ratelimit-Limit, X-Ratelimit-Remaining",
      );
      if (req.method === "OPTIONS") {
        res.writeHead(204).end();
        return;
      }
    }
    try {
      if (await handleClaudeBridge(ctx, req, res)) {
        return;
      }
      if (await router.handle(req, res)) {
        return;
      }
      if (!isApi && serveStatic(req, res)) {
        return;
      }
      sendJSON(res, 404, { statusCode: 404, message: "Not found" });
    } catch (error) {
      console.error(error);
      if (!res.headersSent) {
        sendJSON(res, 500, {
          statusCode: 500,
          message: "Internal server error",
        });
      } else {
        res.end();
      }
    }
  });

  // realtime scene & user notification channels (WebSocket); SSE remains fallback
  server.on("upgrade", (req, socket, head) => {
    try {
      if (
        !handleSceneSocket(ctx, req, socket, head) &&
        !handleNotificationSocket(ctx, req, socket, head)
      ) {
        socket.destroy();
      }
    } catch (error) {
      console.error(error);
      socket.destroy();
    }
  });

  server.on("close", () => hub.close());

  return { server, ctx };
};
