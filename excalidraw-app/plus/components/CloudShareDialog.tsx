import { Dialog } from "@excalidraw/excalidraw/components/Dialog";
import { useEffect, useState } from "react";

import { useAtomValue, useSetAtom } from "../../app-jotai";
import { knownUsersAtom } from "../../notifications";
import { plusAPI } from "../api";
import { getShareURL } from "../cloud";
import { cloudSceneAtom, plusDialogAtom, plusUserAtom } from "../state";

import {
  CopyField,
  ErrorText,
  PlusAvatar,
  RoleSelect,
  SmallButton,
  useAsyncAction,
} from "./ui";

import type { SceneAccess } from "../api";

const SCENE_ROLES = [
  { value: "editor", label: "Can edit" },
  { value: "viewer", label: "Can view" },
] as const;

const embedCode = (token: string) =>
  `<iframe src="${getShareURL(
    token,
    true,
  )}" width="800" height="500" style="border:0" allowfullscreen></iframe>`;

export const CloudShareDialog = () => {
  const setDialog = useSetAtom(plusDialogAtom);
  const scene = useAtomValue(cloudSceneAtom);
  const currentUser = useAtomValue(plusUserAtom);
  const knownUsers = useAtomValue(knownUsersAtom);
  const [access, setAccess] = useState<SceneAccess | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const { pending, error, run } = useAsyncAction();

  const isOwner = scene?.role === "owner";

  useEffect(() => {
    if (scene && isOwner) {
      run(async () => setAccess(await plusAPI.getAccess(scene.id)));
    }
  }, [scene, isOwner, run]);

  if (!scene) {
    return null;
  }

  const sceneURL = `${window.location.origin}/#cloud=${scene.id}`;
  const update = (promise: Promise<SceneAccess>) =>
    run(async () => setAccess(await promise));

  const viewLinks =
    access?.links.filter((link) => link.role === "viewer") ?? [];
  const editLinks =
    access?.links.filter((link) => link.role === "editor") ?? [];

  return (
    <Dialog
      size="regular"
      onCloseRequest={() => setDialog(null)}
      title={`Share “${scene.name}”`}
      className="plus-dialog"
    >
      <div className="plus-panel">
        <section className="plus-section">
          <h3>Link for people with access</h3>
          <p className="plus-muted">
            {scene.teamId
              ? "Everyone on the team can open it, plus anyone you add below."
              : "Only you and the people you add below can open it."}
          </p>
          <CopyField value={sceneURL} label="Scene link" />
        </section>

        {!isOwner ? (
          <p className="plus-muted">
            Only the scene owner (or a team admin) can change who has access.
          </p>
        ) : !access ? (
          <>
            <ErrorText error={error} />
            {!error && <p className="plus-muted">Loading…</p>}
          </>
        ) : (
          <>
            <section className="plus-section">
              <h3>People</h3>
              <form
                className="plus-inline-form"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const done = await update(
                    plusAPI.shareWithUser(scene.id, email.trim(), role),
                  );
                  if (done !== undefined) {
                    setEmail("");
                  }
                }}
              >
                <input
                  type="email"
                  required
                  placeholder="Add people by email"
                  aria-label="Email to share with"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
                <RoleSelect
                  label="Access for the new person"
                  value={role}
                  options={SCENE_ROLES}
                  onChange={setRole}
                />
                <SmallButton type="submit" disabled={pending || !email}>
                  Share
                </SmallButton>
              </form>
              {(() => {
                const existingEmails = new Set([
                  access.owner.email.toLowerCase(),
                  ...access.collaborators.map((c) => c.email.toLowerCase()),
                ]);
                const quickAdd = knownUsers
                  .filter(
                    (u) =>
                      u.email &&
                      u.id !== currentUser?.id &&
                      !existingEmails.has(u.email.toLowerCase()),
                  )
                  .slice(0, 5);
                if (!quickAdd.length) {
                  return null;
                }
                return (
                  <div
                    className="plus-muted"
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "0.35rem",
                      alignItems: "center",
                    }}
                  >
                    <span>Quick assign:</span>
                    {quickAdd.map((person) => (
                      <SmallButton
                        key={person.id}
                        disabled={pending}
                        onClick={() =>
                          update(
                            plusAPI.shareWithUser(
                              scene.id,
                              person.email!,
                              role,
                            ),
                          )
                        }
                      >
                        +{person.username}
                      </SmallButton>
                    ))}
                  </div>
                );
              })()}
              <ul className="plus-list">
                <li className="plus-list__row">
                  <PlusAvatar
                    name={access.owner.name}
                    avatarUrl={access.owner.avatarUrl}
                  />
                  <span className="plus-list__main">
                    <span>{access.owner.name}</span>
                    <span className="plus-muted">{access.owner.email}</span>
                  </span>
                  <span className="plus-badge">owner</span>
                </li>
                {access.collaborators.map((person) => (
                  <li key={person.userId} className="plus-list__row">
                    <PlusAvatar
                      name={person.name}
                      avatarUrl={person.avatarUrl}
                    />
                    <span className="plus-list__main">
                      <span>{person.name}</span>
                      <span className="plus-muted">{person.email}</span>
                    </span>
                    <RoleSelect
                      label={`Access for ${person.name}`}
                      value={person.role}
                      options={SCENE_ROLES}
                      onChange={(next) =>
                        update(
                          plusAPI.shareWithUser(scene.id, person.email, next),
                        )
                      }
                    />
                    <SmallButton
                      danger
                      onClick={() =>
                        update(plusAPI.unshareWithUser(scene.id, person.userId))
                      }
                    >
                      Remove
                    </SmallButton>
                  </li>
                ))}
              </ul>
            </section>

            <section className="plus-section">
              <h3>Read-only link & embed</h3>
              <p className="plus-muted">
                Anyone with the link can view, no account needed.
              </p>
              {viewLinks.map((link) => (
                <div key={link.token} className="plus-link-block">
                  <CopyField
                    value={getShareURL(link.token)}
                    label="Read-only link"
                  />
                  <CopyField value={embedCode(link.token)} label="Embed code" />
                  <SmallButton
                    danger
                    onClick={() =>
                      update(plusAPI.revokeLink(scene.id, link.token))
                    }
                  >
                    Revoke link
                  </SmallButton>
                </div>
              ))}
              {!viewLinks.length && (
                <SmallButton
                  onClick={() => update(plusAPI.createLink(scene.id, "viewer"))}
                >
                  Create read-only link
                </SmallButton>
              )}
            </section>

            <section className="plus-section">
              <h3>Edit link</h3>
              <p className="plus-muted">
                Anyone with the link can edit, no account needed. Share it
                carefully.
              </p>
              {editLinks.map((link) => (
                <div key={link.token} className="plus-link-block">
                  <CopyField
                    value={getShareURL(link.token)}
                    label="Edit link"
                  />
                  <SmallButton
                    danger
                    onClick={() =>
                      update(plusAPI.revokeLink(scene.id, link.token))
                    }
                  >
                    Revoke link
                  </SmallButton>
                </div>
              ))}
              {!editLinks.length && (
                <SmallButton
                  onClick={() => update(plusAPI.createLink(scene.id, "editor"))}
                >
                  Create edit link
                </SmallButton>
              )}
            </section>
            <ErrorText error={error} />
          </>
        )}
      </div>
    </Dialog>
  );
};
