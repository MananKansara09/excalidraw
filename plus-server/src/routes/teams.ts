import { requireTeamRole } from "../access.ts";
import { requireUser } from "../auth.ts";
import { all, get, newId, now, run, transaction } from "../db.ts";
import {
  badRequest,
  forbidden,
  HttpError,
  notFound,
  requireOneOf,
  requireString,
} from "../http.ts";

import type { AppContext } from "../context.ts";
import type { Router } from "../http.ts";
import type { TeamRole } from "../access.ts";

const teamDetail = (ctx: AppContext, teamId: string, viewerRole: TeamRole) => {
  const team = get<{ id: string; name: string; created_at: number }>(
    ctx.db,
    "SELECT * FROM teams WHERE id = ?",
    teamId,
  )!;
  return {
    id: team.id,
    name: team.name,
    createdAt: team.created_at,
    role: viewerRole,
    members: all<any>(
      ctx.db,
      `SELECT users.id, users.name, users.email, team_members.role, team_members.created_at
       FROM team_members JOIN users ON users.id = team_members.user_id
       WHERE team_members.team_id = ? ORDER BY team_members.created_at`,
      teamId,
    ).map((member) => ({
      userId: member.id,
      name: member.name,
      email: member.email,
      role: member.role,
      joinedAt: member.created_at,
    })),
    invites: all<any>(
      ctx.db,
      "SELECT id, email, role, created_at FROM team_invites WHERE team_id = ? ORDER BY created_at",
      teamId,
    ).map((invite) => ({
      id: invite.id,
      email: invite.email,
      role: invite.role,
      createdAt: invite.created_at,
    })),
  };
};

const countOwners = (ctx: AppContext, teamId: string) =>
  get<{ n: number }>(
    ctx.db,
    "SELECT COUNT(*) AS n FROM team_members WHERE team_id = ? AND role = 'owner'",
    teamId,
  )!.n;

export const registerTeamRoutes = (router: Router, ctx: AppContext) => {
  const { db } = ctx;

  router.get("/api/v1/teams", (req) => {
    const user = requireUser(db, req);
    return {
      teams: all<any>(
        db,
        `SELECT teams.id, teams.name, teams.created_at, team_members.role,
           (SELECT COUNT(*) FROM team_members m WHERE m.team_id = teams.id) AS member_count
         FROM teams JOIN team_members ON team_members.team_id = teams.id
         WHERE team_members.user_id = ? ORDER BY teams.name`,
        user.id,
      ).map((team) => ({
        id: team.id,
        name: team.name,
        role: team.role,
        memberCount: team.member_count,
        createdAt: team.created_at,
      })),
    };
  });

  router.post("/api/v1/teams", async (req) => {
    const user = requireUser(db, req);
    const body = await req.body();
    const name = requireString(body.name, "name", { max: 100 });
    const id = newId();
    transaction(db, () => {
      run(
        db,
        "INSERT INTO teams (id, name, created_at) VALUES (?, ?, ?)",
        id,
        name,
        now(),
      );
      run(
        db,
        "INSERT INTO team_members (team_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)",
        id,
        user.id,
        now(),
      );
    });
    return { team: teamDetail(ctx, id, "owner") };
  });

  router.get("/api/v1/teams/:teamId", (req) => {
    const user = requireUser(db, req);
    const role = requireTeamRole(db, req.params.teamId, user);
    return { team: teamDetail(ctx, req.params.teamId, role) };
  });

  router.patch("/api/v1/teams/:teamId", async (req) => {
    const user = requireUser(db, req);
    const role = requireTeamRole(db, req.params.teamId, user, "admin");
    const body = await req.body();
    run(
      db,
      "UPDATE teams SET name = ? WHERE id = ?",
      requireString(body.name, "name", { max: 100 }),
      req.params.teamId,
    );
    return { team: teamDetail(ctx, req.params.teamId, role) };
  });

  router.delete("/api/v1/teams/:teamId", (req) => {
    const user = requireUser(db, req);
    const role = requireTeamRole(db, req.params.teamId, user);
    if (role !== "owner") {
      throw forbidden("Only team owners can delete a team");
    }
    run(db, "DELETE FROM teams WHERE id = ?", req.params.teamId);
    return { ok: true };
  });

  // members & invites --------------------------------------------------------

  router.post("/api/v1/teams/:teamId/invites", async (req) => {
    const user = requireUser(db, req);
    const { teamId } = req.params;
    const viewerRole = requireTeamRole(db, teamId, user, "admin");
    const body = await req.body();
    const email = requireString(body.email, "email", {
      max: 254,
    }).toLowerCase();
    const role = requireOneOf(body.role ?? "member", "role", [
      "admin",
      "member",
    ] as const);

    const invitee = get<{ id: string }>(
      db,
      "SELECT id FROM users WHERE email = ?",
      email,
    );
    if (invitee) {
      if (
        get(
          db,
          "SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?",
          teamId,
          invitee.id,
        )
      ) {
        throw new HttpError(409, "This person is already on the team");
      }
      run(
        db,
        "INSERT INTO team_members (team_id, user_id, role, created_at) VALUES (?, ?, ?, ?)",
        teamId,
        invitee.id,
        role,
        now(),
      );
    } else {
      // joins automatically when they sign up with this email
      run(
        db,
        `INSERT INTO team_invites (id, team_id, email, role, invited_by, created_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (team_id, email) DO UPDATE SET role = excluded.role`,
        newId(),
        teamId,
        email,
        role,
        user.id,
        now(),
      );
    }
    return {
      added: !!invitee,
      team: teamDetail(ctx, teamId, viewerRole),
    };
  });

  router.delete("/api/v1/teams/:teamId/invites/:inviteId", (req) => {
    const user = requireUser(db, req);
    const viewerRole = requireTeamRole(db, req.params.teamId, user, "admin");
    run(
      db,
      "DELETE FROM team_invites WHERE id = ? AND team_id = ?",
      req.params.inviteId,
      req.params.teamId,
    );
    return { team: teamDetail(ctx, req.params.teamId, viewerRole) };
  });

  router.patch("/api/v1/teams/:teamId/members/:userId", async (req) => {
    const user = requireUser(db, req);
    const { teamId, userId } = req.params;
    const viewerRole = requireTeamRole(db, teamId, user, "admin");
    const body = await req.body();
    const role = requireOneOf(body.role, "role", [
      "owner",
      "admin",
      "member",
    ] as const);
    const current = get<{ role: TeamRole }>(
      db,
      "SELECT role FROM team_members WHERE team_id = ? AND user_id = ?",
      teamId,
      userId,
    );
    if (!current) {
      throw notFound("Member not found");
    }
    if (
      (role === "owner" || current.role === "owner") &&
      viewerRole !== "owner"
    ) {
      throw forbidden("Only team owners can change ownership");
    }
    if (
      current.role === "owner" &&
      role !== "owner" &&
      countOwners(ctx, teamId) < 2
    ) {
      throw badRequest("A team needs at least one owner");
    }
    run(
      db,
      "UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?",
      role,
      teamId,
      userId,
    );
    return { team: teamDetail(ctx, teamId, viewerRole) };
  });

  router.delete("/api/v1/teams/:teamId/members/:userId", (req) => {
    const user = requireUser(db, req);
    const { teamId, userId } = req.params;
    const viewerRole = requireTeamRole(db, teamId, user);
    const leaving = userId === user.id;
    if (!leaving && viewerRole === "member") {
      throw forbidden("Only team admins can remove members");
    }
    const target = get<{ role: TeamRole }>(
      db,
      "SELECT role FROM team_members WHERE team_id = ? AND user_id = ?",
      teamId,
      userId,
    );
    if (!target) {
      throw notFound("Member not found");
    }
    if (target.role === "owner" && !leaving && viewerRole !== "owner") {
      throw forbidden("Only team owners can remove an owner");
    }
    if (target.role === "owner" && countOwners(ctx, teamId) < 2) {
      throw badRequest(
        "A team needs at least one owner. Make someone else owner first, or delete the team.",
      );
    }
    run(
      db,
      "DELETE FROM team_members WHERE team_id = ? AND user_id = ?",
      teamId,
      userId,
    );
    return leaving
      ? { ok: true }
      : { team: teamDetail(ctx, teamId, viewerRole) };
  });
};
