/**
 * What keeps one person's work and sign-ins away from another's on a shared
 * bridge. All users run as the same OS user, so nothing a user can type may
 * make an agent's CLI read files.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync } from "node:fs";
import path from "node:path";

const PASS_ENV = [
  "PATH",
  "LANG",
  "LC_ALL",
  "TZ",
  "TERM",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  // Windows can't start the CLIs without these
  "SystemRoot",
  "ComSpec",
];

const privateDirs = (...dirs) => {
  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
};

/** a user's private folders, created on first use */
export const userDirs = (dataDir, userId) => {
  const key = createHash("sha256").update(userId).digest("hex").slice(0, 32);
  const home = path.join(dataDir, "users", key);
  const dirs = {
    key,
    home,
    configDir: path.join(home, "config"),
    workDir: path.join(home, "work"),
    tmpDir: path.join(home, "tmp"),
  };
  privateDirs(dirs.configDir, dirs.workDir, dirs.tmpDir);
  return dirs;
};

/** one agent's folders inside a user's: its sign-in, workspace and uploads */
export const agentDirs = (user, agent) => {
  const root = path.join(user.home, agent);
  const work = path.join(root, "work");
  const dirs = {
    root,
    home: path.join(root, "home"),
    work,
    // inside the workspace: `agy` refuses to read anything outside it
    uploads: path.join(work, "attachments"),
    tmp: path.join(root, "tmp"),
  };
  privateDirs(dirs.home, dirs.work, dirs.uploads, dirs.tmp);
  return dirs;
};

/** only what a CLI needs from the server's environment */
const allowedEnv = (source) => {
  const env = {};
  for (const k of PASS_ENV) {
    if (source[k]) {
      env[k] = source[k];
    }
  }
  return env;
};

/**
 * Environment for Claude child processes. In multiuser mode it is an
 * allowlist, so neither server secrets nor a stray shared token/API key can
 * leak in and turn per-user logins into one shared subscription.
 */
export const cliEnv = (user, multiuser, source = process.env) => {
  let env;
  if (multiuser) {
    env = allowedEnv(source);
    env.HOME = user.home;
    env.CLAUDE_CONFIG_DIR = user.configDir;
    env.TMPDIR = user.tmpDir;
  } else {
    env = { ...source };
    if (!source.CLAUDE_BRIDGE_ALLOW_API_KEY) {
      delete env.ANTHROPIC_API_KEY;
      delete env.ANTHROPIC_AUTH_TOKEN;
    }
  }
  // Without this the CLI reads any "@/path" in a prompt (the message, or text on
  // a shared canvas) and sends the file along, even with every tool switched
  // off: that would hand out other users' sign-ins.
  env.CLAUDE_CODE_DISABLE_ATTACHMENTS = "1";
  env.CLAUDE_AGENT_SDK_CLIENT_APP = "excalidraw-claude-panel/0.2";
  return env;
};

/** a user's own home for an agent's CLI, on a shared server */
const agentEnv = (dirs, source) => {
  const env = allowedEnv(source);
  env.HOME = dirs.home;
  env.USERPROFILE = dirs.home;
  env.TMPDIR = dirs.tmp;
  env.TEMP = dirs.tmp;
  env.TMP = dirs.tmp;
  // the canvas tools are served on this machine: never through a proxy
  env.NO_PROXY = env.no_proxy = [
    env.NO_PROXY || env.no_proxy,
    "127.0.0.1,localhost",
  ]
    .filter(Boolean)
    .join(",");
  return env;
};

export const codexUserEnv = (dirs, source = process.env) => ({
  ...agentEnv(dirs, source),
  // Codex keeps its sign-in, settings and sessions here
  CODEX_HOME: dirs.home,
});

export const antigravityUserEnv = (dirs, source = process.env) => ({
  ...agentEnv(dirs, source),
  // `agy` otherwise keeps its sign-in in the OS keyring, which all users of one
  // server would share
  AGY_CLI_FORCE_FILE_TOKEN_STORAGE: "1",
  AGY_ACP_FORCE_FILE_STORAGE: "1",
  AGY_CLI_DISABLE_AUTO_UPDATE: "1",
});

/**
 * `agy` permission rules refusing this user's agent everyone else's folders and
 * the server's environment. They hold even if the guard hook doesn't.
 */
export const antigravityDenyRules = (user) => {
  const usersDir = path.dirname(user.home);
  const others = readdirSync(usersDir)
    .filter((name) => name !== path.basename(user.home))
    .map((name) => path.join(usersDir, name));
  return [
    ...others,
    user.configDir,
    path.join(user.home, "codex"),
    "/proc",
  ].map((target) => `read_file(${target})`);
};

/**
 * Chats in progress, across all agents: one per user and agent, and `max` for
 * everybody together. `take` returns { release } or { status, error }.
 */
export const createChatSlots = (max) => {
  const active = new Set();
  return {
    take: (agent, userId, name) => {
      const key = `${agent}:${userId}`;
      if (active.has(key)) {
        return {
          status: 429,
          error: `${name} is still answering your previous message.`,
        };
      }
      if (active.size >= max) {
        return {
          status: 503,
          error: "The server is busy. Try again in a moment.",
        };
      }
      active.add(key);
      return { release: () => active.delete(key) };
    },
  };
};

/**
 * Runs `load` once per key at a time: callers arriving meanwhile share the
 * answer, so one user's repeated requests can't pile up CLI processes.
 */
export const shareInFlight = (load) => {
  const running = new Map();
  return (key, ...args) => {
    let pending = running.get(key);
    if (!pending) {
      pending = load(...args).finally(() => running.delete(key));
      running.set(key, pending);
    }
    return pending;
  };
};

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);
export const isLoopback = (host) => LOOPBACK.has(host);

/** whether a request comes from a process on this machine */
export const isLocalPeer = (req) =>
  isLoopback(String(req.socket.remoteAddress).replace(/^::ffff:/, ""));
