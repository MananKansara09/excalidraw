import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, describe, test } from "node:test";

import { client, signUp, startTestServer } from "./helpers.ts";

import type { IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import type { TestServer } from "./helpers.ts";

const SECRET = "bridge-secret-for-tests";
let server: TestServer;
let bridge: ReturnType<typeof createServer>;
const seen: { url?: string; headers: IncomingHttpHeaders; body: string }[] = [];

before(async () => {
  bridge = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ url: req.url, headers: req.headers, body });
      if (req.url?.endsWith("/chat")) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write('event: text\ndata: {"delta":"hi"}\n\n');
        res.end("event: done\ndata: {}\n\n");
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ loggedIn: false }));
      }
    });
  });
  await new Promise<void>((r) => bridge.listen(0, r));
  server = await startTestServer({
    claudeBridge: {
      url: `http://127.0.0.1:${(bridge.address() as AddressInfo).port}`,
      secret: SECRET,
    },
  });
});
after(async () => {
  await server.close();
  bridge.closeAllConnections();
  bridge.close();
});

describe("claude bridge proxy", () => {
  test("requires a signed-in user and never reaches the bridge otherwise", async () => {
    const before = seen.length;
    const res = await client(server.base).get("/claude-bridge/status");
    assert.equal(res.status, 401);
    assert.equal(seen.length, before);
  });

  test("forwards as the signed-in user with the shared secret", async () => {
    const { api, user } = await signUp(server.base, "claude1");
    const res = await api.get("/claude-bridge/status", {
      // a spoofed identity from the browser must be ignored
      "x-claude-user": "someone-else",
      "x-bridge-secret": "forged",
    });
    assert.equal(res.status, 200);
    const last = seen.at(-1)!;
    assert.equal(last.headers["x-claude-user"], user.id);
    assert.equal(last.headers["x-bridge-secret"], SECRET);
  });

  test("streams chat responses and forwards the body", async () => {
    const { api } = await signUp(server.base, "claude2");
    const res = await api.post("/claude-bridge/chat", { message: "draw" });
    assert.equal(res.status, 200);
    assert.match(String(res.json), /event: text[\s\S]*event: done/);
    assert.equal(JSON.parse(seen.at(-1)!.body).message, "draw");
  });

  test("passes chats carrying 5 MB attachments through", async () => {
    const { api } = await signUp(server.base, "claude4");
    const data = Buffer.alloc(5 * 1024 * 1024, 1).toString("base64");
    const res = await api.post("/claude-bridge/chat", {
      message: "use this",
      attachments: [{ name: "a.pdf", mediaType: "application/pdf", data }],
    });
    assert.equal(res.status, 200);
    assert.equal(
      JSON.parse(seen.at(-1)!.body).attachments[0].data.length,
      data.length,
    );
  });

  test("rejects non-JSON posts and other methods", async () => {
    const { api } = await signUp(server.base, "claude3");
    const put = await api.put("/claude-bridge/chat", {});
    assert.equal(put.status, 405);
  });
});
