/**
 * Claude bridge for the Excalidraw "Claude" panel.
 *
 * Runs the Claude Agent SDK (which drives the user's local Claude Code
 * install and its `claude login` session) and streams the results to the
 * browser over SSE. Every person runs the bridge on their own machine and
 * therefore uses THEIR OWN Claude subscription; nothing is shared.
 *
 *   cd claude-bridge && yarn install && yarn start
 *
 * Claude can't touch files or run commands here: all built-in tools are
 * disabled. The only tools it gets draw on the canvas (the browser applies
 * them), see `buildTools`.
 */
import http from "node:http";
import os from "node:os";
import {
  query,
  createSdkMcpServer,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const PORT = Number(process.env.CLAUDE_BRIDGE_PORT || 3016);
const HOST = "127.0.0.1";
const ALLOWED_ORIGINS = (
  process.env.CLAUDE_BRIDGE_ORIGINS ||
  "http://localhost:3000,http://127.0.0.1:3000"
)
  .split(",")
  .map((s) => s.trim());
const MAX_BODY = 2 * 1024 * 1024;
const PREFIX = "/claude-bridge";

const SYSTEM_PROMPT = `You are Claude, built into the Excalidraw whiteboard. You help the user create and edit diagrams and scenes on the canvas.

You draw by calling the excalidraw tools; the user sees results live. Prefer drawing over describing. After drawing, reply with ONE or TWO short sentences.

Element rules (Excalidraw "skeleton" format):
- types: rectangle, ellipse, diamond, text, arrow, line, frame.
- Always give every element a short unique "id" (e.g. "db1") so arrows can bind and you can update/delete later.
- Shapes: {type, id, x, y, width, height, strokeColor?, backgroundColor?, fillStyle?: "solid"|"hachure"|"cross-hatch", roughness?: 0|1|2, strokeStyle?: "solid"|"dashed"|"dotted", label?: {text, fontSize?}}. A "label" puts centered text inside the shape - use it instead of separate text elements.
- Free text: {type:"text", id, x, y, text, fontSize?, strokeColor?}.
- Arrows/lines: {type:"arrow", id, x, y, start?: {id:"<element id>"}, end?: {id:"<element id>"}, label?: {text}, endArrowhead?: "arrow"|"triangle"|null}. When start/end reference ids, omit width/height; the arrows connect and route themselves. For unbound arrows give x,y and width,height (dx,dy).
- Coordinates: pixels, origin top-left, y grows downward. Lay diagrams out on a clean grid. Leave 60-100px gaps, but at least 200px between shapes joined by a LABELED arrow (the label sits on the arrow), boxes about 160x70 (wider for long labels). Start near the existing content's free area (see the scene summary) or at (0,0) on an empty canvas.
- Use a consistent, tasteful palette (e.g. fills #a5d8ff, #b2f2bb, #ffec99, #ffc9c9, #d0bfff with stroke #1e1e1e).
- Add a title text above bigger diagrams. Draw in as few tool calls as possible (batch all elements in one add_elements call; create referenced shapes in the same batch).
- To change existing elements use update_elements with their ids from the scene summary; to remove use delete_elements.
You cannot read files or run commands. If asked for something unrelated to drawing, answer briefly.`;

const sendJson = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("Request too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });

const looseElement = z.object({}).passthrough();

const buildTools = (emit) => {
  const op = (name, count) => ({
    content: [
      { type: "text", text: `${name}: ${count} item(s) sent to the canvas.` },
    ],
  });
  return createSdkMcpServer({
    name: "excalidraw",
    version: "1.0.0",
    tools: [
      tool(
        "add_elements",
        "Add elements to the canvas using Excalidraw's skeleton format (shapes with labels, text, arrows with start/end bindings, frames).",
        { elements: z.array(looseElement).min(1).max(300) },
        async ({ elements }) => {
          emit("ops", { op: "add", elements });
          return op("add_elements", elements.length);
        },
      ),
      tool(
        "update_elements",
        "Update existing elements by id. Each entry is {id, ...propertiesToChange} (e.g. x, y, width, height, strokeColor, backgroundColor, text).",
        { updates: z.array(looseElement).min(1).max(300) },
        async ({ updates }) => {
          emit("ops", { op: "update", updates });
          return op("update_elements", updates.length);
        },
      ),
      tool(
        "delete_elements",
        "Delete elements by id.",
        { ids: z.array(z.string()).min(1).max(300) },
        async ({ ids }) => {
          emit("ops", { op: "delete", ids });
          return op("delete_elements", ids.length);
        },
      ),
      tool(
        "clear_canvas",
        "Remove EVERYTHING from the canvas. Only when the user explicitly asks to start over.",
        {},
        async () => {
          emit("ops", { op: "clear" });
          return op("clear_canvas", 0);
        },
      ),
    ],
  });
};

const summarizeScene = (scene) => {
  if (!scene || !Array.isArray(scene.elements) || !scene.elements.length) {
    return "The canvas is currently empty.";
  }
  const lines = scene.elements
    .slice(0, 200)
    .map((e) => JSON.stringify(e))
    .join("\n");
  const more =
    scene.elements.length > 200
      ? `\n(+${scene.elements.length - 200} more not shown)`
      : "";
  const sel = scene.selectedIds?.length
    ? `\nCurrently selected ids: ${scene.selectedIds.join(", ")}`
    : "";
  return `Current canvas (one JSON per line: id,type,x,y,w,h,text,...):\n${lines}${more}${sel}`;
};

const handleChat = async (req, res) => {
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (e) {
    return sendJson(res, 400, { error: String(e.message || e) });
  }
  const { message, sessionId, scene, model } = payload;
  if (typeof message !== "string" || !message.trim()) {
    return sendJson(res, 400, { error: "message is required" });
  }

  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  const emit = (event, data) => {
    if (!res.writableEnded) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };

  const abort = new AbortController();
  res.on("close", () => abort.abort());

  // Use the user's Claude subscription login, never a stray API key.
  const env = {
    ...process.env,
    CLAUDE_AGENT_SDK_CLIENT_APP: "excalidraw-claude-panel/0.1",
  };
  if (!process.env.CLAUDE_BRIDGE_ALLOW_API_KEY) {
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
  }

  const toolNames = [
    "add_elements",
    "update_elements",
    "delete_elements",
    "clear_canvas",
  ];
  try {
    const stream = query({
      prompt: `${summarizeScene(scene)}\n\n---\nUser request:\n${message}`,
      options: {
        abortController: abort,
        cwd: os.tmpdir(),
        env,
        model: model || undefined,
        resume: sessionId || undefined,
        systemPrompt: SYSTEM_PROMPT,
        settingSources: [],
        tools: [],
        mcpServers: { excalidraw: buildTools(emit) },
        allowedTools: toolNames.map((n) => `mcp__excalidraw__${n}`),
        permissionMode: "dontAsk",
        includePartialMessages: true,
        maxTurns: 12,
      },
    });

    for await (const msg of stream) {
      if (msg.type === "system" && msg.subtype === "init") {
        emit("session", { sessionId: msg.session_id });
      } else if (msg.type === "stream_event") {
        const ev = msg.event;
        if (
          ev.type === "content_block_delta" &&
          ev.delta.type === "text_delta" &&
          !msg.parent_tool_use_id
        ) {
          emit("text", { delta: ev.delta.text });
        } else if (
          ev.type === "content_block_start" &&
          ev.content_block.type === "tool_use"
        ) {
          emit("tool", {
            name: ev.content_block.name.replace(/^mcp__excalidraw__/, ""),
          });
        }
      } else if (msg.type === "assistant" && msg.error) {
        emit("error", { code: msg.error, message: friendlyError(msg.error) });
      } else if (msg.type === "result") {
        if (msg.is_error) {
          emit("error", {
            code: msg.subtype,
            message: friendlyError(msg.subtype, msg.result),
          });
        }
        emit("done", { sessionId: msg.session_id });
      }
    }
  } catch (e) {
    if (!abort.signal.aborted) {
      emit("error", {
        code: "bridge",
        message: friendlyError("bridge", e?.message),
      });
    }
  } finally {
    res.end();
  }
};

const friendlyError = (code, detail) => {
  switch (code) {
    case "authentication_failed":
    case "oauth_org_not_allowed":
      return "Claude Code isn't signed in on this machine. Run `claude login` in a terminal, then try again.";
    case "rate_limit":
      return "Your Claude plan's usage limit was reached. Try again later.";
    case "billing_error":
    case "account_on_hold":
      return "There is a problem with your Claude account or plan.";
    default:
      return detail ? String(detail).slice(0, 400) : `Claude error: ${code}`;
  }
};

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  // Browsers always send Origin on cross-origin POST/fetch; refuse other sites
  // so a random web page can't spend the user's subscription.
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return sendJson(res, 403, { error: "Origin not allowed" });
  }
  if (origin) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("access-control-allow-headers", "content-type");
    res.setHeader("vary", "Origin");
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }
  const url = new URL(req.url, `http://${HOST}`);
  if (req.method === "GET" && url.pathname === `${PREFIX}/health`) {
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === "POST" && url.pathname === `${PREFIX}/chat`) {
    return handleChat(req, res);
  }
  sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`Claude bridge listening on http://${HOST}:${PORT}${PREFIX}`);
  console.log(
    "Uses your local Claude Code login. Run `claude login` first if needed.",
  );
});
