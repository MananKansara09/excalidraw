import { Readable } from "node:stream";

import { getUser } from "./auth.ts";
import { parseCookies, sendJSON } from "./http.ts";

import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppContext } from "./context.ts";
import type { Request } from "./http.ts";

export const CLAUDE_BRIDGE_PREFIX = "/claude-bridge";
// room for five 5 MB attachments sent as base64, plus the prompt
const MAX_BODY = 36 * 1024 * 1024;

const readBody = (req: IncomingMessage) =>
  new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });

/**
 * Authenticated pass-through to the claude-bridge service (see
 * claude-bridge/): only signed-in users reach it, and the bridge learns who
 * they are from the user id we attach, so every user gets their own Claude
 * login. The bridge itself is only reachable on the internal network.
 *
 * Returns false when the request isn't for the bridge (or it isn't set up).
 */
export const handleClaudeBridge = async (
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> => {
  const bridge = ctx.config.claudeBridge;
  const pathname = (req.url || "").split("?")[0];
  if (!pathname.startsWith(`${CLAUDE_BRIDGE_PREFIX}/`) || !bridge) {
    return false;
  }

  const user = getUser(ctx.db, {
    headers: req.headers,
    cookies: parseCookies(req.headers.cookie),
  } as unknown as Request);
  if (!user) {
    sendJSON(res, 401, { error: "signin_required" });
    return true;
  }

  const method = req.method || "GET";
  if (method !== "GET" && method !== "POST") {
    sendJSON(res, 405, { error: "Method not allowed" });
    return true;
  }
  // JSON-only POSTs can't be sent by a cross-site <form>
  if (method === "POST" && !req.headers["content-type"]?.includes("json")) {
    sendJSON(res, 415, { error: "Expected application/json" });
    return true;
  }

  let body: Buffer | undefined;
  if (method === "POST") {
    try {
      body = await readBody(req);
    } catch {
      sendJSON(res, 413, { error: "Request too large" });
      return true;
    }
  }

  const abort = new AbortController();
  res.on("close", () => abort.abort());
  try {
    const upstream = await fetch(`${bridge.url}${req.url}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-bridge-secret": bridge.secret,
        "x-claude-user": user.id,
      },
      body: body as unknown as Uint8Array | undefined,
      signal: abort.signal,
    });
    res.writeHead(upstream.status, {
      "content-type":
        upstream.headers.get("content-type") || "application/json",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    });
    if (!upstream.body) {
      res.end();
    } else {
      Readable.fromWeb(upstream.body as never).pipe(res);
    }
  } catch (error) {
    if (!res.headersSent) {
      sendJSON(res, 502, {
        error: "bridge_unavailable",
        message: "The Claude bridge isn't reachable.",
      });
    } else {
      res.end();
    }
    if (!abort.signal.aborted) {
      console.error("claude-bridge proxy:", (error as Error).message);
    }
  }
  return true;
};
