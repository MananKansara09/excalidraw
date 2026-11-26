import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { mergeElements } from "../src/scenes.ts";
import { expandSimpleElements } from "../src/elements.ts";

import { client, element, signUp, startTestServer } from "./helpers.ts";

import type { TestServer, fakeAI } from "./helpers.ts";

let server: TestServer;

before(async () => {
  server = await startTestServer();
});
after(() => server.close());

describe("auth", () => {
  test("signs up, reads the session, signs out", async () => {
    const { api, user } = await signUp(server.base, "ada");
    assert.equal(user.email, "ada@example.com");
    assert.equal((await api.get("/api/v1/me")).json.user.id, user.id);
    await api.post("/api/v1/auth/logout");
    assert.equal((await api.get("/api/v1/me")).status, 401);
  });

  test("rejects duplicate emails and bad passwords", async () => {
    await signUp(server.base, "dup");
    const api = client(server.base);
    const again = await api.post("/api/v1/auth/signup", {
      email: "DUP@example.com",
      password: "another password",
    });
    assert.equal(again.status, 409);
    const login = await api.post("/api/v1/auth/login", {
      email: "dup@example.com",
      password: "wrong password",
    });
    assert.equal(login.status, 401);
    const unnamed = await api.post("/api/v1/auth/signup", {
      email: "grace.hopper@example.com",
      name: "  ",
      password: "another password",
    });
    assert.equal(unnamed.json.user.name, "grace.hopper");
    const short = await api.post("/api/v1/auth/signup", {
      email: "short@example.com",
      password: "123",
    });
    assert.equal(short.status, 400);
  });

  test("throttles repeated failed sign-ins", async () => {
    await signUp(server.base, "throttled");
    const api = client(server.base);
    const attempt = (password: string) =>
      api.post("/api/v1/auth/login", {
        email: "throttled@example.com",
        password,
      });
    for (let i = 0; i < 10; i++) {
      assert.equal((await attempt("wrong password")).status, 401);
    }
    // locked out even with the right password until the window passes
    assert.equal((await attempt("correct horse battery")).status, 429);
  });

  test("API keys authenticate REST calls and can be revoked", async () => {
    const { api } = await signUp(server.base, "keyholder");
    const created = await api.post("/api/v1/me/api-keys", { name: "CI" });
    assert.match(created.json.key, /^exk_/);
    const bearer = client(server.base, { bearer: created.json.key });
    assert.equal((await bearer.get("/api/v1/me")).status, 200);
    const listed = await api.get("/api/v1/me/api-keys");
    assert.equal(listed.json.apiKeys.length, 1);
    assert.ok(!("key" in listed.json.apiKeys[0]));
    await api.delete(`/api/v1/me/api-keys/${created.json.id}`);
    assert.equal((await bearer.get("/api/v1/me")).status, 401);
  });
});

describe("scenes and folders", () => {
  test("creates unlimited scenes in nested folders and lists them", async () => {
    const { api } = await signUp(server.base, "folders");
    const parent = (await api.post("/api/v1/folders", { name: "Work" })).json
      .folder;
    const child = (
      await api.post("/api/v1/folders", { name: "Q3", parentId: parent.id })
    ).json.folder;
    for (let i = 0; i < 30; i++) {
      const res = await api.post("/api/v1/scenes", {
        name: `Scene ${i}`,
        folderId: i % 2 ? child.id : null,
      });
      assert.equal(res.status, 200);
    }
    assert.equal((await api.get("/api/v1/scenes")).json.scenes.length, 30);
    assert.equal(
      (await api.get(`/api/v1/scenes?folderId=${child.id}`)).json.scenes.length,
      15,
    );
    assert.equal(
      (await api.get("/api/v1/scenes?folderId=root")).json.scenes.length,
      15,
    );
    assert.equal(
      (await api.get("/api/v1/scenes?q=Scene%201")).json.scenes.length,
      11,
    );
    // a folder can't move into its own child
    const loop = await api.patch(`/api/v1/folders/${parent.id}`, {
      parentId: child.id,
    });
    assert.equal(loop.status, 400);
    // deleting a folder keeps its scenes, at the root
    await api.delete(`/api/v1/folders/${parent.id}`);
    assert.equal(
      (await api.get("/api/v1/scenes?folderId=root")).json.scenes.length,
      30,
    );
  });

  test("saves content, merges concurrent edits by version", async () => {
    const { api } = await signUp(server.base, "saver");
    const scene = (
      await api.post("/api/v1/scenes", {
        name: "Merge",
        elements: [element("a", 1), element("b", 1)],
        appState: { viewBackgroundColor: "#fff", zoom: { value: 3 } },
        files: {
          f1: {
            id: "f1",
            mimeType: "image/png",
            dataURL: "data:image/png;base64,AA==",
          },
        },
      })
    ).json.scene;
    assert.deepEqual(scene.appState, { viewBackgroundColor: "#fff" });
    assert.equal(scene.files.f1.mimeType, "image/png");

    // a stale copy of "a" loses, a newer "b" wins, "c" is added
    const sync = await api.post(`/api/v1/scenes/${scene.id}/sync`, {
      elements: [
        element("a", 1, { versionNonce: 5 }),
        element("b", 3),
        element("c", 1),
      ],
    });
    assert.equal(sync.json.accepted, 2);
    const loaded = (await api.get(`/api/v1/scenes/${scene.id}`)).json.scene;
    assert.deepEqual(
      loaded.elements.map((e: any) => [e.id, e.version]),
      [
        ["a", 1],
        ["b", 3],
        ["c", 1],
      ],
    );
    assert.equal(loaded.version, sync.json.version);

    // PUT replaces: elements left out are deleted
    await api.put(`/api/v1/scenes/${scene.id}`, {
      elements: [element("a", 2)],
    });
    const replaced = (await api.get(`/api/v1/scenes/${scene.id}`)).json.scene;
    assert.deepEqual(
      replaced.elements.filter((e: any) => !e.isDeleted).map((e: any) => e.id),
      ["a"],
    );
  });

  test("duplicates, renames, stores presentation order, deletes", async () => {
    const { api } = await signUp(server.base, "renamer");
    const scene = (await api.post("/api/v1/scenes", { name: "One" })).json
      .scene;
    await api.patch(`/api/v1/scenes/${scene.id}`, {
      name: "Renamed",
      presentation: ["frame-2", "frame-1"],
    });
    const loaded = (await api.get(`/api/v1/scenes/${scene.id}`)).json.scene;
    assert.equal(loaded.name, "Renamed");
    assert.deepEqual(loaded.presentation, ["frame-2", "frame-1"]);
    const copy = (await api.post(`/api/v1/scenes/${scene.id}/duplicate`)).json
      .scene;
    assert.equal(copy.name, "Renamed (copy)");
    await api.delete(`/api/v1/scenes/${scene.id}`);
    assert.equal((await api.get(`/api/v1/scenes/${scene.id}`)).status, 404);
  });
});

describe("access management and sharing", () => {
  test("strangers can't see a scene; invited viewers can't edit", async () => {
    const { api: owner } = await signUp(server.base, "owner1");
    const { api: viewer, user: viewerUser } = await signUp(
      server.base,
      "viewer1",
    );
    const { api: stranger } = await signUp(server.base, "stranger1");
    const scene = (await owner.post("/api/v1/scenes", { name: "Private" })).json
      .scene;

    assert.equal(
      (await stranger.get(`/api/v1/scenes/${scene.id}`)).status,
      404,
    );
    assert.equal(
      (await client(server.base).get(`/api/v1/scenes/${scene.id}`)).status,
      401,
    );

    await owner.post(`/api/v1/scenes/${scene.id}/access`, {
      email: "viewer1@example.com",
      role: "viewer",
    });
    const asViewer = await viewer.get(`/api/v1/scenes/${scene.id}`);
    assert.equal(asViewer.json.scene.role, "viewer");
    assert.equal(
      (
        await viewer.post(`/api/v1/scenes/${scene.id}/sync`, {
          elements: [element("x")],
        })
      ).status,
      403,
    );
    assert.equal(
      (await viewer.get("/api/v1/scenes?scope=shared")).json.scenes.length,
      1,
    );
    // only the owner manages access
    assert.equal(
      (await viewer.get(`/api/v1/scenes/${scene.id}/access`)).status,
      403,
    );

    // upgrade to editor
    await owner.post(`/api/v1/scenes/${scene.id}/access`, {
      email: "viewer1@example.com",
      role: "editor",
    });
    assert.equal(
      (
        await viewer.post(`/api/v1/scenes/${scene.id}/sync`, {
          elements: [element("x")],
        })
      ).status,
      200,
    );
    await owner.delete(`/api/v1/scenes/${scene.id}/access/${viewerUser.id}`);
    assert.equal((await viewer.get(`/api/v1/scenes/${scene.id}`)).status, 404);
  });

  test("read-only and edit links work signed-out and can be revoked", async () => {
    const { api: owner } = await signUp(server.base, "linker");
    const scene = (await owner.post("/api/v1/scenes", { name: "Linked" })).json
      .scene;
    const access = (
      await owner.post(`/api/v1/scenes/${scene.id}/links`, { role: "viewer" })
    ).json;
    const viewLink = access.links[0];
    // every access endpoint answers with the same shape
    assert.equal(access.owner.name, "linker");
    assert.deepEqual(
      Object.keys(access).sort(),
      Object.keys(
        (await owner.get(`/api/v1/scenes/${scene.id}/access`)).json,
      ).sort(),
    );
    assert.equal(viewLink.url, `http://app.test/#share=${viewLink.token}`);

    const anon = client(server.base);
    const resolved = await anon.get(`/api/v1/share/${viewLink.token}`);
    assert.deepEqual(resolved.json, { sceneId: scene.id, role: "viewer" });
    const headers = { "X-Share-Token": viewLink.token };
    assert.equal(
      (await anon.get(`/api/v1/scenes/${scene.id}`, headers)).json.scene.role,
      "viewer",
    );
    assert.equal(
      (
        await anon.post(
          `/api/v1/scenes/${scene.id}/sync`,
          { elements: [element("y")] },
          headers,
        )
      ).status,
      403,
    );

    const edit = (
      await owner.post(`/api/v1/scenes/${scene.id}/links`, { role: "editor" })
    ).json.links.find((l: any) => l.role === "editor");
    assert.equal(
      (
        await anon.post(
          `/api/v1/scenes/${scene.id}/sync`,
          { elements: [element("y")] },
          {
            "X-Share-Token": edit.token,
          },
        )
      ).status,
      200,
    );
    // a token for one scene doesn't open another
    const other = (await owner.post("/api/v1/scenes", { name: "Other" })).json
      .scene;
    assert.equal(
      (await anon.get(`/api/v1/scenes/${other.id}`, headers)).status,
      401,
    );

    await owner.delete(`/api/v1/scenes/${scene.id}/links/${viewLink.token}`);
    assert.equal(
      (await anon.get(`/api/v1/scenes/${scene.id}`, headers)).status,
      401,
    );
  });
});

describe("teams", () => {
  test("invites existing users and pending emails, enforces roles", async () => {
    const { api: owner } = await signUp(server.base, "teamowner");
    const { api: member, user: memberUser } = await signUp(
      server.base,
      "teammember",
    );
    const team = (await owner.post("/api/v1/teams", { name: "Design" })).json
      .team;
    assert.equal(team.role, "owner");

    const invited = await owner.post(`/api/v1/teams/${team.id}/invites`, {
      email: "teammember@example.com",
    });
    assert.equal(invited.json.added, true);
    const pending = await owner.post(`/api/v1/teams/${team.id}/invites`, {
      email: "later@example.com",
      role: "admin",
    });
    assert.equal(pending.json.team.invites.length, 1);

    // a pending invite becomes a membership on signup
    const { api: later } = await signUp(server.base, "later");
    const laterTeams = (await later.get("/api/v1/teams")).json.teams;
    assert.deepEqual(
      laterTeams.map((t: any) => [t.name, t.role]),
      [["Design", "admin"]],
    );

    // members edit team scenes but can't manage the team
    const scene = (
      await owner.post("/api/v1/scenes", {
        name: "Team scene",
        teamId: team.id,
      })
    ).json.scene;
    assert.equal(
      (await member.get(`/api/v1/scenes/${scene.id}`)).json.scene.role,
      "editor",
    );
    assert.equal(
      (await member.get(`/api/v1/scenes?teamId=${team.id}`)).json.scenes.length,
      1,
    );
    assert.equal(
      (
        await member.post(`/api/v1/teams/${team.id}/invites`, {
          email: "x@example.com",
        })
      ).status,
      403,
    );
    // admins can't demote the only owner
    const { user: ownerUser } = (await owner.get("/api/v1/me")).json;
    assert.equal(
      (
        await later.patch(`/api/v1/teams/${team.id}/members/${ownerUser.id}`, {
          role: "member",
        })
      ).status,
      403,
    );
    assert.equal(
      (await owner.delete(`/api/v1/teams/${team.id}/members/${ownerUser.id}`))
        .status,
      400,
    );
    // removing a member revokes their access to team scenes
    await owner.delete(`/api/v1/teams/${team.id}/members/${memberUser.id}`);
    assert.equal((await member.get(`/api/v1/scenes/${scene.id}`)).status, 404);
  });
});

describe("comments", () => {
  test("threads, replies, resolve permissions", async () => {
    const { api: owner } = await signUp(server.base, "commenter");
    const { api: viewer } = await signUp(server.base, "commentviewer");
    const scene = (await owner.post("/api/v1/scenes", { name: "Discuss" })).json
      .scene;
    await owner.post(`/api/v1/scenes/${scene.id}/access`, {
      email: "commentviewer@example.com",
      role: "viewer",
    });
    const thread = (
      await viewer.post(`/api/v1/scenes/${scene.id}/comments`, {
        body: "Is this right?",
        elementId: "el1",
        x: 10,
        y: 20,
      })
    ).json.comment;
    assert.equal(thread.author.name, "commentviewer");
    const reply = await owner.post(`/api/v1/scenes/${scene.id}/comments`, {
      body: "Yes",
      parentId: thread.id,
    });
    assert.equal(reply.status, 200);
    // no nested replies
    assert.equal(
      (
        await owner.post(`/api/v1/scenes/${scene.id}/comments`, {
          body: "nested",
          parentId: reply.json.comment.id,
        })
      ).status,
      400,
    );
    // viewers can't edit others' comments; the owner resolves
    assert.equal(
      (
        await viewer.patch(`/api/v1/comments/${reply.json.comment.id}`, {
          body: "No",
        })
      ).status,
      403,
    );
    const resolved = await owner.patch(`/api/v1/comments/${thread.id}`, {
      resolved: true,
    });
    assert.equal(resolved.json.comment.resolved, true);
    // deleting a thread removes its replies
    await owner.delete(`/api/v1/comments/${thread.id}`);
    assert.equal(
      (await owner.get(`/api/v1/scenes/${scene.id}/comments`)).json.comments
        .length,
      0,
    );
  });
});

describe("realtime", () => {
  test("streams presence, scene updates and relays signals", async () => {
    const { api } = await signUp(server.base, "streamer");
    const scene = (await api.post("/api/v1/scenes", { name: "Live" })).json
      .scene;
    const access = (
      await api.post(`/api/v1/scenes/${scene.id}/links`, { role: "editor" })
    ).json;
    const token = access.links[0].token;

    const open = async (name: string) => {
      const controller = new AbortController();
      const res = await fetch(
        `${server.base}/api/v1/scenes/${scene.id}/events?share=${token}&name=${name}`,
        { signal: controller.signal },
      );
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const events: { event: string; data: any }[] = [];
      const next = async (type: string) => {
        for (;;) {
          const found = events.findIndex((e) => e.event === type);
          if (found >= 0) {
            return events.splice(found, 1)[0].data;
          }
          const { value, done } = await reader.read();
          if (done) {
            throw new Error("stream ended");
          }
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop()!;
          for (const part of parts) {
            const event = /event: (.*)/.exec(part)?.[1];
            const data = /data: (.*)/.exec(part)?.[1];
            if (event && data) {
              events.push({ event, data: JSON.parse(data) });
            }
          }
        }
      };
      const hello = await next("hello");
      return {
        id: hello.connectionId as string,
        next,
        close: () => controller.abort(),
      };
    };

    const alice = await open("Alice");
    const bob = await open("Bob");
    const presence = await alice.next("presence");
    const latest =
      presence.participants.length === 2
        ? presence
        : await alice.next("presence");
    assert.deepEqual(latest.participants.map((p: any) => p.name).sort(), [
      "Alice",
      "Bob",
    ]);

    // an edit from Alice reaches Bob, not Alice
    await api.post(`/api/v1/scenes/${scene.id}/sync`, {
      elements: [element("live", 1)],
      connectionId: alice.id,
    });
    const update = await bob.next("scene-update");
    assert.deepEqual(
      update.elements.map((e: any) => e.id),
      ["live"],
    );

    // WebRTC offer goes only to its target
    const anon = client(server.base);
    const signal = await anon.post(
      `/api/v1/scenes/${scene.id}/signal?share=${token}`,
      { from: alice.id, to: bob.id, type: "rtc-offer", data: { sdp: "x" } },
    );
    assert.equal(signal.status, 200);
    const offer = await bob.next("signal");
    assert.deepEqual(offer, {
      type: "rtc-offer",
      from: alice.id,
      data: { sdp: "x" },
    });

    await anon.post(`/api/v1/scenes/${scene.id}/signal?share=${token}`, {
      from: bob.id,
      type: "hangout-join",
    });
    for (;;) {
      const p = await alice.next("presence");
      const bobEntry = p.participants.find(
        (x: any) => x.connectionId === bob.id,
      );
      if (bobEntry?.inHangout) {
        break;
      }
    }
    alice.close();
    bob.close();
  });
});

describe("AI", () => {
  test("streams in the editor's SSE format and enforces the daily limit", async () => {
    const limited = await startTestServer({ aiDailyLimit: 1 });
    try {
      const { api } = await signUp(limited.base, "aiuser");
      const body = { messages: [{ role: "user", content: "login flow" }] };
      const res = await fetch(
        `${limited.base}/api/v1/ai/text-to-diagram/chat-streaming`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: await (async () => {
              // reuse the signed-in cookie through a login round-trip
              const login = await fetch(`${limited.base}/api/v1/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  email: "aiuser@example.com",
                  password: "correct horse battery",
                }),
              });
              return login.headers.get("set-cookie")!.split(";")[0];
            })(),
          },
          body: JSON.stringify(body),
        },
      );
      assert.equal(res.headers.get("x-ratelimit-limit"), "1");
      assert.equal(res.headers.get("x-ratelimit-remaining"), "0");
      const text = await res.text();
      const chunks = text
        .split("\n\n")
        .filter(Boolean)
        .map((part) => part.slice("data: ".length));
      assert.equal(chunks.at(-1), "[DONE]");
      const content = chunks
        .slice(0, -1)
        .map((c) => JSON.parse(c))
        .filter((c) => c.type === "content")
        .map((c) => c.delta)
        .join("");
      assert.equal(content, "flowchart TD\n  A --> B");

      const second = await api.post(
        "/api/v1/ai/text-to-diagram/chat-streaming",
        body,
      );
      assert.equal(second.status, 429);

      // bring-your-own key lifts the cap and is used for the request
      await api.patch("/api/v1/me", { aiKey: "sk-ant-own" });
      const usage = (await api.get("/api/v1/ai/usage")).json;
      assert.equal(usage.ownKey, true);
      assert.equal(usage.limit, null);
      const own = await api.post(
        "/api/v1/ai/text-to-diagram/chat-streaming",
        body,
      );
      assert.equal(own.status, 200);
      const ai = limited.ai as ReturnType<typeof fakeAI>;
      assert.equal(ai.calls.at(-1).apiKey, "sk-ant-own");
      assert.equal(ai.calls[0].apiKey, null);
      // the stored key is encrypted at rest
      const row = limited.ctx.db
        .prepare("SELECT ai_key_enc FROM users")
        .get() as any;
      assert.ok(!row.ai_key_enc.includes("sk-ant-own"));
    } finally {
      await limited.close();
    }
  });

  test("rejects malformed input", async () => {
    const api = client(server.base);
    const res = await api.post("/api/v1/ai/text-to-diagram/chat-streaming", {
      messages: [{ role: "assistant", content: "hi" }],
    });
    assert.equal(res.status, 400);
    const image = await api.post(
      "/api/v1/ai/diagram-to-code/generate-streaming",
      {
        image: "https://example.com/x.png",
      },
    );
    assert.equal(image.status, 400);
  });
});

describe("MCP", () => {
  test("initializes, lists tools, draws a connected diagram", async () => {
    const { api } = await signUp(server.base, "agent");
    const key = (await api.post("/api/v1/me/api-keys", { name: "agent" })).json
      .key;
    const mcp = client(server.base, { bearer: key });
    const rpc = async (
      method: string,
      params?: unknown,
      id: number | null = 1,
    ) =>
      (
        await mcp.post("/mcp", {
          jsonrpc: "2.0",
          id: id ?? undefined,
          method,
          params,
        })
      ).json;

    assert.equal(
      (
        await client(server.base).post("/mcp", {
          jsonrpc: "2.0",
          id: 1,
          method: "ping",
        })
      ).status,
      401,
    );

    const init = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
    });
    assert.equal(init.result.protocolVersion, "2025-06-18");
    assert.equal(init.result.serverInfo.name, "excalidraw-plus");
    const notification = await mcp.post("/mcp", {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    assert.equal(notification.status, 202);

    const tools = (await rpc("tools/list")).result.tools.map(
      (t: any) => t.name,
    );
    for (const name of [
      "list_scenes",
      "get_scene",
      "create_scene",
      "add_elements",
      "add_comment",
    ]) {
      assert.ok(tools.includes(name), name);
    }

    const created = await rpc("tools/call", {
      name: "create_scene",
      arguments: {
        name: "Architecture",
        elements: [
          { id: "web", type: "rectangle", x: 0, y: 0, label: "Web" },
          { id: "api", type: "rectangle", x: 300, y: 0, label: "API" },
          { type: "arrow", start: "web", end: "api", label: "HTTPS" },
        ],
      },
    });
    const scene = created.result.structuredContent;
    assert.match(scene.url, /#cloud=/);

    const read = (
      await rpc("tools/call", {
        name: "get_scene",
        arguments: { sceneId: scene.id },
      })
    ).result.structuredContent;
    const arrow = read.elements.find((e: any) => e.type === "arrow");
    assert.deepEqual(
      [arrow.start, arrow.end, arrow.label],
      ["web", "api", "HTTPS"],
    );
    assert.deepEqual(
      read.elements
        .filter((e: any) => e.type === "rectangle")
        .map((e: any) => e.label),
      ["Web", "API"],
    );

    // add to existing shapes, then delete one with its label
    await rpc("tools/call", {
      name: "add_elements",
      arguments: {
        sceneId: scene.id,
        elements: [
          { id: "db", type: "ellipse", x: 600, y: 0, label: "DB" },
          { type: "arrow", start: "api", end: "db" },
        ],
      },
    });
    await rpc("tools/call", {
      name: "delete_elements",
      arguments: { sceneId: scene.id, ids: ["web"] },
    });
    const after = (
      await rpc("tools/call", {
        name: "get_scene",
        arguments: { sceneId: scene.id },
      })
    ).result.structuredContent;
    assert.deepEqual(
      after.elements
        .filter((e: any) => e.label && e.type !== "arrow")
        .map((e: any) => e.label),
      ["API", "DB"],
    );

    // tool errors come back as results, not protocol errors
    const missing = await rpc("tools/call", {
      name: "get_scene",
      arguments: { sceneId: "nope" },
    });
    assert.equal(missing.result.isError, true);
    assert.equal((await rpc("nope")).error.code, -32601);
  });
});

describe("unit", () => {
  test("mergeElements keeps the newer copy and orders by fractional index", () => {
    const { merged, accepted } = mergeElements(
      [element("a", 2, { index: "a1" }), element("b", 1, { index: "a2" })],
      [element("a", 1, { index: "a1" }), element("b", 2, { index: "a0" })],
    );
    assert.deepEqual(
      merged.map((e) => e.id),
      ["b", "a"],
    );
    assert.deepEqual(
      accepted.map((e) => e.id),
      ["b"],
    );
  });

  test("expandSimpleElements binds arrows to both shapes", () => {
    const out = expandSimpleElements([
      { id: "a", type: "rectangle", x: 0, y: 0, width: 100, height: 50 },
      { id: "b", type: "rectangle", x: 300, y: 0, width: 100, height: 50 },
      { id: "arr", type: "arrow", start: "a", end: "b" },
    ]);
    const arrow = out.find((e) => e.id === "arr")!;
    assert.deepEqual(arrow.points, [
      [0, 0],
      [200, 0],
    ]);
    assert.deepEqual((arrow.startBinding as any).fixedPoint, [1, 0.5]);
    assert.deepEqual((arrow.endBinding as any).fixedPoint, [0, 0.5]);
    assert.deepEqual(out.find((e) => e.id === "a")!.boundElements, [
      { id: "arr", type: "arrow" },
    ]);
  });
});

describe("static files", () => {
  test("serves the app and refuses paths outside its folder", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = mkdtempSync(join(tmpdir(), "plus-static-"));
    mkdirSync(join(root, "build"));
    mkdirSync(join(root, "build-secret"));
    writeFileSync(join(root, "build", "index.html"), "<p>app</p>");
    writeFileSync(join(root, "build-secret", "key.txt"), "secret");
    const app = await startTestServer({ staticDir: join(root, "build") });
    try {
      const home = await fetch(`${app.base}/some/route`);
      assert.equal(await home.text(), "<p>app</p>");
      const escape = await fetch(`${app.base}/..%2Fbuild-secret%2Fkey.txt`);
      assert.notEqual(await escape.text(), "secret");
    } finally {
      await app.close();
    }
  });
});
