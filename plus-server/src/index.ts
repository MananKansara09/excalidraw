/* eslint-disable no-console -- CLI entry point: startup info goes to stdout */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createAnthropicProvider } from "./ai.ts";
import { createApp } from "./app.ts";
import { openDatabase } from "./db.ts";

const here = dirname(fileURLToPath(import.meta.url));
const env = process.env;

const dataDir = resolve(env.PLUS_DATA_DIR || join(here, "..", "data"));
mkdirSync(dataDir, { recursive: true });

/**
 * Encrypts users' own AI keys at rest. Set PLUS_SECRET in production; else a
 * random one is generated and kept next to the database.
 */
const loadSecret = () => {
  if (env.PLUS_SECRET) {
    return env.PLUS_SECRET;
  }
  const file = join(dataDir, "secret");
  if (!existsSync(file)) {
    writeFileSync(file, randomBytes(32).toString("base64"), { mode: 0o600 });
  }
  return readFileSync(file, "utf8").trim();
};

/** PLUS_ICE_SERVERS: a JSON array of RTCIceServer objects. */
const parseIceServers = (value: string | undefined) => {
  if (!value) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // fall through
  }
  console.warn("Ignoring PLUS_ICE_SERVERS: it must be a JSON array");
  return undefined;
};

const defaultStaticDir = resolve(here, "..", "..", "excalidraw-app", "build");
const staticDir =
  env.PLUS_STATIC_DIR ||
  (existsSync(defaultStaticDir) ? defaultStaticDir : null);

const db = openDatabase(join(dataDir, "plus.sqlite"));

const { server, ctx } = createApp({
  db,
  secret: loadSecret(),
  config: {
    aiDailyLimit: Number(env.PLUS_AI_DAILY_LIMIT || 100),
    aiAnonymousDailyLimit: Number(env.PLUS_AI_ANON_DAILY_LIMIT || 10),
    secureCookies: env.PLUS_SECURE_COOKIES === "true",
    publicUrl: env.PLUS_PUBLIC_URL?.replace(/\/$/, "") || null,
    iceServers: parseIceServers(env.PLUS_ICE_SERVERS),
    claudeBridge:
      env.CLAUDE_BRIDGE_URL && env.CLAUDE_BRIDGE_SECRET
        ? {
            url: env.CLAUDE_BRIDGE_URL.replace(/\/$/, ""),
            secret: env.CLAUDE_BRIDGE_SECRET,
          }
        : null,
  },
  ai: createAnthropicProvider(
    (env.PLUS_AI_EFFORT as "low" | "medium" | "high" | undefined) || "medium",
  ),
  staticDir,
});

const port = Number(env.PORT || env.PLUS_PORT || 3015);
server.listen(port, () => {
  console.log(`Excalidraw Plus server on http://localhost:${port}`);
  console.log(`  data: ${dataDir}`);
  console.log(
    `  web app: ${staticDir ?? "not served (run the Vite dev server)"}`,
  );
  if (!env.ANTHROPIC_API_KEY && !env.ANTHROPIC_AUTH_TOKEN) {
    console.log(
      "  AI: no server key; users can add their own in Account settings",
    );
  }
});

const shutdown = () => {
  // open event streams would otherwise keep the server from closing
  ctx.hub.close();
  server.close(() => {
    // checkpoints the write-ahead log into the database file
    db.close();
    process.exit(0);
  });
  server.closeAllConnections();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
