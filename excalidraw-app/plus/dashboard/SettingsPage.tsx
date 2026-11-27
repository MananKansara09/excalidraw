import { FilledButton } from "@excalidraw/excalidraw/components/FilledButton";
import clsx from "clsx";
import { useEffect, useState } from "react";

import { useAtomValue, useSetAtom } from "../../app-jotai";
import { unreadNotificationCountAtom } from "../../notifications";
import { NotificationCenter } from "../../notifications/components/NotificationCenter";
import { APP_ROUTES } from "../../app_routes";
import { plusAPI, PLUS_API_BASE } from "../api";
import { cloudSceneHash } from "../cloud";
import { AvatarPicker } from "../components/AvatarPicker";
import {
  CopyField,
  ErrorText,
  Field,
  SmallButton,
  timeAgo,
  useAsyncAction,
} from "../components/ui";
import { openCloudScene } from "../scenes";
import { commentsAtom, plusUserAtom } from "../state";

import type { AppNotification } from "../../notifications";
import type { AIUsage, ApiKey, PlusUser } from "../api";

export const SETTINGS_TABS = [
  { id: "profile", label: "Profile" },
  { id: "developer", label: "AI & API" },
  { id: "notifications", label: "Notifications" },
] as const;

export type SettingsTab = typeof SETTINGS_TABS[number]["id"];

export const parseSettingsTab = (value: string | null): SettingsTab | null =>
  SETTINGS_TABS.find((tab) => tab.id === value)?.id ?? null;

/** Saves a change to the signed-in user everywhere it's shown. */
const useSyncUser = () => {
  const setUser = useSetAtom(plusUserAtom);
  const setComments = useSetAtom(commentsAtom);
  return (updated: PlusUser) => {
    setUser(updated);
    setComments((comments) =>
      comments.map((comment) =>
        comment.author.id === updated.id
          ? {
              ...comment,
              author: {
                ...comment.author,
                name: updated.name,
                avatarUrl: updated.avatarUrl ?? null,
              },
            }
          : comment,
      ),
    );
  };
};

const ProfileSettings = ({ user }: { user: PlusUser }) => {
  const syncUser = useSyncUser();
  const [name, setName] = useState(user.name);
  const [notice, setNotice] = useState<string | null>(null);
  const { pending, error, run } = useAsyncAction();

  return (
    <>
      <section className="plus-section">
        <h3>Profile</h3>
        <AvatarPicker
          name={user.name}
          avatarUrl={user.avatarUrl ?? null}
          disabled={pending}
          onSave={async (nextAvatarUrl) => {
            const result = await run(() =>
              plusAPI.updateMe({ avatarUrl: nextAvatarUrl }),
            );
            if (result) {
              syncUser(result.user);
              setNotice(nextAvatarUrl ? "Avatar updated" : "Avatar removed");
            }
          }}
        />
        <Field label="Display name">
          <form
            className="plus-inline-form"
            onSubmit={async (event) => {
              event.preventDefault();
              const result = await run(() =>
                plusAPI.updateMe({ name: name.trim() }),
              );
              if (result) {
                syncUser(result.user);
                setName(result.user.name);
                setNotice("Name updated");
              }
            }}
          >
            <input
              aria-label="Display name"
              value={name}
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
            />
            <SmallButton
              type="submit"
              disabled={pending || !name.trim() || name.trim() === user.name}
            >
              Save
            </SmallButton>
          </form>
        </Field>
        <p className="plus-muted">
          {user.email} · member since{" "}
          {new Date(user.createdAt).toLocaleDateString()}
        </p>
        {notice && (
          <p className="plus-muted" role="status">
            {notice}
          </p>
        )}
        <ErrorText error={error} />
      </section>

      <PasswordSettings />

      <section className="plus-section">
        <h3>Session</h3>
        <FilledButton
          variant="outlined"
          label="Sign out"
          onClick={async () => {
            const done = await run(() => plusAPI.logout());
            if (done !== undefined) {
              window.location.assign("/");
            }
          }}
        />
      </section>
    </>
  );
};

const PasswordSettings = () => {
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [changed, setChanged] = useState(false);
  const { pending, error, setError, run } = useAsyncAction();

  return (
    <section className="plus-section">
      <h3>Password</h3>
      <form
        className="plus-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setChanged(false);
          if (password !== confirmation) {
            setError("The new passwords don't match");
            return;
          }
          const result = await run(() =>
            plusAPI.updateMe({ currentPassword, password }),
          );
          if (result) {
            setCurrentPassword("");
            setPassword("");
            setConfirmation("");
            setChanged(true);
          }
        }}
      >
        <Field label="Current password">
          <input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </Field>
        <Field label="New password" hint="At least 8 characters.">
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <Field label="Repeat new password">
          <input
            type="password"
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </Field>
        {changed && (
          <p className="plus-muted" role="status">
            Password changed
          </p>
        )}
        <ErrorText error={error} />
        <div>
          <SmallButton
            type="submit"
            disabled={
              pending ||
              !currentPassword ||
              password.length < 8 ||
              !confirmation
            }
          >
            Change password
          </SmallButton>
        </div>
      </form>
    </section>
  );
};

const apiOrigin = () =>
  new URL(PLUS_API_BASE, window.location.origin).toString().replace(/\/$/, "");

const DeveloperSettings = ({ user }: { user: PlusUser }) => {
  const syncUser = useSyncUser();
  const [aiKey, setAIKey] = useState("");
  const [usage, setUsage] = useState<AIUsage | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { pending, error, run } = useAsyncAction();

  useEffect(() => {
    run(async () => {
      const [usageResult, keys] = await Promise.all([
        plusAPI.aiUsage(),
        plusAPI.listApiKeys(),
      ]);
      setUsage(usageResult);
      setApiKeys(keys.apiKeys);
    });
  }, [run]);

  const refreshUsage = async () => setUsage(await plusAPI.aiUsage());
  const mcpURL = new URL("/mcp", window.location.origin).toString();

  return (
    <>
      <section className="plus-section">
        <h3>AI</h3>
        {usage && (
          <p>
            {usage.ownKey ? (
              <>
                Using your own Anthropic API key: no daily limit.{" "}
                <span className="plus-muted">{usage.used} requests today.</span>
              </>
            ) : !usage.configured ? (
              "This server has no AI key. Add your own below to use text-to-diagram and wireframe-to-code."
            ) : (
              <>
                <strong>{usage.remaining}</strong> of {usage.limit} AI requests
                left today.
              </>
            )}
          </p>
        )}
        <Field
          label={user.hasAIKey ? "Replace your API key" : "Bring your own key"}
          hint="An Anthropic API key. It's encrypted on the server and used only for your requests."
        >
          <div className="plus-inline-form">
            <input
              type="password"
              placeholder="sk-ant-…"
              autoComplete="off"
              value={aiKey}
              onChange={(event) => setAIKey(event.target.value)}
            />
            <SmallButton
              disabled={!aiKey.trim()}
              onClick={async () => {
                const result = await run(() =>
                  plusAPI.updateMe({ aiKey: aiKey.trim() }),
                );
                if (result) {
                  syncUser(result.user);
                  setAIKey("");
                  setNotice("API key saved");
                  refreshUsage();
                }
              }}
            >
              Save key
            </SmallButton>
            {user.hasAIKey && (
              <SmallButton
                danger
                onClick={async () => {
                  const result = await run(() =>
                    plusAPI.updateMe({ aiKey: null }),
                  );
                  if (result) {
                    syncUser(result.user);
                    setNotice("API key removed");
                    refreshUsage();
                  }
                }}
              >
                Remove
              </SmallButton>
            )}
          </div>
        </Field>
        {notice && (
          <p className="plus-muted" role="status">
            {notice}
          </p>
        )}
      </section>

      <section className="plus-section">
        <h3>API keys</h3>
        <p className="plus-muted">
          For the REST API ({apiOrigin()}) and MCP clients. Send as{" "}
          <code>Authorization: Bearer &lt;key&gt;</code>.
        </p>
        {newKey && (
          <div className="plus-callout">
            <p>Copy your new key now. It won't be shown again.</p>
            <CopyField value={newKey} label="New API key" />
          </div>
        )}
        <ul className="plus-list">
          {apiKeys.map((key) => (
            <li key={key.id} className="plus-list__row">
              <span className="plus-list__main">
                <span>{key.name}</span>
                <span className="plus-muted">
                  {key.prefix}… · created {timeAgo(key.createdAt)}
                  {key.lastUsedAt
                    ? ` · used ${timeAgo(key.lastUsedAt)}`
                    : " · never used"}
                </span>
              </span>
              <SmallButton
                danger
                onClick={async () => {
                  if (
                    !window.confirm(
                      `Revoke "${key.name}"? Clients using it stop working.`,
                    )
                  ) {
                    return;
                  }
                  await run(() => plusAPI.deleteApiKey(key.id));
                  setApiKeys(apiKeys.filter((k) => k.id !== key.id));
                }}
              >
                Revoke
              </SmallButton>
            </li>
          ))}
        </ul>
        <div>
          <SmallButton
            disabled={pending}
            onClick={async () => {
              const keyName = window.prompt("Name this key", "My API key");
              if (!keyName?.trim()) {
                return;
              }
              const created = await run(() =>
                plusAPI.createApiKey(keyName.trim()),
              );
              if (created) {
                setNewKey(created.key);
                setApiKeys((await plusAPI.listApiKeys()).apiKeys);
              }
            }}
          >
            Create API key
          </SmallButton>
        </div>
      </section>

      <section className="plus-section">
        <h3>MCP server</h3>
        <p className="plus-muted">
          Let AI assistants read and draw your scenes. Add this server to an MCP
          client with an API key from above.
        </p>
        <CopyField value={mcpURL} label="MCP server URL" />
        <pre className="plus-code">
          {`claude mcp add --transport http excalidraw ${mcpURL} \\
  --header "Authorization: Bearer <your API key>"`}
        </pre>
      </section>

      <ErrorText error={error} />
    </>
  );
};

/** Opens what a notification points at, from outside the editor. */
const openNotification = (notification: AppNotification) => {
  switch (notification.type) {
    case "share_invite":
      window.location.assign(notification.payload.roomLink);
      return;
    case "scene_share":
    case "scene_assigned":
      openCloudScene(notification.payload.sceneId);
      return;
    case "team_added":
      window.location.assign(
        `${APP_ROUTES.dashboard}?team=${encodeURIComponent(
          notification.payload.teamId,
        )}`,
      );
      return;
    case "comment_mention":
    case "comment_reply": {
      const { sceneId, commentId } = notification.payload;
      window.location.assign(
        `/${cloudSceneHash(sceneId)}&comment=${encodeURIComponent(commentId)}`,
      );
      return;
    }
    case "canvas_mention": {
      const { sceneId, roomLink } = notification.payload;
      if (sceneId) {
        openCloudScene(sceneId);
      } else if (roomLink) {
        window.location.assign(roomLink);
      }
      return;
    }
    case "system":
      if (notification.payload.actionUrl) {
        window.location.assign(notification.payload.actionUrl);
      }
  }
};

/** The "Settings" view of the Workspace: the account and its notifications. */
export const SettingsPage = ({
  user,
  tab,
  onTabChange,
}: {
  user: PlusUser;
  tab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
}) => {
  const unread = useAtomValue(unreadNotificationCountAtom);

  return (
    <div className="dash-settings">
      <div className="dash-settings__tabs" role="tablist">
        {SETTINGS_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={clsx({ active: tab === item.id })}
            onClick={() => onTabChange(item.id)}
          >
            {item.label}
            {item.id === "notifications" && unread > 0 && (
              <span className="dash-count">{unread}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "notifications" ? (
        <div className="dash-settings__log">
          <NotificationCenter onSelectNotification={openNotification} />
        </div>
      ) : (
        <div className="plus-panel">
          {tab === "profile" ? (
            <ProfileSettings user={user} />
          ) : (
            <DeveloperSettings user={user} />
          )}
        </div>
      )}
    </div>
  );
};
