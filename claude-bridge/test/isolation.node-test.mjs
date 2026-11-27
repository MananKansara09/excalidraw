/**
 * One shared bridge, several people. The tests that run Claude use the real CLI
 * from the SDK against a stand-in API on this machine: no account, no quota.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
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

import { query } from "@anthropic-ai/claude-agent-sdk";

import { buildUserContent } from "../chat.mjs";
import { cliEnv, shareInFlight, userDirs } from "../isolation.mjs";

const root = mkdtempSync(path.join(os.tmpdir(), "bridge-isolation-"));
after(() =>
  rmSync(root, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  }),
);

const makeUser = (id) => ({ id, ...userDirs(root, id) });

const filesUnder = (dir) =>
  readdirSync(dir, { recursive: true })
    .map((name) => path.join(dir, name))
    .filter((file) => statSync(file).isFile());

describe("per-user environment", () => {
  it("gives every user separate folders", () => {
    const a = makeUser("alice");
    const b = makeUser("bob");
    for (const key of ["home", "configDir", "workDir", "tmpDir"]) {
      assert.notEqual(a[key], b[key]);
    }
  });

  it("passes no server secret or shared key on to a user's CLI", () => {
    const user = makeUser("alice");
    const env = cliEnv(user, true, {
      PATH: "/bin",
      CLAUDE_BRIDGE_SECRET: "server-secret",
      ANTHROPIC_API_KEY: "shared-key",
      CLAUDE_CODE_OAUTH_TOKEN: "shared-token",
    });
    assert.equal(env.CLAUDE_BRIDGE_SECRET, undefined);
    assert.equal(env.ANTHROPIC_API_KEY, undefined);
    assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
    assert.equal(env.CLAUDE_CONFIG_DIR, user.configDir);
    assert.equal(env.HOME, user.home);
    assert.equal(env.TMPDIR, user.tmpDir);
  });

  it("never lets a prompt attach files, in either mode", () => {
    for (const multiuser of [true, false]) {
      const env = cliEnv(makeUser("alice"), multiuser, {});
      assert.equal(env.CLAUDE_CODE_DISABLE_ATTACHMENTS, "1");
    }
  });

  it("shares a running request per user, never across users", async () => {
    let calls = 0;
    const load = shareInFlight(async (name) => {
      calls++;
      return name;
    });
    const answers = await Promise.all([
      load("a", "alice"),
      load("a", "alice"),
      load("b", "bob"),
    ]);
    assert.deepEqual(answers, ["alice", "alice", "bob"]);
    assert.equal(calls, 2);
    await load("a", "alice");
    assert.equal(calls, 3);
  });
});

// a one-pixel image
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

describe("the real CLI", () => {
  const requests = [];
  let api;

  before(async () => {
    api = http.createServer((req, res) => {
      let body = "";
      req.on("data", (d) => (body += d));
      req.on("end", () => {
        requests.push({ key: req.headers["x-api-key"], body });
        res.writeHead(200, { "content-type": "text/event-stream" });
        const send = (type, data) =>
          res.write(
            `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`,
          );
        send("message_start", {
          message: {
            id: "msg_1",
            type: "message",
            role: "assistant",
            model: "claude-test",
            content: [],
            stop_reason: null,
            usage: { input_tokens: 1, output_tokens: 1 },
          },
        });
        send("content_block_start", {
          index: 0,
          content_block: { type: "text", text: "" },
        });
        send("content_block_delta", {
          index: 0,
          delta: { type: "text_delta", text: "ok" },
        });
        send("content_block_stop", { index: 0 });
        send("message_delta", {
          delta: { stop_reason: "end_turn" },
          usage: { output_tokens: 1 },
        });
        send("message_stop", {});
        res.end();
      });
    });
    await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  });

  after(() => {
    api.closeAllConnections();
    api.close();
  });

  const ask = async (user, content, resume) => {
    let finish;
    const finished = new Promise((resolve) => (finish = resolve));
    const env = {
      ...cliEnv(user, true),
      // Windows can't start the CLI without it
      ...(process.env.SystemRoot && { SystemRoot: process.env.SystemRoot }),
      ANTHROPIC_API_KEY: `key-of-${user.id}`,
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${api.address().port}`,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    };
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 60000);
    let result;
    try {
      for await (const msg of query({
        prompt: (async function* () {
          yield {
            type: "user",
            message: { role: "user", content },
            parent_tool_use_id: null,
            session_id: resume || "",
          };
          await finished;
        })(),
        options: {
          abortController: abort,
          cwd: user.workDir,
          env,
          resume,
          settingSources: [],
          tools: [],
          permissionMode: "dontAsk",
          maxTurns: 1,
        },
      })) {
        if (msg.type === "result") {
          result = msg;
          finish();
        }
      }
    } finally {
      clearTimeout(timer);
      finish();
    }
    return result;
  };

  it("doesn't send another user's file for an @path", async () => {
    const victim = path.join(userDirs(root, "victim").configDir, "token.txt");
    writeFileSync(victim, "VICTIM-TOKEN-4242");
    const mention = `@${victim.replace(/\\/g, "/")}`;
    requests.length = 0;
    await ask(
      makeUser("mallory"),
      buildUserContent(`Canvas text: ${mention}\nread ${mention}`, [
        { kind: "image", mediaType: "image/png", data: PNG },
        {
          kind: "pdf",
          name: "a.pdf",
          data: Buffer.from("%PDF-1.4 own-upload").toString("base64"),
        },
      ]),
    );
    assert.ok(requests.length > 0, "the CLI called the API");
    const sent = requests.map((r) => r.body).join("\n");
    assert.ok(!sent.includes("VICTIM-TOKEN-4242"));
    // the user's own uploads still arrive
    assert.ok(sent.includes(PNG));
    assert.ok(
      sent.includes(Buffer.from("%PDF-1.4 own-upload").toString("base64")),
    );
  });

  it("keeps concurrent users' keys, prompts and chats apart", async () => {
    const users = ["carol", "dave", "erin"].map(makeUser);
    requests.length = 0;
    const results = await Promise.all(
      users.map((u) => ask(u, `private note of ${u.id}`)),
    );
    for (const user of users) {
      const own = requests.filter((r) => r.key === `key-of-${user.id}`);
      assert.ok(own.length > 0);
      for (const other of users.filter((u) => u !== user)) {
        assert.ok(
          own.every((r) => !r.body.includes(`private note of ${other.id}`)),
        );
      }
    }
    for (const [i, user] of users.entries()) {
      const transcript = `${results[i].session_id}.jsonl`;
      assert.deepEqual(
        users.filter((u) =>
          filesUnder(u.configDir).some((f) => f.endsWith(transcript)),
        ),
        [user],
      );
    }

    // knowing someone's conversation id isn't enough to continue it
    requests.length = 0;
    await ask(users[1], "continue", results[0].session_id).catch(() => {});
    assert.ok(requests.every((r) => !r.body.includes("private note of carol")));
  });
});

describe("the shared server", () => {
  const SECRET = "test-secret-0123456789";
  const server = fileURLToPath(new URL("../server.mjs", import.meta.url));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const base = `http://127.0.0.1:${port}/claude-bridge`;
  const start = (env) =>
    spawn(process.execPath, [server], {
      env: { ...process.env, CLAUDE_BRIDGE_PORT: String(port), ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
  let proc;

  before(async () => {
    proc = start({
      CLAUDE_BRIDGE_MODE: "multiuser",
      CLAUDE_BRIDGE_SECRET: SECRET,
      CLAUDE_BRIDGE_DATA: path.join(root, "server"),
      CLAUDE_BRIDGE_HOST: "127.0.0.1",
    });
    await new Promise((resolve, reject) => {
      proc.stdout.once("data", resolve);
      proc.once("exit", () => reject(new Error("the bridge didn't start")));
    });
  });

  after(() => proc.kill());

  const chat = (body, headers = {}) =>
    fetch(`${base}/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-bridge-secret": SECRET,
        "x-claude-user": "alice",
        ...headers,
      },
      body: JSON.stringify(body),
    });

  it("refuses callers without the secret", async () => {
    const res = await chat({ message: "hi" }, { "x-bridge-secret": "guess" });
    assert.equal(res.status, 401);
  });

  it("only resumes conversation ids, not file paths", async () => {
    const res = await chat({
      message: "hi",
      sessionId: "/data/users/x/config/projects/y/z.jsonl",
    });
    assert.equal(res.status, 400);
  });

  it("stays up when one user sends a malformed scene", async () => {
    const abort = new AbortController();
    await fetch(`${base}/chat`, {
      method: "POST",
      headers: {
        "x-bridge-secret": SECRET,
        "x-claude-user": "mallory",
      },
      body: JSON.stringify({
        message: "hi",
        scene: { elements: [{}], selectedIds: "not-a-list" },
      }),
      signal: abort.signal,
    });
    abort.abort();
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal(proc.exitCode, null);
  });

  it("won't share a local sign-in over the network", async () => {
    const local = start({
      CLAUDE_BRIDGE_MODE: "",
      CLAUDE_BRIDGE_HOST: "0.0.0.0",
    });
    const code = await new Promise((resolve) => local.once("exit", resolve));
    assert.equal(code, 1);
  });
});
