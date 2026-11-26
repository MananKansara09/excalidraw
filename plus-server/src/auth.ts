import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

import { get, newId, now, run } from "./db.ts";
import { unauthorized } from "./http.ts";

import type { DB } from "./db.ts";
import type { Request } from "./http.ts";
import type { ServerResponse } from "node:http";

export const SESSION_COOKIE = "eplus_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const API_KEY_PREFIX = "exk_";

export type User = {
  id: string;
  email: string;
  name: string;
  created_at: number;
  ai_key_enc: string | null;
};

export const publicUser = (user: User) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  createdAt: user.created_at,
  hasAIKey: !!user.ai_key_enc,
});

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

// passwords ------------------------------------------------------------------

export const hashPassword = (password: string) => {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
};

export const verifyPassword = (password: string, stored: string) => {
  const [scheme, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) {
    return false;
  }
  const expected = Buffer.from(hashB64, "base64");
  const actual = scryptSync(password, Buffer.from(saltB64, "base64"), 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

// sessions -------------------------------------------------------------------

export const createSession = (db: DB, userId: string) => {
  const token = randomBytes(32).toString("base64url");
  run(
    db,
    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
    sha256(token),
    userId,
    now() + SESSION_TTL_MS,
  );
  return token;
};

export const deleteSession = (db: DB, token: string) => {
  run(db, "DELETE FROM sessions WHERE token_hash = ?", sha256(token));
};

export const setSessionCookie = (
  res: ServerResponse,
  token: string,
  secure: boolean,
) => {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${
      SESSION_TTL_MS / 1000
    }${secure ? "; Secure" : ""}`,
  );
};

export const clearSessionCookie = (res: ServerResponse) => {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  );
};

// API keys -------------------------------------------------------------------

export const createApiKey = (db: DB, userId: string, name: string) => {
  const secret = `${API_KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
  const id = newId();
  run(
    db,
    `INSERT INTO api_keys (id, user_id, name, prefix, key_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    id,
    userId,
    name,
    secret.slice(0, API_KEY_PREFIX.length + 6),
    sha256(secret),
    now(),
  );
  return { id, secret };
};

// resolving the caller -------------------------------------------------------

/**
 * Resolves the user from either the session cookie (web app) or an
 * `Authorization: Bearer exk_...` API key (REST API / MCP clients).
 */
export const getUser = (db: DB, req: Request): User | null => {
  const authorization = req.headers.authorization;
  if (authorization?.startsWith("Bearer ")) {
    const key = authorization.slice("Bearer ".length).trim();
    if (key.startsWith(API_KEY_PREFIX)) {
      const row = get<User & { key_id: string }>(
        db,
        `SELECT users.*, api_keys.id AS key_id FROM api_keys
         JOIN users ON users.id = api_keys.user_id
         WHERE api_keys.key_hash = ?`,
        sha256(key),
      );
      if (row) {
        run(
          db,
          "UPDATE api_keys SET last_used_at = ? WHERE id = ?",
          now(),
          row.key_id,
        );
        return row;
      }
    }
    return null;
  }

  const token = req.cookies[SESSION_COOKIE];
  if (!token) {
    return null;
  }
  const row = get<User & { expires_at: number }>(
    db,
    `SELECT users.*, sessions.expires_at FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ?`,
    sha256(token),
  );
  if (!row || row.expires_at < now()) {
    return null;
  }
  return row;
};

export const requireUser = (db: DB, req: Request): User => {
  const user = getUser(db, req);
  if (!user) {
    throw unauthorized();
  }
  return user;
};

// secret storage for bring-your-own AI keys ---------------------------------

export const createSecretBox = (secret: string) => {
  const key = createHash("sha256").update(secret).digest();
  return {
    encrypt(plain: string) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
      return [iv, cipher.getAuthTag(), enc]
        .map((part) => part.toString("base64"))
        .join(".");
    },
    decrypt(boxed: string) {
      const [iv, tag, enc] = boxed
        .split(".")
        .map((p) => Buffer.from(p, "base64"));
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(enc), decipher.final()]).toString(
        "utf8",
      );
    },
  };
};

export type SecretBox = ReturnType<typeof createSecretBox>;
