import {
  clearSessionCookie,
  createApiKey,
  createSession,
  deleteSession,
  hashPassword,
  publicUser,
  requireUser,
  SESSION_COOKIE,
  setSessionCookie,
  verifyPassword,
} from "../auth.ts";
import { all, get, newId, now, run, transaction } from "../db.ts";
import {
  badRequest,
  HttpError,
  notFound,
  optionalString,
  requireString,
  unauthorized,
} from "../http.ts";

import type { AppContext } from "../context.ts";
import type { Router } from "../http.ts";
import type { User } from "../auth.ts";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Moves pending team invites for this email into memberships. */
const acceptPendingInvites = (ctx: AppContext, user: User) => {
  const invites = all<{ id: string; team_id: string; role: string }>(
    ctx.db,
    "SELECT * FROM team_invites WHERE email = ?",
    user.email,
  );
  for (const invite of invites) {
    run(
      ctx.db,
      `INSERT OR IGNORE INTO team_members (team_id, user_id, role, created_at) VALUES (?, ?, ?, ?)`,
      invite.team_id,
      user.id,
      invite.role,
      now(),
    );
    run(ctx.db, "DELETE FROM team_invites WHERE id = ?", invite.id);
  }
};

/** Failed sign-ins allowed per IP and email in a window, against guessing. */
const MAX_FAILED_LOGINS = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export const registerAuthRoutes = (router: Router, ctx: AppContext) => {
  const { db } = ctx;
  const failedLogins = new Map<string, { count: number; since: number }>();

  router.post("/api/v1/auth/signup", async (req, res) => {
    const body = await req.body();
    const email = requireString(body.email, "email", {
      max: 254,
    }).toLowerCase();
    if (!EMAIL_RE.test(email)) {
      throw badRequest("Enter a valid email address");
    }
    // an empty name is fine: default to the email's local part
    const name = requireString(
      typeof body.name === "string" && body.name.trim()
        ? body.name
        : email.split("@")[0],
      "name",
      { max: 100 },
    );
    const password = requireString(body.password, "password", {
      min: 8,
      max: 200,
    });
    if (get(db, "SELECT 1 FROM users WHERE email = ?", email)) {
      throw new HttpError(409, "An account with this email already exists");
    }
    const user = transaction(db, () => {
      const id = newId();
      run(
        db,
        "INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
        id,
        email,
        name,
        hashPassword(password),
        now(),
      );
      const user = get<User>(db, "SELECT * FROM users WHERE id = ?", id)!;
      acceptPendingInvites(ctx, user);
      return user;
    });
    setSessionCookie(res, createSession(db, user.id), ctx.config.secureCookies);
    return { user: publicUser(user) };
  });

  router.post("/api/v1/auth/login", async (req, res) => {
    const body = await req.body();
    const email = requireString(body.email, "email", { max: 254 });
    const password = requireString(body.password, "password", { max: 200 });
    const attemptKey = `${req.ip}|${email.toLowerCase()}`;
    const attempts = failedLogins.get(attemptKey);
    if (attempts && Date.now() - attempts.since > LOGIN_WINDOW_MS) {
      failedLogins.delete(attemptKey);
    } else if (attempts && attempts.count >= MAX_FAILED_LOGINS) {
      throw new HttpError(
        429,
        "Too many failed sign-ins. Try again in a few minutes.",
      );
    }
    const user = get<User & { password_hash: string }>(
      db,
      "SELECT * FROM users WHERE email = ?",
      email,
    );
    if (!user || !verifyPassword(password, user.password_hash)) {
      const current = failedLogins.get(attemptKey);
      failedLogins.set(attemptKey, {
        count: (current?.count ?? 0) + 1,
        since: current?.since ?? Date.now(),
      });
      throw unauthorized("Wrong email or password");
    }
    failedLogins.delete(attemptKey);
    acceptPendingInvites(ctx, user);
    setSessionCookie(res, createSession(db, user.id), ctx.config.secureCookies);
    return { user: publicUser(user) };
  });

  router.post("/api/v1/auth/logout", (req, res) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) {
      deleteSession(db, token);
    }
    clearSessionCookie(res);
    return { ok: true };
  });

  router.get("/api/v1/me", (req) => {
    const user = requireUser(db, req);
    return { user: publicUser(user) };
  });

  router.patch("/api/v1/me", async (req) => {
    const user = requireUser(db, req);
    const body = await req.body();
    if (body.name !== undefined) {
      run(
        db,
        "UPDATE users SET name = ? WHERE id = ?",
        requireString(body.name, "name", { max: 100 }),
        user.id,
      );
    }
    if (body.aiKey !== undefined) {
      const aiKey = optionalString(body.aiKey, "aiKey", { max: 500 });
      run(
        db,
        "UPDATE users SET ai_key_enc = ? WHERE id = ?",
        aiKey ? ctx.secrets.encrypt(aiKey) : null,
        user.id,
      );
    }
    if (body.password !== undefined) {
      const current = get<{ password_hash: string }>(
        db,
        "SELECT password_hash FROM users WHERE id = ?",
        user.id,
      )!;
      if (
        typeof body.currentPassword !== "string" ||
        !verifyPassword(body.currentPassword, current.password_hash)
      ) {
        throw badRequest("Current password is wrong");
      }
      run(
        db,
        "UPDATE users SET password_hash = ? WHERE id = ?",
        hashPassword(
          requireString(body.password, "password", { min: 8, max: 200 }),
        ),
        user.id,
      );
    }
    return {
      user: publicUser(
        get<User>(db, "SELECT * FROM users WHERE id = ?", user.id)!,
      ),
    };
  });

  // API keys (REST API + MCP) ------------------------------------------------

  router.get("/api/v1/me/api-keys", (req) => {
    const user = requireUser(db, req);
    return {
      apiKeys: all<any>(
        db,
        "SELECT id, name, prefix, created_at, last_used_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC",
        user.id,
      ).map((key) => ({
        id: key.id,
        name: key.name,
        prefix: key.prefix,
        createdAt: key.created_at,
        lastUsedAt: key.last_used_at,
      })),
    };
  });

  router.post("/api/v1/me/api-keys", async (req) => {
    const user = requireUser(db, req);
    const body = await req.body();
    const name = requireString(body.name ?? "API key", "name", { max: 100 });
    const { id, secret } = createApiKey(db, user.id, name);
    // the secret is shown once and never stored in plain text
    return { id, name, key: secret };
  });

  router.delete("/api/v1/me/api-keys/:keyId", (req) => {
    const user = requireUser(db, req);
    const result = run(
      db,
      "DELETE FROM api_keys WHERE id = ? AND user_id = ?",
      req.params.keyId,
      user.id,
    );
    if (!result.changes) {
      throw notFound("API key not found");
    }
    return { ok: true };
  });
};
