import { createApp } from "../src/app.ts";
import { openDatabase } from "../src/db.ts";

import type { AddressInfo } from "node:net";
import type { AIProvider } from "../src/ai.ts";

export type TestServer = Awaited<ReturnType<typeof startTestServer>>;

export const fakeAI = (
  chunks = ["flowchart TD\n", "  A --> B"],
): AIProvider & {
  calls: any[];
} => {
  const calls: any[] = [];
  return {
    calls,
    isConfigured: () => true,
    async *stream(params) {
      calls.push(params);
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
};

export const startTestServer = async (
  opts: {
    ai?: AIProvider;
    aiDailyLimit?: number;
    staticDir?: string;
    claudeBridge?: { url: string; secret: string };
  } = {},
) => {
  const ai = opts.ai ?? fakeAI();
  const { server, ctx } = createApp({
    db: openDatabase(":memory:"),
    secret: "test-secret",
    ai,
    staticDir: opts.staticDir ?? null,
    config: {
      aiDailyLimit: opts.aiDailyLimit ?? 100,
      aiAnonymousDailyLimit: 2,
      secureCookies: false,
      publicUrl: "http://app.test",
      claudeBridge: opts.claudeBridge ?? null,
    },
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    base,
    ctx,
    ai,
    close: () =>
      new Promise<void>((resolve) => {
        ctx.hub.close();
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
};

/** A cookie-carrying API client, like a signed-in browser tab. */
export const client = (base: string, init: { bearer?: string } = {}) => {
  let cookie = "";
  const request = async (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(init.bearer ? { Authorization: `Bearer ${init.bearer}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      cookie = setCookie.split(";")[0];
    }
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, headers: res.headers, json };
  };
  return {
    get: (path: string, headers?: Record<string, string>) =>
      request("GET", path, undefined, headers),
    post: (path: string, body?: unknown, headers?: Record<string, string>) =>
      request("POST", path, body ?? {}, headers),
    put: (path: string, body?: unknown, headers?: Record<string, string>) =>
      request("PUT", path, body ?? {}, headers),
    patch: (path: string, body?: unknown, headers?: Record<string, string>) =>
      request("PATCH", path, body ?? {}, headers),
    delete: (path: string, headers?: Record<string, string>) =>
      request("DELETE", path, undefined, headers),
  };
};

export const signUp = async (base: string, name: string) => {
  const api = client(base);
  const res = await api.post("/api/v1/auth/signup", {
    email: `${name}@example.com`,
    name,
    password: "correct horse battery",
  });
  if (res.status !== 200) {
    throw new Error(`signup failed: ${JSON.stringify(res.json)}`);
  }
  return { api, user: res.json.user };
};

export const element = (id: string, version = 1, extra: object = {}) => ({
  id,
  type: "rectangle",
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  version,
  versionNonce: 1,
  isDeleted: false,
  ...extra,
});
