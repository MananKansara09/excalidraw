/**
 * The Codex half of the bridge: chats run through the Codex SDK with the user's
 * own ChatGPT sign-in, the canvas tools are served to it over MCP, and sign-in
 * and the model list come from the Codex app server (the same CLI the SDK
 * drives).
 *
 * Codex keeps this panel's sign-in, settings and sessions in its own home
 * folder, so the machine's Codex MCP servers, plugins and hooks never load.
 *
 * Local mode only: the ChatGPT sign-in finishes on a localhost address of the
 * machine running the bridge.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

import { answerMcp } from "./antigravity-core.mjs";
import { killTree } from "./process.mjs";
import { summarizeScene, systemPrompt } from "./canvas.mjs";
import { isModelId, MAX_CHAT_BODY, validateAttachments } from "./chat.mjs";
import {
  codexConfig,
  codexThreadOptions,
  createTranslator,
  errorCodeFor,
  errorText,
  isThreadId,
  toAccount,
  toModelChoices,
} from "./codex-core.mjs";

const ROOT =
  process.env.CODEX_BRIDGE_DATA || path.join(os.homedir(), ".excalidraw-codex");
const HOME_DIR = process.env.CODEX_BRIDGE_HOME || path.join(ROOT, "home");
const WORK_DIR = path.join(ROOT, "work");
const UPLOAD_DIR = path.join(ROOT, "attachments");
/** use another Codex install than the one that comes with the SDK */
const CODEX_BIN = process.env.CODEX_BIN || "";
const TURN_TIMEOUT = 10 * 60 * 1000;
const LOGIN_TIMEOUT = 10 * 60 * 1000;
const RPC_TIMEOUT = 30000;
const CACHE_TTL = 5 * 60 * 1000;
const MAX_TEXT_CHARS = 400_000;

const UNSUPPORTED =
  "Codex works only with a bridge running on your own computer: its ChatGPT sign-in finishes on that machine.";
const NOT_INSTALLED =
  "Codex isn't installed for the bridge. Run `yarn install:codex-bridge`, then restart it.";

const INSTRUCTIONS = `${systemPrompt("Codex")}
The canvas tools are on the "excalidraw" MCP server. They are the only way you can act: you cannot run commands, read or write files, or browse. If asked for something unrelated to drawing, answer briefly.`;

const codexEnv = () => {
  const env = { ...process.env, CODEX_HOME: HOME_DIR };
  // use the ChatGPT sign-in, not a stray API key
  if (!process.env.CODEX_BRIDGE_ALLOW_API_KEY) {
    delete env.OPENAI_API_KEY;
    delete env.CODEX_API_KEY;
    delete env.CODEX_ACCESS_TOKEN;
  }
  return env;
};

const makeFolders = () => {
  for (const dir of [HOME_DIR, WORK_DIR]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
};

/** the Codex CLI that `app-server` runs on */
const codexCommand = () => {
  if (CODEX_BIN) {
    return [CODEX_BIN, []];
  }
  const manifest = createRequire(import.meta.url).resolve(
    "@openai/codex/package.json",
  );
  return [
    process.execPath,
    [path.join(path.dirname(manifest), "bin", "codex.js")],
  ];
};

// app server --------------------------------------------------------------------

/**
 * Starts `codex app-server` (JSON-RPC, one message per line) and resolves once
 * it is ready. The caller closes it.
 */
const openAppServer = async () => {
  makeFolders();
  const [command, args] = codexCommand();
  const proc = spawn(command, [...args, "app-server"], {
    cwd: WORK_DIR,
    env: codexEnv(),
    stdio: ["pipe", "pipe", "ignore"],
  });
  const pending = new Map();
  const listeners = new Map();
  let nextId = 1;
  let failure = null;

  const abandon = (error) => {
    failure = error;
    for (const { reject } of pending.values()) {
      reject(error);
    }
    pending.clear();
    listeners.get("closed")?.();
  };
  proc.on("error", abandon);
  proc.on("close", () => abandon(new Error("Codex stopped unexpectedly.")));
  proc.stdin.on("error", () => {});
  readline.createInterface({ input: proc.stdout }).on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.method) {
      listeners.get(message.method)?.(message.params);
      return;
    }
    const waiting = pending.get(message.id);
    if (!waiting) {
      return;
    }
    pending.delete(message.id);
    if (message.error) {
      waiting.reject(new Error(message.error.message || "Codex error"));
    } else {
      waiting.resolve(message.result);
    }
  });

  const send = (message) => proc.stdin.write(`${JSON.stringify(message)}\n`);
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      if (failure) {
        reject(failure);
        return;
      }
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("Codex didn't answer in time."));
      }, RPC_TIMEOUT);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      send({ id, method, params });
    });
  const server = {
    request,
    on: (method, listener) => listeners.set(method, listener),
    close: () => {
      proc.stdin.end();
      killTree(proc);
    },
  };

  try {
    await request("initialize", {
      clientInfo: {
        name: "excalidraw-codex-panel",
        title: "Excalidraw",
        version: "0.1.0",
      },
    });
    send({ method: "initialized" });
  } catch (e) {
    server.close();
    throw e;
  }
  return server;
};

const withAppServer = async (use) => {
  const server = await openAppServer();
  try {
    return await use(server);
  } finally {
    server.close();
  }
};

/** a value kept for a while; failures and rejected answers are not kept */
const cached = (load, keep) => {
  let entry = null;
  const get = () => {
    if (entry && Date.now() - entry.at < CACHE_TTL) {
      return entry.value;
    }
    const next = { at: Date.now(), value: load() };
    entry = next;
    const drop = () => {
      if (entry === next) {
        entry = null;
      }
    };
    next.value.then((value) => keep(value) || drop(), drop);
    return next.value;
  };
  get.clear = () => (entry = null);
  return get;
};

const getAccount = cached(
  () =>
    withAppServer(async (server) =>
      toAccount(await server.request("account/read", {})),
    ),
  // signed-out answers aren't kept, so a fresh sign-in shows up at once
  (account) => account.loggedIn,
);

const getModels = cached(
  () =>
    withAppServer(async (server) => {
      const rows = [];
      let cursor = null;
      do {
        const page = await server.request("model/list", { cursor });
        rows.push(...(page.data ?? []));
        cursor = page.nextCursor;
      } while (cursor && rows.length < 200);
      return toModelChoices(rows);
    }),
  (models) => models.length > 0,
);

const forgetAccount = () => {
  getAccount.clear();
  getModels.clear();
};

// sign-in -----------------------------------------------------------------------

/** the app server that waits for the browser to come back from ChatGPT */
let login = null;

const endLogin = () => {
  if (login) {
    clearTimeout(login.timer);
    login.server.close();
    login = null;
  }
};

/** resolves with the page the user must approve access on */
const startLogin = async () => {
  endLogin();
  const server = await openAppServer();
  const entry = { server, timer: setTimeout(endLogin, LOGIN_TIMEOUT) };
  login = entry;
  const finish = () => {
    forgetAccount();
    if (login === entry) {
      endLogin();
    }
  };
  server.on("account/login/completed", finish);
  server.on("closed", finish);
  try {
    const result = await server.request("account/login/start", {
      type: "chatgpt",
    });
    if (!result?.authUrl?.startsWith("https://")) {
      throw new Error("Codex didn't return a sign-in link.");
    }
    return result.authUrl;
  } catch (e) {
    finish();
    throw e;
  }
};

const logout = async () => {
  endLogin();
  await withAppServer((server) => server.request("account/logout"));
  forgetAccount();
};

// chat --------------------------------------------------------------------------

const clip = (text) =>
  text.length > MAX_TEXT_CHARS
    ? `${text.slice(0, MAX_TEXT_CHARS)}\n… (truncated)`
    : text;

/** Codex has no PDF input and no file tools here: send the PDF's text */
const readPdf = async (file) => {
  const { extractText, getDocumentProxy } = await import("unpdf");
  let text = "";
  try {
    const pdf = await getDocumentProxy(
      new Uint8Array(Buffer.from(file.data, "base64")),
    );
    ({ text } = await extractText(pdf, { mergePages: true }));
  } catch {
    throw new Error(`Couldn't read ${file.name}: is it a valid PDF?`);
  }
  if (!text.trim()) {
    throw new Error(
      `${file.name} has no text Codex can read (a scan?). Attach its pages as images instead.`,
    );
  }
  return text;
};

/** text and PDFs go into the prompt; images are saved and attached */
export const buildInput = async (request, attachments, folder) => {
  const texts = [];
  const images = [];
  for (const [i, file] of attachments.entries()) {
    if (file.kind === "image") {
      mkdirSync(folder, { recursive: true, mode: 0o700 });
      const safe = file.name.replace(/[^\w.-]+/g, "_").slice(-80);
      const target = path.join(folder, `${i + 1}-${safe}`);
      writeFileSync(target, Buffer.from(file.data, "base64"), { mode: 0o600 });
      images.push({ type: "local_image", path: target });
    } else {
      const body =
        file.kind === "pdf"
          ? await readPdf(file)
          : Buffer.from(file.data, "base64").toString("utf8");
      texts.push(`Attached file "${file.name}":\n\n${clip(body)}`);
    }
  }
  return [{ type: "text", text: [...texts, request].join("\n\n") }, ...images];
};

const loadSdk = async () => {
  try {
    return await import("@openai/codex-sdk");
  } catch {
    return null;
  }
};

export const createCodex = ({
  prefix,
  multiuser,
  mcpOrigin,
  sendJson,
  readBody,
}) => {
  const base = `${prefix}/codex`;
  /** the running turn: its secret MCP address and where canvas ops go */
  let turn = null;

  const friendlyError = (code, detail) => {
    switch (code) {
      case "authentication_failed":
        return "Codex isn't signed in (or the sign-in expired). Sign in and try again.";
      case "rate_limit":
        return "Your Codex usage limit was reached. Try again later.";
      case "model_not_found":
        return "Your ChatGPT plan can't use this model. Pick another one.";
      default:
        return detail ? String(detail).slice(0, 400) : `Codex error: ${code}`;
    }
  };

  const handleMcp = async (req, res, token) => {
    // browsers send Origin; only the local Codex process belongs here
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
    if (sessionId && !isThreadId(sessionId)) {
      return sendJson(res, 400, { error: "Unknown conversation" });
    }
    if (turn) {
      return sendJson(res, 429, {
        error: "Codex is still answering your previous message.",
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

    const abort = new AbortController();
    res.on("close", () => abort.abort());
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    const timer = setTimeout(() => {
      fail("bridge", "Codex took too long and was stopped.");
      abort.abort();
    }, TURN_TIMEOUT);

    const translator = createTranslator({
      emit,
      friendlyError,
      model: model && model !== "default" ? model : undefined,
      sessionId,
      onViolation: (what) => {
        fail(
          "bridge",
          `Stopped: Codex tried ${what}, which the canvas doesn't allow.`,
        );
        abort.abort();
      },
    });

    try {
      const sdk = await loadSdk();
      if (!sdk) {
        fail("bridge", NOT_INSTALLED);
        return;
      }
      makeFolders();
      const input = await buildInput(
        `${summarizeScene(scene)}\n\n---\nUser request:\n${message}`,
        attachments,
        uploads,
      );
      const codex = new sdk.Codex({
        codexPathOverride: CODEX_BIN || undefined,
        env: codexEnv(),
        config: codexConfig({
          mcpUrl: `${mcpOrigin}${base}/mcp/${current.token}`,
          instructions: INSTRUCTIONS,
        }),
      });
      const options = codexThreadOptions({ model, workDir: WORK_DIR });
      const thread = sessionId
        ? codex.resumeThread(sessionId, options)
        : codex.startThread(options);
      const { events } = await thread.runStreamed(input, {
        signal: abort.signal,
      });
      for await (const event of events) {
        if (abort.signal.aborted) {
          break;
        }
        translator.handle(event);
      }
      if (!translator.finished && !abort.signal.aborted) {
        fail("bridge", "Codex ended without an answer.");
      }
    } catch (e) {
      // a failed turn also makes the CLI exit with an error: report it once
      if (!abort.signal.aborted && !translator.finished) {
        const detail = errorText(e?.message);
        const code = errorCodeFor(detail);
        fail(code === "agent_error" ? "bridge" : code, detail);
        if (code === "authentication_failed") {
          forgetAccount();
        }
      }
    } finally {
      clearTimeout(timer);
      if (turn === current) {
        turn = null;
      }
      rmSync(uploads, { recursive: true, force: true });
      res.end();
    }
  };

  /** true when the request was a Codex one (and is now handled) */
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
        forgetAccount();
      }
      const installed = !!(await loadSdk());
      let account = { loggedIn: false, email: null, plan: null };
      if (installed) {
        try {
          account = await getAccount();
        } catch (e) {
          console.error("codex status:", e?.message || e);
        }
      }
      sendJson(res, 200, { mode: "local", installed, ...account });
    } else if (req.method === "GET" && route === "models") {
      try {
        sendJson(res, 200, { models: await getModels() });
      } catch (e) {
        console.error("codex models:", e?.message || e);
        sendJson(res, 500, { error: "Couldn't load the model list." });
      }
    } else if (req.method === "POST" && route === "auth/login") {
      try {
        sendJson(res, 200, { url: await startLogin() });
      } catch (e) {
        sendJson(res, 500, { error: String(e.message || e) });
      }
    } else if (req.method === "POST" && route === "auth/logout") {
      try {
        await logout();
        sendJson(res, 200, { loggedIn: false });
      } catch (e) {
        sendJson(res, 500, { error: String(e.message || e) });
      }
    } else if (req.method === "POST" && route === "chat") {
      await handleChat(req, res);
    } else {
      sendJson(res, 404, { error: "Not found" });
    }
    return true;
  };
};
