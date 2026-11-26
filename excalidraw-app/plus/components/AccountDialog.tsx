import { Dialog } from "@excalidraw/excalidraw/components/Dialog";
import { FilledButton } from "@excalidraw/excalidraw/components/FilledButton";
import { useEffect, useState } from "react";

import { useAtom, useSetAtom } from "../../app-jotai";
import { plusAPI, PLUS_API_BASE } from "../api";
import { cloudSession } from "../cloud";
import { commentsAtom, plusDialogAtom, plusUserAtom } from "../state";

import { AvatarPicker } from "./AvatarPicker";
import {
  CopyField,
  ErrorText,
  Field,
  SmallButton,
  timeAgo,
  useAsyncAction,
} from "./ui";

import type { AIUsage, ApiKey } from "../api";

const apiOrigin = () =>
  new URL(PLUS_API_BASE, window.location.origin).toString().replace(/\/$/, "");

export const AccountDialog = () => {
  const setDialog = useSetAtom(plusDialogAtom);
  const setComments = useSetAtom(commentsAtom);
  const [user, setUser] = useAtom(plusUserAtom);
  const [name, setName] = useState(user?.name ?? "");
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

  if (!user) {
    return null;
  }

  const refreshUsage = async () => setUsage(await plusAPI.aiUsage());
  const mcpURL = new URL("/mcp", window.location.origin).toString();

  const syncUserState = (updated: typeof user) => {
    if (!updated) {
      return;
    }
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

  return (
    <Dialog
      size="regular"
      onCloseRequest={() => setDialog(null)}
      title="Account"
      className="plus-dialog"
    >
      <div className="plus-panel">
        <section className="plus-section">
          <h3>Profile</h3>
          <p className="plus-muted">{user.email}</p>
          <AvatarPicker
            name={user.name}
            avatarUrl={user.avatarUrl ?? null}
            disabled={pending}
            onSave={async (nextAvatarUrl) => {
              const result = await run(() =>
                plusAPI.updateMe({ avatarUrl: nextAvatarUrl }),
              );
              if (result) {
                syncUserState(result.user);
                setNotice(nextAvatarUrl ? "Avatar updated" : "Avatar removed");
              }
            }}
          />
          <form
            className="plus-inline-form"
            onSubmit={async (event) => {
              event.preventDefault();
              const result = await run(() => plusAPI.updateMe({ name }));
              if (result) {
                syncUserState(result.user);
                setNotice("Name updated");
              }
            }}
          >
            <input
              aria-label="Display name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <SmallButton
              type="submit"
              disabled={!name.trim() || name === user.name}
            >
              Save
            </SmallButton>
          </form>
        </section>

        <section className="plus-section">
          <h3>AI</h3>
          {usage && (
            <p>
              {usage.ownKey ? (
                <>
                  Using your own Anthropic API key: no daily limit.{" "}
                  <span className="plus-muted">
                    {usage.used} requests today.
                  </span>
                </>
              ) : !usage.configured ? (
                "This server has no AI key. Add your own below to use text-to-diagram and wireframe-to-code."
              ) : (
                <>
                  <strong>{usage.remaining}</strong> of {usage.limit} AI
                  requests left today.
                </>
              )}
            </p>
          )}
          <Field
            label={
              user.hasAIKey ? "Replace your API key" : "Bring your own key"
            }
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
                    setUser(result.user);
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
                      setUser(result.user);
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
        </section>

        <section className="plus-section">
          <h3>MCP server</h3>
          <p className="plus-muted">
            Let AI assistants read and draw your scenes. Add this server to an
            MCP client with an API key from above.
          </p>
          <CopyField value={mcpURL} label="MCP server URL" />
          <pre className="plus-code">
            {`claude mcp add --transport http excalidraw ${mcpURL} \\
  --header "Authorization: Bearer <your API key>"`}
          </pre>
        </section>

        {notice && <p className="plus-muted">{notice}</p>}
        <ErrorText error={error} />

        <FilledButton
          variant="outlined"
          label="Sign out"
          onClick={async () => {
            await run(() => plusAPI.logout());
            if (cloudSession.isActive()) {
              window.location.hash = "";
            }
            setUser(null);
            setDialog(null);
          }}
        />
      </div>
    </Dialog>
  );
};
