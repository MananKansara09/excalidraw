/**
 * The Antigravity half of the bridge: drives the user's own `agy` CLI (and so
 * their own Antigravity sign-in) in headless stream-json mode, and serves the
 * canvas tools to it over MCP.
 *
 * In multiuser mode every user gets their own home folder, so their own sign-in
 * (kept in a file there) and conversations, and permission rules that refuse
 * everyone else's files.
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
import {
  agentDirs,
  antigravityDenyRules,
  antigravityUserEnv,
  isLocalPeer,
} from "./isolation.mjs";
import { createCodeLogins } from "./login.mjs";
import { killTree } from "./process.mjs";

const AGY_BIN = process.env.AGY_BIN || "agy";
const WORK_DIR =
  process.env.ANTIGRAVITY_WORK_DIR ||
  path.join(os.homedir(), ".excalidraw-antigravity");
const UPLOAD_DIR = path.join(WORK_DIR, "attachments");
/** where `agy` caches the canvas tools' schemas before calling them */
const schemaDir = (home) =>
  path.join(home, ".gemini", "antigravity-cli", "mcp", "excalidraw");
const TURN_TIMEOUT = 10 * 60 * 1000;
const STATUS_TTL = 5 * 60 * 1000;
const MAX_TEXT_CHARS = 400_000;

// on top of the guard hook: refused even if the hook were skipped
export const antigravitySettings = (deny = []) =>
  JSON.stringify({
    toolPermission: "request-review",
    permissions: {
      allow: ["mcp(excalidraw/*)"],
      deny: [
        "command(*)",
        "write_file(*)",
        "read_url(*)",
        "execute_url(*)",
        ...deny,
      ],
    },
  });

const NOT_INSTALLED =
  "The Antigravity CLI (agy) isn't installed for the bridge.";

/** the Google page `agy` prints, once the whole link is there */
export const findGoogleLoginUrl = (output) =>
  output.match(/https:\/\/accounts\.google\.com\/\S+(?=\s)/)?.[0] ?? null;

const INSTRUCTIONS = `${systemPrompt("Antigravity")}
The canvas tools are on the "excalidraw" MCP server. Apart from viewing attached files they are the only tools you may use: you cannot run commands, write files or browse. If asked for something unrelated to drawing, answer briefly.`;

/** the guard hook runs as `node guard.mjs`: make sure that resolves */
const withNode = (source) => {
  const env = { ...source };
  const key =
    Object.keys(env).find((k) => k.toLowerCase() === "path") ?? "PATH";
  env[key] = [path.dirname(process.execPath), env[key]]
    .filter(Boolean)
    .join(path.delimiter);
  return env;
};

/** where one person's `agy` runs and what it may reach */
const localSpace = () => ({
  id: "local",
  home: os.homedir(),
  work: WORK_DIR,
  cwd: os.homedir(),
  uploads: UPLOAD_DIR,
  tmp: os.tmpdir(),
  env: withNode(process.env),
  settings: () => antigravitySettings(),
});

const userSpace = (user) => {
  const dirs = agentDirs(user, "antigravity");
  return {
    id: user.id,
    shared: true,
    home: dirs.home,
    work: dirs.work,
    cwd: dirs.work,
    uploads: dirs.uploads,
    tmp: dirs.tmp,
    env: withNode(antigravityUserEnv(dirs)),
    // a file: the rules grow with the number of users
    settings: () => {
      const file = path.join(dirs.root, "settings.json");
      writeFileSync(file, antigravitySettings(antigravityDenyRules(user)), {
        mode: 0o600,
      });
      return file;
    },
  };
};

// account -----------------------------------------------------------------------

/**
 * `agy` has no "who am I" command: listing the models only works when signed
 * in, and its log names the account. No prompt is sent, so no quota is used.
 */
const readAccount = (space) =>
  new Promise((resolve) => {
    const log = path.join(
      space.tmp,
      `agy-status-${randomBytes(6).toString("hex")}.log`,
    );
    const proc = spawn(AGY_BIN, ["--log-file", log, "models"], {
      cwd: space.cwd,
      env: space.env,
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

const accounts = new Map(); // userId -> { at, value: Promise }

const forgetAccount = (space) => accounts.delete(space.id);

/** signed-out answers aren't kept, so a fresh sign-in shows up at once */
const getAccount = (space) => {
  const known = accounts.get(space.id);
  if (known && Date.now() - known.at < STATUS_TTL) {
    return known.value;
  }
  const entry = { at: Date.now(), value: readAccount(space) };
  accounts.set(space.id, entry);
  entry.value.then((value) => {
    if (!value.loggedIn && accounts.get(space.id) === entry) {
      forgetAccount(space);
    }
  });
  return entry.value;
};

/**
 * On the user's own computer, `agy` signs in and out inside its own terminal
 * screen, so open one. Resolves false when no terminal could be started.
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
      env: withNode(process.env),
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
export const prepareWorkspace = (work, mcpUrl, readRoots) => {
  const agents = path.join(work, ".agents");
  mkdirSync(agents, { recursive: true, mode: 0o700 });
  const json = (name, value) =>
    writeFileSync(path.join(agents, name), JSON.stringify(value), {
      mode: 0o600,
    });
  copyFileSync(
    fileURLToPath(new URL("./antigravity-guard.mjs", import.meta.url)),
    path.join(agents, "guard.mjs"),
  );
  json("guard.json", { readRoots });
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
  slots,
  sendJson,
  readBody,
}) => {
  const base = `${prefix}/antigravity`;
  /** running turns by their secret MCP address: where canvas ops go */
  const turns = new Map();
  const logins = createCodeLogins(findGoogleLoginUrl);

  const friendlyError = (code, detail) => {
    switch (code) {
      case "authentication_failed":
        return "Antigravity isn't signed in (or the sign-in expired). Sign in and try again.";
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
    const current = turns.get(token);
    if (!current || req.headers.origin || !isLocalPeer(req)) {
      return sendJson(res, 404, { error: "Not found" });
    }
    if (req.method !== "POST") {
      res.writeHead(405, { allow: "POST" });
      return res.end();
    }
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

  const handleChat = async (req, res, space) => {
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
    const emit = (event, data) => {
      if (!res.writableEnded) {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      }
    };
    const fail = (code, detail) =>
      emit("error", { code, message: friendlyError(code, detail) });
    const slot = slots.take("antigravity", space.id, "Antigravity");
    if (!slot.release) {
      return sendJson(res, slot.status, { error: slot.error });
    }
    const token = randomBytes(24).toString("hex");
    turns.set(token, { emit });
    const uploads = path.join(space.uploads, token.slice(0, 12));
    // only this turn's uploads and the canvas tools' own files can be read
    const readRoots = [uploads, schemaDir(space.home)];
    let timer;
    const end = () => {
      clearTimeout(timer);
      turns.delete(token);
      slot.release();
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
      // signed out, `agy` would wait a minute for a code, holding the slot
      if (space.shared && !(await getAccount(space)).loggedIn) {
        fail("authentication_failed");
        return end();
      }
      // the user may have left while that was being checked
      if (res.destroyed) {
        return end();
      }
      prepareWorkspace(
        space.work,
        `${mcpOrigin}${base}/mcp/${token}`,
        readRoots,
      );
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
        space.settings(),
        "--disable-slash-commands",
      ];
      // "default" means: whatever the user picked in Antigravity itself
      if (model && model !== "default") {
        args.push("--model", model);
      }
      if (sessionId) {
        args.push("--conversation", sessionId);
      }
      proc = spawn(AGY_BIN, args, {
        cwd: space.work,
        env: space.env,
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
      readRoots,
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
      fail("bridge", e.code === "ENOENT" ? NOT_INSTALLED : e.message);
      end();
    });
    proc.on("close", () => {
      if (!stopped && !translator.finished) {
        const detail = stderr.trim() || "Antigravity ended without an answer.";
        const code = /authentication (?:required|failed)|not logged in/i.test(
          detail,
        )
          ? "authentication_failed"
          : "bridge";
        if (code === "authentication_failed") {
          forgetAccount(space);
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

  const signIn = async (space) => {
    forgetAccount(space);
    try {
      return await logins.start(space.id, () =>
        spawn(AGY_BIN, ["acp", "--login"], {
          cwd: space.cwd,
          env: { ...space.env, BROWSER: "true" },
          stdio: ["pipe", "pipe", "pipe"],
        }),
      );
    } catch (e) {
      throw e.code === "ENOENT" ? new Error(NOT_INSTALLED) : e;
    }
  };

  /** on a shared server the sign-in is files in the user's home: remove them */
  const signOut = (space) => {
    logins.cancel(space.id);
    rmSync(space.home, { recursive: true, force: true });
    forgetAccount(space);
  };

  /** sign-in on a shared server, where the user can't reach its terminal */
  const handleSharedAuth = async (req, res, route, space) => {
    if (route === "auth/login") {
      try {
        sendJson(res, 200, { url: await signIn(space) });
      } catch (e) {
        sendJson(res, 500, { error: String(e.message || e) });
      }
    } else if (route === "auth/code") {
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        return sendJson(res, 400, { error: "Invalid JSON" });
      }
      const code = typeof body?.code === "string" ? body.code.trim() : "";
      // the code, or the whole address of the page Google lands on
      if (!/^[\w.~:/?#@!$&'()*+,;=%-]{8,2048}$/.test(code)) {
        return sendJson(res, 400, {
          error: "That doesn't look like the sign-in code. Paste all of it.",
        });
      }
      const result = await logins.submit(space.id, code, async () => {
        forgetAccount(space);
        return (await getAccount(space)).loggedIn;
      });
      sendJson(
        res,
        result.ok ? 200 : 400,
        result.ok ? { loggedIn: true } : { error: result.message },
      );
    } else {
      signOut(space);
      sendJson(res, 200, { loggedIn: false });
    }
  };

  /** true when the request was `agy` asking for the canvas tools */
  const mcp = async (req, res, url) => {
    if (!url.pathname.startsWith(`${base}/mcp/`)) {
      return false;
    }
    await handleMcp(req, res, url.pathname.slice(base.length + 5));
    return true;
  };

  /** true when the request was an Antigravity one (and is now handled) */
  const handle = async (req, res, url, user) => {
    if (!url.pathname.startsWith(`${base}/`)) {
      return false;
    }
    const route = url.pathname.slice(base.length + 1);
    const space = multiuser ? userSpace(user) : localSpace();
    if (req.method === "GET" && route === "status") {
      if (url.searchParams.has("fresh")) {
        forgetAccount(space);
      }
      const { installed, loggedIn, email } = await getAccount(space);
      sendJson(res, 200, {
        mode: multiuser ? "multiuser" : "local",
        // keeps saved chats apart in a shared browser
        user: user.key,
        signIn: multiuser ? "code" : "terminal",
        installed,
        loggedIn,
        email,
      });
    } else if (req.method === "GET" && route === "models") {
      const { models } = await getAccount(space);
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
      multiuser &&
      ["auth/login", "auth/code", "auth/logout"].includes(route)
    ) {
      await handleSharedAuth(req, res, route, space);
    } else if (
      req.method === "POST" &&
      (route === "auth/login" || route === "auth/logout")
    ) {
      forgetAccount(space);
      if (await openTerminal()) {
        sendJson(res, 200, { terminal: true });
      } else {
        sendJson(res, 500, {
          error: "Couldn't open a terminal. Run `agy` in one yourself.",
        });
      }
    } else if (req.method === "POST" && route === "chat") {
      await handleChat(req, res, space);
    } else {
      sendJson(res, 404, { error: "Not found" });
    }
    return true;
  };

  return { handle, mcp };
};
