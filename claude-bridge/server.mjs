/**
 * Claude bridge for the Excalidraw "Claude" panel.
 *
 * Runs the Claude Agent SDK (which drives the Claude Code CLI) and streams the
 * results to the browser over SSE. Every person uses THEIR OWN Claude
 * subscription; nothing is shared.
 *
 * Two modes:
 *  - local (default): one user, uses the machine's own `claude login`.
 *      cd claude-bridge && yarn install && yarn start
 *  - multiuser (CLAUDE_BRIDGE_MODE=multiuser, used by docker-compose.plus.yml):
 *      sits behind the Plus server, which authenticates the user and adds
 *      `x-claude-user` + a shared `x-bridge-secret`. Each user gets an isolated
 *      Claude config dir under CLAUDE_BRIDGE_DATA and signs in to their own
 *      Claude account from the UI (`claude auth login`, code pasted back).
 *
 * Claude can't touch files or run commands here: all built-in tools are
 * disabled. The only tools it gets draw on the canvas (the browser applies
 * them), see `buildTools`.
 */
import { spawn } from "node:child_process";
import { createHash, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {
  query,
  createSdkMcpServer,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const MULTIUSER = process.env.CLAUDE_BRIDGE_MODE === "multiuser";
const PORT = Number(process.env.CLAUDE_BRIDGE_PORT || 3016);
const HOST = process.env.CLAUDE_BRIDGE_HOST || "127.0.0.1";
const SECRET = process.env.CLAUDE_BRIDGE_SECRET || "";
const DATA_DIR = process.env.CLAUDE_BRIDGE_DATA || "/data";
const CLAUDE_BIN = process.env.CLAUDE_BIN || "";
const MAX_CONCURRENT = Number(process.env.CLAUDE_BRIDGE_MAX_CONCURRENT || 8);
const ALLOWED_ORIGINS = (
  process.env.CLAUDE_BRIDGE_ORIGINS ||
  "http://localhost:3000,http://127.0.0.1:3000"
)
  .split(",")
  .map((s) => s.trim());
const MAX_BODY = 2 * 1024 * 1024;
const PREFIX = "/claude-bridge";

if (MULTIUSER && SECRET.length < 16) {
  console.error(
    "CLAUDE_BRIDGE_SECRET (16+ chars) is required in multiuser mode",
  );
  process.exit(1);
}

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

// per-user identity & isolation -----------------------------------------------

const safeEqual = (a, b) => {
  const ha = createHash("sha256").update(String(a)).digest();
  const hb = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(ha, hb);
};

/** returns { id, configDir, workDir } or null when the caller isn't trusted */
const identify = (req) => {
  if (!MULTIUSER) {
    return { id: "local", configDir: undefined, workDir: os.tmpdir() };
  }
  const secret = req.headers["x-bridge-secret"];
  const userId = req.headers["x-claude-user"];
  if (
    typeof secret !== "string" ||
    !safeEqual(secret, SECRET) ||
    typeof userId !== "string" ||
    !/^[\w-]{1,64}$/.test(userId)
  ) {
    return null;
  }
  const key = createHash("sha256").update(userId).digest("hex").slice(0, 32);
  const base = path.join(DATA_DIR, "users", key);
  const configDir = path.join(base, "config");
  const workDir = path.join(base, "work");
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  mkdirSync(workDir, { recursive: true, mode: 0o700 });
  return { id: userId, configDir, workDir, home: base };
};

const PASS_ENV = [
  "PATH",
  "LANG",
  "LC_ALL",
  "TZ",
  "TERM",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
];

/**
 * Environment for Claude child processes. In multiuser mode it is an
 * allowlist, so neither server secrets nor a stray shared token/API key can
 * leak in and turn per-user logins into one shared subscription.
 */
const cliEnv = (user) => {
  const env = {};
  if (MULTIUSER) {
    for (const k of PASS_ENV) {
      if (process.env[k]) env[k] = process.env[k];
    }
    env.HOME = user.home;
    env.CLAUDE_CONFIG_DIR = user.configDir;
  } else {
    Object.assign(env, process.env);
    if (!process.env.CLAUDE_BRIDGE_ALLOW_API_KEY) {
      delete env.ANTHROPIC_API_KEY;
      delete env.ANTHROPIC_AUTH_TOKEN;
    }
  }
  env.CLAUDE_AGENT_SDK_CLIENT_APP = "excalidraw-claude-panel/0.2";
  return env;
};

const claudeBin = () => CLAUDE_BIN || "claude";

const runCli = (user, args, timeoutMs = 20000) =>
  new Promise((resolve) => {
    const p = spawn(claudeBin(), args, {
      env: cliEnv(user),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    const t = setTimeout(() => p.kill(), timeoutMs);
    p.on("error", () => resolve({ code: -1, out }));
    p.on("close", (code) => {
      clearTimeout(t);
      resolve({ code, out });
    });
  });

const getStatus = async (user) => {
  const { out } = await runCli(user, ["auth", "status"]);
  try {
    const json = JSON.parse(out.slice(out.indexOf("{")));
    return {
      loggedIn: !!json.loggedIn,
      email: json.email || json.account?.email || null,
    };
  } catch {
    return { loggedIn: false, email: null };
  }
};

// interactive `claude auth login`: prints a URL, then waits for the code the
// user gets after authorizing in their browser
const logins = new Map(); // userId -> { proc, output, timer }

const killLogin = (userId) => {
  const l = logins.get(userId);
  if (l) {
    clearTimeout(l.timer);
    l.proc.kill();
    logins.delete(userId);
  }
};

const startLogin = (user) =>
  new Promise((resolve, reject) => {
    killLogin(user.id);
    const proc = spawn(claudeBin(), ["auth", "login", "--claudeai"], {
      env: { ...cliEnv(user), BROWSER: "true" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const entry = {
      proc,
      output: "",
      exited: null,
      timer: setTimeout(() => killLogin(user.id), 10 * 60 * 1000),
    };
    logins.set(user.id, entry);
    let done = false;
    const onData = (d) => {
      entry.output += d;
      const m = entry.output.match(
        /https:\/\/\S*(?:claude\.ai|claude\.com|anthropic\.com)\S*/,
      );
      if (m && !done) {
        done = true;
        resolve(m[0]);
      }
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.on("close", (code) => {
      entry.exited = code;
      if (!done) {
        done = true;
        reject(
          new Error(
            entry.output.trim().slice(0, 300) || "login failed to start",
          ),
        );
      }
    });
    proc.on("error", (e) => !done && ((done = true), reject(e)));
    setTimeout(
      () =>
        !done &&
        ((done = true),
        killLogin(user.id),
        reject(new Error("Timed out starting login"))),
      30000,
    );
  });

const submitCode = (user, code) =>
  new Promise((resolve) => {
    const entry = logins.get(user.id);
    if (!entry || entry.exited !== null) {
      return resolve({ ok: false, message: "Login expired. Start again." });
    }
    const finish = (ok, message) => {
      clearTimeout(timer);
      clearTimeout(entry.timer);
      logins.delete(user.id);
      resolve({ ok, message });
    };
    const timer = setTimeout(() => {
      entry.proc.kill();
      finish(false, "Timed out. Start again.");
    }, 20000);
    entry.proc.on("close", async (exitCode) => {
      if (exitCode === 0) {
        const status = await getStatus(user);
        finish(
          status.loggedIn,
          status.loggedIn ? "" : "Sign-in did not complete.",
        );
      } else {
        finish(false, "That code didn't work. Start again.");
      }
    });
    entry.proc.stdin.write(`${code}\n`);
  });

// request handlers --------------------------------------------------------------

let activeChats = 0;
const activeUsers = new Set();

const handleChat = async (req, res, user) => {
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
  if (activeUsers.has(user.id)) {
    return sendJson(res, 429, {
      error: "Claude is still answering your previous message.",
    });
  }
  if (activeChats >= MAX_CONCURRENT) {
    return sendJson(res, 503, {
      error: "The server is busy. Try again in a moment.",
    });
  }
  activeUsers.add(user.id);
  activeChats++;

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
        cwd: user.workDir,
        env: cliEnv(user),
        pathToClaudeCodeExecutable: CLAUDE_BIN || undefined,
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
    activeUsers.delete(user.id);
    activeChats--;
    res.end();
  }
};

const friendlyError = (code, detail) => {
  switch (code) {
    case "authentication_failed":
    case "oauth_org_not_allowed":
      return MULTIUSER
        ? "Your Claude account isn't connected (or the sign-in expired). Connect it and try again."
        : "Claude Code isn't signed in on this machine. Run `claude login` in a terminal, then try again.";
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
  try {
    const url = new URL(req.url, "http://bridge");
    if (req.method === "GET" && url.pathname === `${PREFIX}/health`) {
      return sendJson(res, 200, { ok: true });
    }

    const origin = req.headers.origin;
    if (!MULTIUSER) {
      // Browsers always send Origin on cross-origin POST/fetch; refuse other
      // sites so a random web page can't spend the user's subscription.
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
    }

    const user = identify(req);
    if (!user) {
      return sendJson(res, 401, { error: "Unauthorized" });
    }

    if (req.method === "GET" && url.pathname === `${PREFIX}/status`) {
      return sendJson(res, 200, {
        mode: MULTIUSER ? "multiuser" : "local",
        ...(await getStatus(user)),
      });
    }
    if (req.method === "POST" && url.pathname === `${PREFIX}/auth/login`) {
      try {
        return sendJson(res, 200, { url: await startLogin(user) });
      } catch (e) {
        return sendJson(res, 500, { error: String(e.message || e) });
      }
    }
    if (req.method === "POST" && url.pathname === `${PREFIX}/auth/code`) {
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        return sendJson(res, 400, { error: "Invalid JSON" });
      }
      const code = typeof body.code === "string" ? body.code.trim() : "";
      // the CLI only accepts `code#state`; anything else would just hang
      if (!/^[\w.~+/=-]{4,256}#[\w.~+/=-]{4,256}$/.test(code)) {
        return sendJson(res, 400, {
          error:
            "That doesn't look like the full sign-in code. Paste all of it, including the part after #.",
        });
      }
      const result = await submitCode(user, code);
      return sendJson(
        res,
        result.ok ? 200 : 400,
        result.ok ? { loggedIn: true } : { error: result.message },
      );
    }
    if (req.method === "POST" && url.pathname === `${PREFIX}/auth/logout`) {
      killLogin(user.id);
      await runCli(user, ["auth", "logout"]);
      return sendJson(res, 200, { loggedIn: false });
    }
    if (req.method === "POST" && url.pathname === `${PREFIX}/chat`) {
      return handleChat(req, res, user);
    }
    sendJson(res, 404, { error: "Not found" });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) sendJson(res, 500, { error: "Internal error" });
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(
    `Claude bridge (${
      MULTIUSER ? "multiuser" : "local"
    }) on http://${HOST}:${PORT}${PREFIX}`,
  );
  if (!MULTIUSER) {
    console.log(
      "Uses your local Claude Code login. Run `claude login` first if needed.",
    );
  }
});
