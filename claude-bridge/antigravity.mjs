/**
 * The Antigravity half of the bridge: drives the user's own `agy` CLI (and so
 * their own Antigravity sign-in) in headless stream-json mode, and serves the
 * canvas tools to it over MCP.
 *
 * Local mode only: `agy` keeps its login in the OS keyring and has no headless
 * sign-in, so one server can't keep several people's accounts apart.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

import {
  answerMcp,
  createTranslator,
  findAccountEmail,
  isConversationId,
  parseModels,
} from "./antigravity-core.mjs";
import { summarizeScene, systemPrompt } from "./canvas.mjs";
import { isModelId, MAX_CHAT_BODY, validateAttachments } from "./chat.mjs";

const AGY_BIN = process.env.AGY_BIN || "agy";
const WORK_DIR =
  process.env.ANTIGRAVITY_WORK_DIR ||
  path.join(os.homedir(), ".excalidraw-antigravity");
const AGENTS_DIR = path.join(WORK_DIR, ".agents");
const UPLOAD_DIR = path.join(WORK_DIR, "attachments");
const READ_ROOTS = [
  UPLOAD_DIR,
  // where `agy` caches the canvas tools' schemas before calling them
  path.join(os.homedir(), ".gemini", "antigravity-cli", "mcp", "excalidraw"),
];
const TURN_TIMEOUT = 10 * 60 * 1000;
const STATUS_TTL = 5 * 60 * 1000;
const MAX_TEXT_CHARS = 400_000;

// on top of the guard hook: refused even if the hook were skipped
const SETTINGS = JSON.stringify({
  toolPermission: "request-review",
  permissions: {
    allow: ["mcp(excalidraw/*)"],
    deny: ["command(*)", "write_file(*)", "read_url(*)", "execute_url(*)"],
  },
});

const UNSUPPORTED =
  "Antigravity works only with a bridge running on your own computer: its sign-in can't be kept separate for each user on a shared server.";

const INSTRUCTIONS = `${systemPrompt("Antigravity")}
The canvas tools are on the "excalidraw" MCP server. Apart from viewing attached files they are the only tools you may use: you cannot run commands, write files or browse. If asked for something unrelated to drawing, answer briefly.`;

const agyEnv = () => {
  const env = { ...process.env };
  // the guard hook runs as `node guard.mjs`: make sure that resolves
  const key =
    Object.keys(env).find((k) => k.toLowerCase() === "path") ?? "PATH";
  env[key] = [path.dirname(process.execPath), env[key]]
    .filter(Boolean)
    .join(path.delimiter);
  return env;
};

const killTree = (proc) => {
  if (proc.exitCode !== null || !proc.pid) {
    return;
  }
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], {
      stdio: "ignore",
    }).on("error", () => proc.kill());
  } else {
    proc.kill();
  }
};

// account -----------------------------------------------------------------------

/**
 * `agy` has no "who am I" command: listing the models only works when signed
 * in, and its log names the account. No prompt is sent, so no quota is used.
 */
const readAccount = () =>
  new Promise((resolve) => {
    const log = path.join(
      os.tmpdir(),
      `agy-status-${randomBytes(6).toString("hex")}.log`,
    );
    const proc = spawn(AGY_BIN, ["--log-file", log, "models"], {
      cwd: os.homedir(),
      env: agyEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    proc.stdout.on("data", (d) => (out += d));
    const timer = setTimeout(() => killTree(proc), 30000);
    const done = (installed) => {
      clearTimeout(timer);
      const models = parseModels(out);
      let email = null;
      try {
        email = findAccountEmail(readFileSync(log, "utf8"));
      } catch {}
      rmSync(log, { force: true });
      resolve({ installed, loggedIn: models.length > 0, email, models });
    };
    proc.on("error", () => done(false));
    proc.on("close", () => done(true));
  });

let account = null; // { at, value: Promise }

/** signed-out answers aren't kept, so a fresh sign-in shows up at once */
const getAccount = () => {
  if (account && Date.now() - account.at < STATUS_TTL) {
    return account.value;
  }
  const entry = { at: Date.now(), value: readAccount() };
  account = entry;
  entry.value.then((value) => {
    if (!value.loggedIn && account === entry) {
      account = null;
    }
  });
  return entry.value;
};

/**
 * `agy` signs in and out only inside its own terminal screen, so open one.
 * Resolves false when no terminal could be started.
 */
const openTerminal = () =>
  new Promise((resolve) => {
    const [command, args] =
      process.platform === "win32"
        ? ["cmd.exe", ["/c", "start", "Antigravity CLI", "cmd", "/k", AGY_BIN]]
        : process.platform === "darwin"
        ? [
            "osascript",
            [
              "-e",
              `tell application "Terminal" to do script ${JSON.stringify(
                AGY_BIN,
              )}`,
              "-e",
              'tell application "Terminal" to activate',
            ],
          ]
        : ["x-terminal-emulator", ["-e", AGY_BIN]];
    const proc = spawn(command, args, {
      cwd: os.homedir(),
      env: agyEnv(),
      detached: true,
      stdio: "ignore",
    });
    proc.on("error", () => resolve(false));
    proc.on("spawn", () => {
      proc.unref();
      resolve(true);
    });
  });

// workspace ---------------------------------------------------------------------

/** the folder `agy` runs in: the canvas MCP server and the guard hook */
const prepareWorkspace = (mcpUrl) => {
  mkdirSync(AGENTS_DIR, { recursive: true, mode: 0o700 });
  const json = (name, value) =>
    writeFileSync(path.join(AGENTS_DIR, name), JSON.stringify(value), {
      mode: 0o600,
    });
  copyFileSync(
    fileURLToPath(new URL("./antigravity-guard.mjs", import.meta.url)),
    path.join(AGENTS_DIR, "guard.mjs"),
  );
  json("guard.json", { readRoots: READ_ROOTS });
  json("hooks.json", {
    "excalidraw-guard": {
      PreToolUse: [
        {
          matcher: "*",
          // runs inside .agents/, so there is no path to quote
          hooks: [{ type: "command", command: "node guard.mjs", timeout: 20 }],
        },
      ],
    },
  });
  json("mcp_config.json", {
    mcpServers: { excalidraw: { serverUrl: mcpUrl } },
  });
};

/** text files go into the prompt; images and PDFs are saved for the agent */
const buildPrompt = (request, attachments, folder) => {
  const parts = attachments.map((file, i) => {
    const data = Buffer.from(file.data, "base64");
    if (file.kind === "text") {
      const body = data.toString("utf8");
      return `Attached file "${file.name}":\n\n${body.slice(
        0,
        MAX_TEXT_CHARS,
      )}${body.length > MAX_TEXT_CHARS ? "\n… (truncated)" : ""}`;
    }
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    const safe = file.name.replace(/[^\w.-]+/g, "_").slice(-80);
    const target = path.join(folder, `${i + 1}-${safe}`);
    writeFileSync(target, data, { mode: 0o600 });
    return `Attached file "${file.name}": read it with your file viewing tool at ${target}`;
  });
  return [...parts, request].join("\n\n");
};

// requests ----------------------------------------------------------------------

export const createAntigravity = ({
  prefix,
  multiuser,
  mcpOrigin,
  sendJson,
  readBody,
}) => {
  const base = `${prefix}/antigravity`;
  /** the running turn: its secret MCP address and where canvas ops go */
  let turn = null;

  const friendlyError = (code, detail) => {
    switch (code) {
      case "authentication_failed":
        return "Antigravity isn't signed in on this machine. Sign in and try again.";
      case "rate_limit":
        return "Your Antigravity usage limit was reached. Try again later.";
      case "model_not_found":
        return "Your Antigravity account can't use this model. Pick another one.";
      default:
        return detail
          ? String(detail).slice(0, 400)
          : `Antigravity error: ${code}`;
    }
  };

  const handleMcp = async (req, res, token) => {
    // browsers send Origin; only the local `agy` process belongs here
    if (!turn || token !== turn.token || req.headers.origin) {
      return sendJson(res, 404, { error: "Not found" });
    }
    if (req.method !== "POST") {
      res.writeHead(405, { allow: "POST" });
      return res.end();
    }
    const current = turn;
    let message;
    try {
      message = JSON.parse(await readBody(req));
    } catch {
      return sendJson(res, 400, { error: "Invalid JSON" });
    }
    const reply = answerMcp(message, current.emit);
    if (!reply) {
      res.writeHead(202);
      return res.end();
    }
    return sendJson(res, 200, reply);
  };

  const handleChat = async (req, res) => {
    let payload;
    let attachments;
    try {
      payload = JSON.parse(await readBody(req, MAX_CHAT_BODY));
      attachments = validateAttachments(payload.attachments);
    } catch (e) {
      return sendJson(res, 400, { error: String(e.message || e) });
    }
    const { message, sessionId, scene, model } = payload;
    if (typeof message !== "string" || !message.trim()) {
      return sendJson(res, 400, { error: "message is required" });
    }
    if (model !== undefined && !isModelId(model)) {
      return sendJson(res, 400, { error: "Unknown model" });
    }
    if (sessionId && !isConversationId(sessionId)) {
      return sendJson(res, 400, { error: "Unknown conversation" });
    }
    if (turn) {
      return sendJson(res, 429, {
        error: "Antigravity is still answering your previous message.",
      });
    }

    const emit = (event, data) => {
      if (!res.writableEnded) {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      }
    };
    const fail = (code, detail) =>
      emit("error", { code, message: friendlyError(code, detail) });
    const current = { token: randomBytes(24).toString("hex"), emit };
    turn = current;
    const uploads = path.join(UPLOAD_DIR, current.token.slice(0, 12));
    let timer;
    const end = () => {
      clearTimeout(timer);
      if (turn === current) {
        turn = null;
      }
      rmSync(uploads, { recursive: true, force: true });
      res.end();
    };

    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });

    let proc;
    let prompt;
    try {
      prepareWorkspace(`${mcpOrigin}${base}/mcp/${current.token}`);
      const request = `${summarizeScene(
        scene,
      )}\n\n---\nUser request:\n${message}`;
      // `agy` takes no system prompt, so a new conversation opens with it
      prompt = buildPrompt(
        sessionId ? request : `${INSTRUCTIONS}\n\n${request}`,
        attachments,
        uploads,
      );
      const args = [
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--settings",
        SETTINGS,
      ];
      // "default" means: whatever the user picked in Antigravity itself
      if (model && model !== "default") {
        args.push("--model", model);
      }
      if (sessionId) {
        args.push("--conversation", sessionId);
      }
      proc = spawn(AGY_BIN, args, {
        cwd: WORK_DIR,
        env: agyEnv(),
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (e) {
      fail("bridge", e?.message);
      return end();
    }

    let stderr = "";
    let stopped = false;
    const stop = () => {
      stopped = true;
      killTree(proc);
    };
    const translator = createTranslator({
      emit,
      friendlyError,
      readRoots: READ_ROOTS,
      onViolation: (name) => {
        stop();
        fail(
          "bridge",
          `Stopped: Antigravity used a tool the canvas doesn't allow (${name}).`,
        );
      },
    });
    timer = setTimeout(() => {
      stop();
      fail("bridge", "Antigravity took too long and was stopped.");
    }, TURN_TIMEOUT);
    res.on("close", stop);

    readline.createInterface({ input: proc.stdout }).on("line", (line) => {
      if (stopped) {
        return;
      }
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      translator.handle(event);
    });
    proc.stderr.on("data", (d) => (stderr = (stderr + d).slice(-4000)));
    proc.stdin.on("error", () => {});
    proc.on("error", (e) => {
      stopped = true;
      fail(
        "bridge",
        e.code === "ENOENT"
          ? "The Antigravity CLI (agy) isn't installed on this machine."
          : e.message,
      );
      end();
    });
    proc.on("close", () => {
      if (!stopped && !translator.finished) {
        const detail = stderr.trim() || "Antigravity ended without an answer.";
        const code = /authentication required|not logged in/i.test(detail)
          ? "authentication_failed"
          : "bridge";
        if (code === "authentication_failed") {
          account = null;
        }
        fail(code, detail);
      }
      end();
    });
    // closing stdin makes `agy` exit once this turn is answered
    proc.stdin.end(
      `${JSON.stringify({ event: "user", message: { content: prompt } })}\n`,
    );
  };

  /** true when the request was an Antigravity one (and is now handled) */
  return async (req, res, url) => {
    if (!url.pathname.startsWith(`${base}/`)) {
      return false;
    }
    const route = url.pathname.slice(base.length + 1);
    if (multiuser) {
      if (req.method === "GET" && route === "status") {
        sendJson(res, 200, {
          mode: "multiuser",
          loggedIn: false,
          unsupported: UNSUPPORTED,
        });
      } else {
        sendJson(res, 400, { error: UNSUPPORTED });
      }
    } else if (route.startsWith("mcp/")) {
      await handleMcp(req, res, route.slice(4));
    } else if (req.method === "GET" && route === "status") {
      if (url.searchParams.has("fresh")) {
        account = null;
      }
      const { installed, loggedIn, email } = await getAccount();
      sendJson(res, 200, { mode: "local", installed, loggedIn, email });
    } else if (req.method === "GET" && route === "models") {
      const { models } = await getAccount();
      sendJson(res, 200, {
        models: models.length
          ? [
              {
                value: "default",
                name: "Default",
                description: "The model set in your Antigravity CLI",
              },
              ...models,
            ]
          : [],
      });
    } else if (
      req.method === "POST" &&
      (route === "auth/login" || route === "auth/logout")
    ) {
      account = null;
      if (await openTerminal()) {
        sendJson(res, 200, { terminal: true });
      } else {
        sendJson(res, 500, {
          error: "Couldn't open a terminal. Run `agy` in one yourself.",
        });
      }
    } else if (req.method === "POST" && route === "chat") {
      await handleChat(req, res);
    } else {
      sendJson(res, 404, { error: "Not found" });
    }
    return true;
  };
};
