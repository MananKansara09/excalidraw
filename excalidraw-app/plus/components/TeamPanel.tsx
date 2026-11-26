import { FilledButton } from "@excalidraw/excalidraw/components/FilledButton";
import { useEffect, useState } from "react";

import { plusAPI } from "../api";
import { useModal } from "../dashboard/Modal";

import {
  ErrorText,
  initials,
  RoleSelect,
  SmallButton,
  useAsyncAction,
} from "./ui";

import type { PlusUser, TeamDetail, TeamRole } from "../api";

const ROLE_OPTIONS = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "member", label: "Member" },
] as const;

const INVITE_ROLES = [
  { value: "member", label: "Member" },
  { value: "admin", label: "Admin" },
] as const;

export const TeamPanel = ({
  teamId,
  user,
  onTeamsChanged,
  onLeft,
}: {
  teamId: string;
  user: PlusUser;
  onTeamsChanged: () => void;
  onLeft: () => void;
}) => {
  const modal = useModal();
  const [team, setTeam] = useState<TeamDetail | null>(null);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [teamName, setTeamName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const { pending, error, run } = useAsyncAction();

  useEffect(() => {
    let cancelled = false;
    run(async () => {
      const { team } = await plusAPI.getTeam(teamId);
      if (!cancelled) {
        setTeam(team);
        setTeamName(team.name);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [teamId, run]);

  if (!team) {
    return (
      <div className="plus-panel">
        <ErrorText error={error} />
        {!error && <p className="plus-muted">Loading team…</p>}
      </div>
    );
  }

  const canManage = team.role === "owner" || team.role === "admin";
  const update = (promise: Promise<{ team?: TeamDetail }>) =>
    run(async () => {
      const result = await promise;
      if (result.team) {
        setTeam(result.team);
      }
      onTeamsChanged();
    });

  return (
    <div className="plus-panel">
      <section className="plus-section">
        <h3>Team</h3>
        {canManage ? (
          <form
            className="plus-inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (teamName.trim() && teamName !== team.name) {
                update(plusAPI.renameTeam(team.id, teamName.trim()));
              }
            }}
          >
            <input
              aria-label="Team name"
              value={teamName}
              onChange={(event) => setTeamName(event.target.value)}
            />
            <SmallButton type="submit" disabled={teamName === team.name}>
              Rename
            </SmallButton>
          </form>
        ) : (
          <p>{team.name}</p>
        )}
      </section>

      {canManage && (
        <section className="plus-section">
          <h3>Invite people</h3>
          <form
            className="plus-inline-form"
            onSubmit={async (event) => {
              event.preventDefault();
              const result = await run(() =>
                plusAPI.inviteToTeam(team.id, email.trim(), inviteRole),
              );
              if (result) {
                setTeam(result.team);
                setNotice(
                  result.added
                    ? `${email} was added to the team.`
                    : `${email} doesn't have an account yet. They'll join the team when they sign up with this email.`,
                );
                setEmail("");
                onTeamsChanged();
              }
            }}
          >
            <input
              type="email"
              required
              placeholder="name@company.com"
              aria-label="Email to invite"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <RoleSelect
              label="Role for the invite"
              value={inviteRole}
              options={INVITE_ROLES}
              onChange={setInviteRole}
            />
            <SmallButton type="submit" disabled={pending || !email}>
              Invite
            </SmallButton>
          </form>
          {notice && <p className="plus-muted">{notice}</p>}
        </section>
      )}

      <ErrorText error={error} />

      <section className="plus-section">
        <h3>Members ({team.members.length})</h3>
        <ul className="plus-list">
          {team.members.map((member) => {
            const isMe = member.userId === user.id;
            const canEditRole =
              canManage &&
              !isMe &&
              (team.role === "owner" || member.role !== "owner");
            return (
              <li key={member.userId} className="plus-list__row">
                <span className="plus-avatar" aria-hidden="true">
                  {initials(member.name)}
                </span>
                <span className="plus-list__main">
                  <span>
                    {member.name}
                    {isMe && <span className="plus-muted"> (you)</span>}
                  </span>
                  <span className="plus-muted">{member.email}</span>
                </span>
                {canEditRole ? (
                  <RoleSelect
                    label={`Role of ${member.name}`}
                    value={member.role}
                    options={
                      team.role === "owner"
                        ? ROLE_OPTIONS
                        : ROLE_OPTIONS.filter((o) => o.value !== "owner")
                    }
                    onChange={(role: TeamRole) =>
                      update(
                        plusAPI.setMemberRole(team.id, member.userId, role),
                      )
                    }
                  />
                ) : (
                  <span className="plus-badge">{member.role}</span>
                )}
                {(canEditRole || isMe) && (
                  <SmallButton
                    danger
                    onClick={async () => {
                      if (isMe) {
                        if (
                          !(await modal.confirm({
                            title: "Leave team",
                            message: `Leave ${team.name}?`,
                            submitLabel: "Leave",
                            danger: true,
                          }))
                        ) {
                          return;
                        }
                        const left = await run(() =>
                          plusAPI.removeMember(team.id, member.userId),
                        );
                        if (left) {
                          onTeamsChanged();
                          onLeft();
                        }
                      } else {
                        update(plusAPI.removeMember(team.id, member.userId));
                      }
                    }}
                  >
                    {isMe ? "Leave" : "Remove"}
                  </SmallButton>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {team.invites.length > 0 && (
        <section className="plus-section">
          <h3>Pending invites</h3>
          <ul className="plus-list">
            {team.invites.map((invite) => (
              <li key={invite.id} className="plus-list__row">
                <span className="plus-list__main">
                  <span>{invite.email}</span>
                  <span className="plus-muted">
                    Joins as {invite.role} on sign-up
                  </span>
                </span>
                {canManage && (
                  <SmallButton
                    onClick={() =>
                      update(plusAPI.cancelInvite(team.id, invite.id))
                    }
                  >
                    Cancel
                  </SmallButton>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {team.role === "owner" && (
        <section className="plus-section">
          <h3>Danger zone</h3>
          <FilledButton
            color="danger"
            variant="outlined"
            label="Delete team"
            onClick={async () => {
              if (
                !(await modal.confirm({
                  title: "Delete team",
                  message: `Delete ${team.name}? Its scenes and folders are deleted for everyone.`,
                  submitLabel: "Delete team",
                  danger: true,
                }))
              ) {
                return;
              }
              const deleted = await run(() => plusAPI.deleteTeam(team.id));
              if (deleted) {
                onTeamsChanged();
                onLeft();
              }
            }}
          />
        </section>
      )}
    </div>
  );
};
