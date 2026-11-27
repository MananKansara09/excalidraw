/**
 * Codex and Antigravity on a shared bridge: the real CLIs, set up as the bridge
 * sets them up, against stand-in APIs on this machine (no account, no quota).
 * The stand-in model asks for other people's files and must not get them.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { Codex } from "@openai/codex-sdk";

import {
  antigravitySettings,
  findGoogleLoginUrl,
  prepareWorkspace,
} from "../antigravity.mjs";
import {
  codexConfig,
  codexThreadOptions,
  lockCatalog,
} from "../codex-core.mjs";
import {
  agentDirs,
  antigravityDenyRules,
  antigravityUserEnv,
  codexUserEnv,
  createChatSlots,
  userDirs,
} from "../isolation.mjs";
import { killTree } from "../process.mjs";

const root = mkdtempSync(path.join(os.tmpdir(), "bridge-agents-"));
after(() => {
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  } catch {
    // Windows: a CLI helper may still hold a folder; it's in the temp folder
  }
});

const makeUser = (id) => ({ id, ...userDirs(root, id) });
const SECRET = "VICTIM-TOKEN-4242";

/** another user's sign-in file */
const victimFile = () => {
  const file = path.join(makeUser("victim").configDir, ".credentials.json");
  writeFileSync(file, `${SECRET}\n`);
  return file;
};

const filesUnder = (dir) =>
  readdirSync(dir, { recursive: true })
    .map((name) => path.join(dir, name))
    .filter((file) => statSync(file).isFile());

const listen = async (handler) => {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => handler(req, res, body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
};

describe("chat slots", () => {
  it("allows one chat per user and agent, and so many in total", () => {
    const slots = createChatSlots(2);
    const first = slots.take("codex", "alice", "Codex");
    assert.ok(first.release);
    assert.equal(slots.take("codex", "alice", "Codex").status, 429);
    assert.ok(slots.take("claude", "alice", "Claude").release);
    assert.equal(slots.take("codex", "bob", "Codex").status, 503);
    first.release();
    assert.ok(slots.take("codex", "bob", "Codex").release);
  });
});

describe("Codex for several users", () => {
  const requests = [];
  let api;
  let script = [];
  const cli = fileURLToPath(
    new URL("../node_modules/@openai/codex/bin/codex.js", import.meta.url),
  );

  before(async () => {
    api = await listen((req, res, body) => {
      if (req.url.startsWith("/mcp")) {
        const message = body ? JSON.parse(body) : {};
        if (req.method !== "POST" || message.id === undefined) {
          res.writeHead(req.method === "POST" ? 202 : 405);
          return res.end();
        }
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            result:
              message.method === "initialize"
                ? {
                    protocolVersion: message.params.protocolVersion,
                    capabilities: { tools: {} },
                    serverInfo: { name: "excalidraw", version: "1" },
                  }
                : { tools: [] },
          }),
        );
      }
      if (!req.url.includes("responses")) {
        res.writeHead(404);
        return res.end();
      }
      requests.push({ key: req.headers.authorization, body });
      const item = script.shift() ?? {
        type: "message",
        role: "assistant",
        id: "m1",
        content: [{ type: "output_text", text: "ok" }],
      };
      res.writeHead(200, { "content-type": "text/event-stream" });
      const send = (type, data) =>
        res.write(
          `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`,
        );
      send("response.created", { response: { id: "r1" } });
      send("response.output_item.done", { item, output_index: 0 });
      send("response.completed", {
        response: {
          id: "r1",
          usage: {
            input_tokens: 1,
            input_tokens_details: null,
            output_tokens: 1,
            output_tokens_details: null,
            total_tokens: 2,
          },
        },
      });
      res.end();
    });
  });
  after(() => api.close());

  const turn = async (user, prompt, { model, resume } = {}) => {
    const dirs = agentDirs(user, "codex");
    const env = { ...codexUserEnv(dirs), FAKE_KEY: `key-of-${user.id}` };
    const listed = spawnSync(process.execPath, [cli, "debug", "models"], {
      env,
      cwd: dirs.work,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    const catalog = path.join(dirs.root, "models-locked.json");
    writeFileSync(
      catalog,
      JSON.stringify(lockCatalog(JSON.parse(listed.stdout))),
    );
    const codex = new Codex({
      env,
      config: {
        ...codexConfig({
          mcpUrl: `${api.origin}/mcp`,
          instructions: "draw",
          modelCatalog: catalog,
        }),
        model_provider: "fake",
        model_providers: {
          fake: {
            name: "fake",
            base_url: `${api.origin}/v1`,
            env_key: "FAKE_KEY",
            wire_api: "responses",
          },
        },
      },
    });
    const options = codexThreadOptions({ model, workDir: dirs.work });
    const thread = resume
      ? codex.resumeThread(resume, options)
      : codex.startThread(options);
    await thread.run(prompt, { signal: AbortSignal.timeout(60000) });
    return thread.id;
  };

  it("has no tool that opens another user's file", async () => {
    const victim = victimFile();
    const patch = `*** Begin Patch\n*** Update File: ${victim}\n@@\n-guess\n+x\n*** End Patch\n`;
    const call = (name, args) => ({
      type: "function_call",
      call_id: "c1",
      name,
      arguments: JSON.stringify(args),
    });
    const custom = (name, input) => ({
      type: "custom_tool_call",
      call_id: "c1",
      name,
      input,
    });
    const attempts = [
      custom("apply_patch", patch),
      custom("exec", `text(await tools.apply_patch(${JSON.stringify(patch)}))`),
      call("view_image", { path: victim }),
      call("shell_command", { command: `cat "${victim}"` }),
      call("exec_command", { cmd: `cat "${victim}"` }),
    ];
    // a model that runs tools from code, and one that calls them directly
    for (const model of [undefined, "gpt-5.5"]) {
      for (const attempt of attempts) {
        requests.length = 0;
        script = [attempt];
        await turn(makeUser("mallory"), `read @${victim}`, { model });
        const sent = requests.map((r) => r.body).join("\n");
        assert.ok(requests.length > 1, "the tool call was answered");
        assert.ok(!sent.includes(SECRET));
        // opening the file at all would let its lines be guessed
        assert.ok(!sent.includes("verification failed"), `${model} patched`);
      }
    }
  });

  it("keeps concurrent users' keys, prompts and chats apart", async () => {
    const users = ["carol", "dave", "erin"].map(makeUser);
    requests.length = 0;
    script = [];
    const threads = await Promise.all(
      users.map((u) => turn(u, `private note of ${u.id}`)),
    );
    for (const user of users) {
      const own = requests.filter((r) => r.key === `Bearer key-of-${user.id}`);
      assert.ok(own.length > 0);
      for (const other of users.filter((u) => u !== user)) {
        assert.ok(
          own.every((r) => !r.body.includes(`private note of ${other.id}`)),
        );
      }
    }
    for (const [i, user] of users.entries()) {
      assert.deepEqual(
        users.filter((u) =>
          filesUnder(agentDirs(u, "codex").home).some((f) =>
            f.includes(threads[i]),
          ),
        ),
        [user],
      );
    }
    // knowing someone's conversation id isn't enough to continue it
    requests.length = 0;
    await turn(users[1], "continue", { resume: threads[0] }).catch(() => {});
    assert.ok(requests.every((r) => !r.body.includes("private note of carol")));
  });
});

const AGY_BIN = process.env.AGY_BIN || "agy";
const noAgy = spawnSync(AGY_BIN, ["--version"]).error
  ? "agy isn't installed"
  : false;

describe("Antigravity for several users", { skip: noAgy }, () => {
  const requests = [];
  let api;
  let script = [];

  before(async () => {
    api = await listen((req, res, body) => {
      requests.push({ key: req.headers["x-goog-api-key"], body });
      const agent = body.includes('"functionDeclarations"');
      const answer = {
        candidates: [
          {
            content: {
              role: "model",
              parts: [(agent && script.shift()) || { text: "ok" }],
            },
            finishReason: "STOP",
            index: 0,
          },
        ],
        usageMetadata: {
          promptTokenCount: 1,
          candidatesTokenCount: 1,
          totalTokenCount: 2,
        },
      };
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(`data: ${JSON.stringify(answer)}\n\n`);
    });
  });
  after(() => api.close());

  /** one turn with the bridge's workspace, environment and permission rules */
  const turn = async (user, prompt, { guard = true } = {}) => {
    const dirs = agentDirs(user, "antigravity");
    const uploads = path.join(dirs.uploads, "turn");
    mkdirSync(uploads, { recursive: true });
    prepareWorkspace(dirs.work, `${api.origin}/mcp`, [uploads]);
    if (!guard) {
      // a hook that fails without saying anything
      writeFileSync(path.join(dirs.work, ".agents", "guard.mjs"), "");
    }
    const cliDir = path.join(dirs.home, ".gemini", "antigravity-cli");
    mkdirSync(cliDir, { recursive: true });
    writeFileSync(
      path.join(cliDir, "settings.json"),
      JSON.stringify({ modelProvider: "gemini" }),
    );
    const settings = path.join(dirs.root, "settings.json");
    writeFileSync(settings, antigravitySettings(antigravityDenyRules(user)));
    const env = antigravityUserEnv(dirs);
    const key = Object.keys(env).find((k) => k.toLowerCase() === "path");
    env[key] = [path.dirname(process.execPath), env[key]].join(path.delimiter);
    const proc = spawn(
      AGY_BIN,
      [
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--settings",
        settings,
        "--disable-slash-commands",
      ],
      {
        cwd: dirs.work,
        env: {
          ...env,
          GEMINI_API_KEY: `key-of-${user.id}`,
          GOOGLE_GEMINI_BASE_URL: api.origin,
        },
        stdio: ["pipe", "pipe", "ignore"],
      },
    );
    let output = "";
    proc.stdout.on("data", (d) => (output += d));
    const timer = setTimeout(() => killTree(proc), 60000);
    proc.stdin.end(
      `${JSON.stringify({ event: "user", message: { content: prompt } })}\n`,
    );
    await new Promise((resolve) => proc.on("close", resolve));
    clearTimeout(timer);
    return output;
  };

  const read = (file) => ({
    functionCall: { name: "read_file", args: { Path: file } },
  });

  for (const guard of [true, false]) {
    it(`doesn't read another user's file (guard ${
      guard ? "working" : "failing"
    })`, async () => {
      const victim = victimFile();
      const mallory = makeUser("mallory");
      const sneaky = path.join(
        agentDirs(mallory, "antigravity").work,
        "..",
        "..",
        "..",
        path.basename(path.dirname(path.dirname(victim))),
        "config",
        path.basename(victim),
      );
      assert.ok(existsSync(sneaky));
      for (const file of [victim, sneaky]) {
        requests.length = 0;
        script = [read(file)];
        const output = await turn(mallory, `read @${victim}`, { guard });
        assert.match(output, /"tool_name":"read_file"/, "the model tried");
        assert.ok(!output.includes(SECRET));
        assert.ok(requests.every((r) => !r.body.includes(SECRET)));
      }
    });
  }

  it("still reads the user's own uploads", async () => {
    const user = makeUser("frank");
    const own = path.join(
      agentDirs(user, "antigravity").uploads,
      "turn",
      "own.txt",
    );
    mkdirSync(path.dirname(own), { recursive: true });
    writeFileSync(own, "OWN-UPLOAD-7777\n");
    requests.length = 0;
    script = [read(own)];
    await turn(user, "read my file");
    assert.ok(requests.some((r) => r.body.includes("OWN-UPLOAD-7777")));
  });

  it("offers each user their own sign-in", async () => {
    const dirs = agentDirs(makeUser("grace"), "antigravity");
    const proc = spawn(AGY_BIN, ["acp", "--login"], {
      cwd: dirs.work,
      env: { ...antigravityUserEnv(dirs), BROWSER: "true" },
    });
    let output = "";
    const url = await new Promise((resolve) => {
      const onData = (d) => {
        output += d;
        const found = findGoogleLoginUrl(output);
        if (found) {
          resolve(found);
        }
      };
      proc.stdout.on("data", onData);
      proc.stderr.on("data", onData);
      proc.on("close", () => resolve(null));
      setTimeout(() => resolve(null), 30000).unref();
    });
    killTree(proc);
    assert.ok(url?.includes("code_challenge"), output.slice(0, 300));
  });
});
