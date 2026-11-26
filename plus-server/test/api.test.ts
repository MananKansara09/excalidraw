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

describe("realtime over WebSocket", () => {
  const connect = (url: string) =>
    new Promise<{
      next: (event: string) => Promise<any>;
      send: (message: unknown) => void;
      close: () => void;
    }>((resolve, reject) => {
      const ws = new WebSocket(url.replace(/^http/, "ws"));
      const queue: { event: string; data: any }[] = [];
      const waiting: (() => void)[] = [];
      ws.onmessage = (message) => {
        queue.push(JSON.parse(String(message.data)));
        waiting.splice(0).forEach((wake) => wake());
      };
      ws.onerror = () => reject(new Error("socket error"));
      const next = async (event: string) => {
        for (;;) {
          const found = queue.findIndex((e) => e.event === event);
          if (found >= 0) {
            return queue.splice(found, 1)[0].data;
          }
          await new Promise<void>((wake) => waiting.push(wake));
        }
      };
      ws.onopen = () =>
        resolve({
          next,
          send: (message) => ws.send(JSON.stringify(message)),
          close: () => ws.close(),
        });
    });

  test("syncs edits, relays pointers and enforces roles", async () => {
    const { api } = await signUp(server.base, "wsowner");
    const scene = (await api.post("/api/v1/scenes", { name: "WS" })).json.scene;
    const links = async (role: string) =>
      (await api.post(`/api/v1/scenes/${scene.id}/links`, { role })).json.links;
    const editorToken = (await links("editor")).find(
      (l: any) => l.role === "editor",
    ).token;
    const viewerToken = (await links("viewer")).find(
      (l: any) => l.role === "viewer",
    ).token;
    const url = (token: string, name: string) =>
      `${server.base}/api/v1/scenes/${scene.id}/ws?share=${token}&name=${name}`;

    const alice = await connect(url(editorToken, "Alice"));
    const aliceId = (await alice.next("hello")).connectionId;
    const bob = await connect(url(viewerToken, "Bob"));
    await bob.next("hello");

    // an edit is acked to the sender, pushed to the others, and persisted
    alice.send({
      type: "sync",
      id: "1",
      elements: [element("ws-el", 1)],
    });
    const ack = await alice.next("sync-ack");
    assert.equal(ack.id, "1");
    assert.equal(ack.accepted, 1);
    const update = await bob.next("scene-update");
    assert.deepEqual(
      update.elements.map((e: any) => e.id),
      ["ws-el"],
    );
    const saved = (await api.get(`/api/v1/scenes/${scene.id}`)).json.scene;
    assert.deepEqual(
      saved.elements.map((e: any) => e.id),
      ["ws-el"],
    );

    // a viewer can't edit
    bob.send({ type: "sync", id: "2", elements: [element("nope", 1)] });
    const denied = await bob.next("sync-error");
    assert.equal(denied.id, "2");
    assert.equal(denied.status, 403);

    // pointers are relayed to everyone else
    alice.send({
      type: "signal",
      signal: "pointer",
      data: { pointer: { x: 1, y: 2, tool: "pointer" } },
    });
    const pointer = await bob.next("signal");
    assert.equal(pointer.type, "pointer");
    assert.equal(pointer.from, aliceId);

    alice.send({ type: "ping", t: 7 });
    assert.deepEqual(await alice.next("pong"), { t: 7 });

    alice.close();
    bob.close();
  });

  test("carries large and rapid messages intact", async () => {
    const { api } = await signUp(server.base, "wsbig");
    const scene = (await api.post("/api/v1/scenes", { name: "Big" })).json
      .scene;
    const token = (
      await api.post(`/api/v1/scenes/${scene.id}/links`, { role: "editor" })
    ).json.links[0].token;
    const url = `${server.base}/api/v1/scenes/${scene.id}/ws?share=${token}`;
    const alice = await connect(url);
    await alice.next("hello");
    const bob = await connect(url);
    await bob.next("hello");

    // > 64 KiB exercises the 64-bit frame length path
    const dataURL = `data:image/png;base64,${"A".repeat(300_000)}`;
    alice.send({
      type: "sync",
      id: "big",
      elements: [element("img", 1, { type: "image", fileId: "f1" })],
      files: { f1: { id: "f1", mimeType: "image/png", dataURL } },
    });
    assert.equal((await alice.next("sync-ack")).accepted, 1);
    assert.deepEqual((await bob.next("scene-update")).fileIds, ["f1"]);
    const files = (await api.get(`/api/v1/scenes/${scene.id}/files`)).json
      .files;
    assert.equal(files.f1.dataURL.length, dataURL.length);

    // a burst of back-to-back edits all arrive, in order
    for (let version = 2; version <= 51; version++) {
      alice.send({
        type: "sync",
        id: `v${version}`,
        elements: [element("burst", version, { x: version })],
      });
    }
    let last = 0;
    while (last < 51) {
      const update = await bob.next("scene-update");
      const burst = update.elements.find((e: any) => e.id === "burst");
      if (burst) {
        assert.ok(burst.version > last);
        last = burst.version;
      }
    }
    alice.close();
    bob.close();
  });

  test("rejects sockets without access", async () => {
    const { api } = await signUp(server.base, "wsprivate");
    const scene = (await api.post("/api/v1/scenes", { name: "Private" })).json
      .scene;
    const failed = await new Promise<boolean>((resolve) => {
      const ws = new WebSocket(
        `${server.base.replace(/^http/, "ws")}/api/v1/scenes/${scene.id}/ws`,
      );
      ws.onopen = () => resolve(false);
      ws.onerror = () => resolve(true);
    });
    assert.equal(failed, true);
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

describe("mentions", () => {
  test("lists people with access and stores only valid mentions", async () => {
    const { api: owner, user: ownerUser } = await signUp(
      server.base,
      "mentioner",
    );
    const { api: grace, user: graceUser } = await signUp(server.base, "grace");
    const { user: stranger } = await signUp(server.base, "outsider");
    const scene = (await owner.post("/api/v1/scenes", { name: "Mentions" }))
      .json.scene;
    await owner.post(`/api/v1/scenes/${scene.id}/access`, {
      email: "grace@example.com",
      role: "viewer",
    });

    const people = (await grace.get(`/api/v1/scenes/${scene.id}/people`)).json
      .people;
    assert.deepEqual(people.map((p: any) => p.name).sort(), [
      "grace",
      "mentioner",
    ]);

    const comment = (
      await owner.post(`/api/v1/scenes/${scene.id}/comments`, {
        body: "@grace can you check this? cc @outsider",
        mentions: [
          { userId: graceUser.id },
          // no access to the scene: dropped
          { userId: stranger.id },
          // not in the text: dropped
          { userId: ownerUser.id },
        ],
      })
    ).json.comment;
    assert.deepEqual(comment.mentions, [
      { userId: graceUser.id, name: "grace" },
    ]);

    // grace's inbox shows it as unread until she marks it seen
    let inbox = (await grace.get("/api/v1/me/mentions")).json;
    assert.equal(inbox.unread, 1);
    assert.equal(inbox.mentions[0].sceneName, "Mentions");
    assert.equal(inbox.mentions[0].body, comment.body);
    await grace.post("/api/v1/me/mentions/seen");
    inbox = (await grace.get("/api/v1/me/mentions")).json;
    assert.equal(inbox.unread, 0);
    assert.equal(inbox.mentions.length, 1);

    // editing the text away removes the mention
    const edited = (
      await owner.patch(`/api/v1/comments/${comment.id}`, {
        body: "never mind",
      })
    ).json.comment;
    assert.deepEqual(edited.mentions, []);

    // losing access hides old mentions from the inbox
    await owner.post(`/api/v1/scenes/${scene.id}/comments`, {
      body: "@grace again",
      mentions: [{ userId: graceUser.id }],
    });
    await owner.delete(`/api/v1/scenes/${scene.id}/access/${graceUser.id}`);
    assert.equal(
      (await grace.get("/api/v1/me/mentions")).json.mentions.length,
      0,
    );
  });

  test("adds the new columns to a database from an earlier version", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { openDatabase } = await import("../src/db.ts");
    const file = join(
      mkdtempSync(join(tmpdir(), "plus-migrate-")),
      "old.sqlite",
    );
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      password_hash TEXT NOT NULL, ai_key_enc TEXT, created_at INTEGER NOT NULL);
      CREATE TABLE comments (id TEXT PRIMARY KEY, scene_id TEXT NOT NULL, parent_id TEXT, author_id TEXT NOT NULL,
      element_id TEXT, x REAL, y REAL, body TEXT NOT NULL, resolved INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      INSERT INTO comments VALUES ('c1', 's1', NULL, 'u1', NULL, NULL, NULL, 'old', 0, 1, 1);`);
    old.close();
    const db = openDatabase(file);
    const row = db
      .prepare("SELECT mentions FROM comments WHERE id = 'c1'")
      .get() as any;
    assert.equal(row.mentions, "[]");
    // opening again is a no-op
    db.close();
    openDatabase(file).close();
  });
});

describe("rtc config", () => {
  test("serves ICE servers, defaulting to public STUN", async () => {
    const res = await client(server.base).get("/api/v1/rtc-config");
    assert.deepEqual(res.json, {
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
  });
});

describe("user avatars", () => {
  test("updates avatarUrl, rejects unsafe values, and propagates to comments, mentions, access, teams, and presence", async () => {
    const { api: alice, user: aliceUser } = await signUp(server.base, "av1");
    const { api: bob, user: bobUser } = await signUp(server.base, "av2");
    assert.equal(aliceUser.avatarUrl, null);

    const svgAvatar =
      "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3C%2Fsvg%3E";
    const pngAvatar =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9cAAAAASUVORK5CYII=";

    // unsafe SVG or javascript URLs are rejected
    assert.equal(
      (
        await alice.patch("/api/v1/me", {
          // eslint-disable-next-line no-script-url
          avatarUrl: "javascript:alert(1)",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await alice.patch("/api/v1/me", {
          avatarUrl:
            "data:image/svg+xml;charset=utf-8,<svg><script>alert(1)</script></svg>",
        })
      ).status,
      400,
    );

    const updated = await alice.patch("/api/v1/me", { avatarUrl: svgAvatar });
    assert.equal(updated.status, 200);
    assert.equal(updated.json.user.avatarUrl, svgAvatar);
    assert.equal(
      (await alice.get("/api/v1/me")).json.user.avatarUrl,
      svgAvatar,
    );

    // team + scene + access + comments + mentions all expose avatarUrl
    const team = (await alice.post("/api/v1/teams", { name: "AvTeam" })).json
      .team;
    assert.equal(team.members[0].avatarUrl, svgAvatar);

    const scene = (await alice.post("/api/v1/scenes", { name: "AvScene" })).json
      .scene;
    const access = (
      await alice.post(`/api/v1/scenes/${scene.id}/access`, {
        email: "av2@example.com",
        role: "editor",
      })
    ).json;
    assert.equal(access.owner.avatarUrl, svgAvatar);
    assert.equal(access.collaborators[0].avatarUrl, null);

    const people = (await bob.get(`/api/v1/scenes/${scene.id}/people`)).json
      .people;
    assert.equal(
      people.find((p: any) => p.userId === aliceUser.id).avatarUrl,
      svgAvatar,
    );

    const comment = (
      await alice.post(`/api/v1/scenes/${scene.id}/comments`, {
        body: `@${bobUser.name} look at this`,
        mentions: [{ userId: bobUser.id }],
      })
    ).json.comment;
    assert.equal(comment.author.avatarUrl, svgAvatar);

    const commentsList = (await bob.get(`/api/v1/scenes/${scene.id}/comments`))
      .json.comments;
    assert.equal(commentsList[0].author.avatarUrl, svgAvatar);

    const inbox = (await bob.get("/api/v1/me/mentions")).json.mentions;
    assert.equal(inbox[0].author.avatarUrl, svgAvatar);

    // live presence receives initial avatarUrl and broadcasts updates
    const aliceKey = (
      await alice.post("/api/v1/me/api-keys", { name: "ws-alice" })
    ).json.key;
    const bobKey = (await bob.post("/api/v1/me/api-keys", { name: "sse-bob" }))
      .json.key;

    const openSSE = async (bearer: string) => {
      const controller = new AbortController();
      const response = await fetch(
        `${server.base}/api/v1/scenes/${scene.id}/events`,
        {
          headers: { Authorization: `Bearer ${bearer}` },
          signal: controller.signal,
        },
      );
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const events: { event: string; data: any }[] = [];
      const next = async (eventName: string) => {
        for (;;) {
          const idx = events.findIndex((e) => e.event === eventName);
          if (idx >= 0) {
            return events.splice(idx, 1)[0].data;
          }
          const { value, done } = await reader.read();
          if (done) {
            throw new Error(`stream ended waiting for ${eventName}`);
          }
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop()!;
          for (const frame of frames) {
            const eventMatch = /^event: (.+)$/m.exec(frame);
            const dataMatch = /^data: (.+)$/m.exec(frame);
            if (eventMatch && dataMatch) {
              events.push({
                event: eventMatch[1],
                data: JSON.parse(dataMatch[1]),
              });
            }
          }
        }
      };
      await next("hello");
      return {
        next,
        events,
        close: () => controller.abort(),
      };
    };

    const bobStream = await openSSE(bobKey);
    const aliceStream = await openSSE(aliceKey);

    const waitPresence = async (
      predicate: (participants: any[]) => boolean,
    ) => {
      for (const item of bobStream.events) {
        if (item.event === "presence" && predicate(item.data.participants)) {
          return item.data.participants;
        }
      }
      for (;;) {
        const data = await bobStream.next("presence");
        if (predicate(data.participants)) {
          return data.participants;
        }
      }
    };

    const initialParticipants = await waitPresence((list) =>
      list.some((p) => p.userId === aliceUser.id && p.avatarUrl === svgAvatar),
    );
    assert.ok(initialParticipants.length >= 2);

    await alice.patch("/api/v1/me", { avatarUrl: pngAvatar });
    await waitPresence((list) =>
      list.some((p) => p.userId === aliceUser.id && p.avatarUrl === pngAvatar),
    );

    // clearing avatarUrl sets it back to null
    const cleared = await alice.patch("/api/v1/me", { avatarUrl: null });
    assert.equal(cleared.json.user.avatarUrl, null);
    await waitPresence((list) =>
      list.some((p) => p.userId === aliceUser.id && p.avatarUrl === null),
    );

    aliceStream.close();
    bobStream.close();
  });
});
