import clsx from "clsx";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { goToSignIn } from "../../plus/auth";

import {
  disconnect,
  getStatus,
  startLogin,
  streamChat,
  submitLoginCode,
} from "./claudeBridge";
import { applyOp, summarizeScene } from "./sceneOps";

import "./ClaudePanel.scss";

import type { BridgeStatus } from "./claudeBridge";

type Dock = "right" | "bottom";
type Size = "small" | "large";

type Message = {
  id: number;
  role: "user" | "assistant";
  text: string;
  tools: string[];
  error?: boolean;
};

const PREFS_KEY = "excalidraw-claude-panel";

const SUGGESTIONS = [
  "Draw a microservices architecture with an API gateway, 3 services and a database",
  "Create a flowchart for a user login with 2FA",
  "Sketch a mind map about launching a product",
  "Make an ER diagram for a blog (users, posts, comments)",
];

const TOOL_LABELS: Record<string, string> = {
  add_elements: "Drawing",
  update_elements: "Editing",
  delete_elements: "Removing",
  clear_canvas: "Clearing canvas",
};

const loadPrefs = (): { open: boolean; dock: Dock; size: Size } => {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    return {
      open: !!raw.open,
      dock: raw.dock === "bottom" ? "bottom" : "right",
      size: raw.size === "large" ? "large" : "small",
    };
  } catch {
    return { open: false, dock: "right", size: "small" };
  }
};

const Icon = ({ d }: { d: string }) => (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d={d} />
  </svg>
);

const SPARK =
  "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z";

/** sign-in to the user's own Claude account: open the link, paste the code */
const ConnectCard = ({ onConnected }: { onConnected: () => void }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const begin = async () => {
    setBusy(true);
    setError("");
    // open synchronously so the popup isn't blocked, point it once we have the URL
    const popup = window.open("", "_blank");
    try {
      const authUrl = await startLogin();
      setUrl(authUrl);
      if (popup) {
        popup.location.href = authUrl;
      }
    } catch (e: any) {
      popup?.close();
      setError(e.message);
    }
    setBusy(false);
  };

  const finish = async () => {
    setBusy(true);
    setError("");
    try {
      await submitLoginCode(code.trim());
      onConnected();
    } catch (e: any) {
      setError(e.message);
      // a malformed code keeps the pending login; only restart when told to
      if (/start again/i.test(e.message)) {
        setUrl(null);
        setCode("");
      }
    }
    setBusy(false);
  };

  return (
    <div className="claude-connect">
      <div className="claude-empty-logo">
        <Icon d={SPARK} />
      </div>
      <h3>Connect your Claude account</h3>
      <p>
        Claude uses <b>your own</b> Claude subscription. You only do this once.
      </p>
      {!url ? (
        <button className="claude-primary" onClick={begin} disabled={busy}>
          {busy ? "Starting…" : "Sign in with Claude"}
        </button>
      ) : (
        <ol className="claude-steps">
          <li>
            <a href={url} target="_blank" rel="noopener noreferrer">
              Open the Claude sign-in page
            </a>{" "}
            and approve access.
          </li>
          <li>Copy the code it shows and paste it here:</li>
          <li>
            <input
              value={code}
              placeholder="Paste code…"
              autoFocus
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && code.trim() && finish()}
            />
            <button
              className="claude-primary"
              onClick={finish}
              disabled={busy || !code.trim()}
            >
              {busy ? "Connecting…" : "Connect"}
            </button>
          </li>
        </ol>
      )}
      {error && <div className="claude-connect-error">{error}</div>}
    </div>
  );
};

export const ClaudePanel = ({
  excalidrawAPI,
  theme,
}: {
  excalidrawAPI: ExcalidrawImperativeAPI;
  theme: "light" | "dark";
}) => {
  const [prefs, setPrefs] = useState(loadPrefs);
  const { open, dock, size } = prefs;
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const ready = status?.state === "ok" && status.loggedIn;
  const sessionId = useRef<string | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const updatePrefs = useCallback((patch: Partial<typeof prefs>) => {
    setPrefs((p) => {
      const next = { ...p, ...patch };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    const poll = async () => {
      const next = await getStatus();
      if (!cancelled) {
        setStatus(next);
      }
    };
    poll();
    // keep retrying while the bridge is down so it recovers on its own
    const id = window.setInterval(
      () => (!status || status.state === "offline") && poll(),
      3000,
    );
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [open, status]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  // after the panel moves/resizes, bring the drawing back into the free area
  const isFirstLayout = useRef(true);
  useEffect(() => {
    if (isFirstLayout.current) {
      isFirstLayout.current = false;
      return;
    }
    const id = window.setTimeout(() => {
      const elements = excalidrawAPI.getSceneElements();
      if (elements.length) {
        excalidrawAPI.setViewport({
          target: elements,
          fit: "scale-down",
          animation: { duration: 300 },
          offsets: { ui: true },
        });
      }
    }, 300);
    return () => window.clearTimeout(id);
  }, [open, dock, size, excalidrawAPI]);

  const patchLast = (fn: (m: Message) => Message) =>
    setMessages((ms) => ms.map((m, i) => (i === ms.length - 1 ? fn(m) : m)));

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy || !ready) {
      return;
    }
    setInput("");
    setBusy(true);
    setMessages((ms) => [
      ...ms,
      { id: nextId.current++, role: "user", text: message, tools: [] },
      { id: nextId.current++, role: "assistant", text: "", tools: [] },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;
    await streamChat(
      {
        message,
        sessionId: sessionId.current,
        scene: summarizeScene(excalidrawAPI),
      },
      {
        onSession: (id) => (sessionId.current = id),
        onText: (delta) => patchLast((m) => ({ ...m, text: m.text + delta })),
        onTool: (name) =>
          patchLast((m) => ({ ...m, tools: [...m.tools, name] })),
        onOps: (op) => applyOp(excalidrawAPI, op),
        onError: (msg, code) => {
          if (code === "offline") {
            setStatus({ state: "offline" });
          } else if (code === "signin_required") {
            setStatus({ state: "signin_required" });
          } else if (
            code === "authentication_failed" ||
            code === "oauth_org_not_allowed"
          ) {
            setStatus({ state: "ok", loggedIn: false, email: null });
          }
          patchLast((m) => ({ ...m, text: msg, error: true }));
        },
        onDone: () => {},
      },
      controller.signal,
    );
    abortRef.current = null;
    setBusy(false);
  };

  const stop = () => abortRef.current?.abort();

  const signOutOfClaude = async () => {
    stop();
    await disconnect();
    sessionId.current = undefined;
    setMessages([]);
    setStatus(await getStatus());
  };

  const reset = () => {
    stop();
    sessionId.current = undefined;
    setMessages([]);
  };

  if (!open) {
    return (
      <button
        className={clsx("claude-fab", `theme-${theme}`)}
        onClick={() => updatePrefs({ open: true })}
        title="Ask Claude to draw"
        aria-label="Open Claude"
      >
        <Icon d={SPARK} />
        <span>Claude</span>
      </button>
    );
  }

  return (
    <aside
      className={clsx(
        "claude-panel",
        `theme-${theme}`,
        `dock-${dock}`,
        `size-${size}`,
      )}
      // lets the editor keep fitted content clear of the docked panel
      data-viewport-ui={dock === "right" ? "side" : "bottom"}
      aria-label="Claude chat"
    >
      <header className="claude-header">
        <div className="claude-title">
          <span className="claude-logo">
            <Icon d={SPARK} />
          </span>
          <div>
            <strong>Claude</strong>
            <small
              className={clsx("claude-status", {
                up: ready,
                down: status?.state === "offline",
              })}
            >
              {!status
                ? "connecting…"
                : status.state === "offline"
                ? "bridge offline"
                : status.state === "signin_required"
                ? "sign in required"
                : status.loggedIn
                ? status.email || "your Claude account"
                : "not connected"}
            </small>
          </div>
        </div>
        <div className="claude-actions">
          <button
            title="New chat"
            onClick={reset}
            disabled={!messages.length && !busy}
          >
            <Icon d="M12 5v14M5 12h14" />
          </button>
          <button
            title={dock === "right" ? "Dock at bottom" : "Dock on the right"}
            onClick={() =>
              updatePrefs({ dock: dock === "right" ? "bottom" : "right" })
            }
          >
            <Icon
              d={
                dock === "right"
                  ? "M3 4h18v16H3zM3 14h18"
                  : "M3 4h18v16H3zM15 4v16"
              }
            />
          </button>
          <button
            title={size === "small" ? "Larger" : "Smaller"}
            onClick={() =>
              updatePrefs({ size: size === "small" ? "large" : "small" })
            }
          >
            <Icon
              d={
                size === "small"
                  ? "M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"
                  : "M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"
              }
            />
          </button>
          {ready && (
            <button title="Disconnect Claude account" onClick={signOutOfClaude}>
              <Icon d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
            </button>
          )}
          <button title="Close" onClick={() => updatePrefs({ open: false })}>
            <Icon d="M6 6l12 12M18 6L6 18" />
          </button>
        </div>
      </header>

      <div className="claude-messages" ref={scrollRef}>
        {status?.state === "offline" && (
          <div className="claude-banner">
            <strong>Claude bridge isn't running</strong>
            <p>
              Self-hosted? Make sure the <code>claude-bridge</code> service is
              up. Running locally? In a terminal:
            </p>
            <code>cd claude-bridge && yarn install && yarn start</code>
          </div>
        )}
        {status?.state === "signin_required" && (
          <div className="claude-connect">
            <div className="claude-empty-logo">
              <Icon d={SPARK} />
            </div>
            <h3>Sign in to use Claude</h3>
            <p>Sign in to your account first, then connect your Claude plan.</p>
            <button
              className="claude-primary"
              onClick={() => goToSignIn("signin")}
            >
              Sign in
            </button>
          </div>
        )}
        {status?.state === "ok" && !status.loggedIn && (
          <ConnectCard onConnected={async () => setStatus(await getStatus())} />
        )}
        {ready && !messages.length && (
          <div className="claude-empty">
            <div className="claude-empty-logo">
              <Icon d={SPARK} />
            </div>
            <h3>What shall we draw?</h3>
            <p>Describe a diagram or scene and I'll build it on the canvas.</p>
            <div className="claude-suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} disabled={busy}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => {
          const isLast = i === messages.length - 1;
          return (
            <div
              key={m.id}
              className={clsx("claude-msg", m.role, { error: m.error })}
            >
              {m.tools.length > 0 && (
                <div className="claude-tools">
                  {m.tools.map((t, j) => (
                    <span key={j} className="claude-chip">
                      ✦ {TOOL_LABELS[t] || t}
                    </span>
                  ))}
                </div>
              )}
              {(m.text || !(busy && isLast)) && (
                <div className="claude-bubble">{m.text}</div>
              )}
              {busy && isLast && m.role === "assistant" && !m.text && (
                <div className="claude-typing">
                  <i />
                  <i />
                  <i />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <form
        className="claude-composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <textarea
          ref={inputRef}
          value={input}
          rows={1}
          disabled={!ready}
          placeholder={
            ready ? "Ask Claude to draw or edit…" : "Connect Claude to start…"
          }
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              send(input);
            }
          }}
        />
        {busy ? (
          <button
            type="button"
            className="claude-send stop"
            onClick={stop}
            title="Stop"
          >
            <Icon d="M7 7h10v10H7z" />
          </button>
        ) : (
          <button
            className="claude-send"
            disabled={!ready || !input.trim()}
            title="Send"
          >
            <Icon d="M5 12h14M13 6l6 6-6 6" />
          </button>
        )}
      </form>
    </aside>
  );
};
