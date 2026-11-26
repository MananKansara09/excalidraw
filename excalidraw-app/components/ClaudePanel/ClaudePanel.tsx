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

type Message = {
  id: number;
  role: "user" | "assistant";
  text: string;
  thinking: string;
  /** ms spent thinking, set once the first answer/tool output arrives */
  thinkingMs?: number;
  thinkingStart?: number;
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

const loadPrefs = (): { open: boolean; wide: boolean } => {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    return { open: !!raw.open, wide: !!raw.wide };
  } catch {
    return { open: false, wide: false };
  }
};

const Icon = ({ d }: { d: string }) => (
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
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

/** the Claude starburst */
const ClaudeMark = ({ size = 18 }: { size?: number }) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    aria-hidden
  >
    {[0, 45, 90, 135, 180, 225, 270, 315].map((deg, i) => (
      <line
        key={deg}
        x1="12"
        y1={i % 2 ? 6.5 : 4}
        x2="12"
        y2="10"
        transform={`rotate(${deg} 12 12)`}
      />
    ))}
  </svg>
);

const SPINNER_FRAMES = ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"];

/** Claude Code's cycling spinner glyph */
const Spinner = () => {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = window.setInterval(
      () => setFrame((f) => (f + 1) % SPINNER_FRAMES.length),
      120,
    );
    return () => window.clearInterval(id);
  }, []);
  return <span className="claude-spinner">{SPINNER_FRAMES[frame]}</span>;
};

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

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
        <ClaudeMark size={26} />
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

const ThinkingBlock = ({
  message,
  live,
}: {
  message: Message;
  live: boolean;
}) => {
  const [expanded, setExpanded] = useState(false);
  const seconds = Math.max(1, Math.round((message.thinkingMs || 0) / 1000));
  return (
    <div className="claude-thinking">
      <button
        type="button"
        className="claude-thinking-head"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded || live}
      >
        {live ? <Spinner /> : <span className="claude-spinner">✻</span>}
        <span className={clsx({ "claude-shimmer": live })}>
          {live ? "Thinking…" : `Thought for ${seconds}s`}
        </span>
        <span className={clsx("claude-caret", { open: expanded || live })}>
          ›
        </span>
      </button>
      {(expanded || live) && (
        <div className="claude-thinking-body">{message.thinking.trim()}</div>
      )}
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
  const { open, wide } = prefs;
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

  // the bottom bar is always on screen, so always know the connection state
  useEffect(() => {
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
  }, [status]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, open]);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  // after the panel opens/closes/resizes, bring the drawing back into view
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
  }, [open, wide, excalidrawAPI]);

  const patchLast = (fn: (m: Message) => Message) =>
    setMessages((ms) => ms.map((m, i) => (i === ms.length - 1 ? fn(m) : m)));

  // freezes the "Thought for Ns" timer when the answer/tools start
  const endThinking = (m: Message): Message =>
    m.thinkingStart && m.thinkingMs === undefined
      ? { ...m, thinkingMs: Date.now() - m.thinkingStart }
      : m;

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) {
      return;
    }
    if (!ready) {
      // the connect / sign-in cards live in the chat panel
      updatePrefs({ open: true });
      return;
    }
    setInput("");
    setBusy(true);
    setMessages((ms) => [
      ...ms,
      {
        id: nextId.current++,
        role: "user",
        text: message,
        thinking: "",
        tools: [],
      },
      {
        id: nextId.current++,
        role: "assistant",
        text: "",
        thinking: "",
        tools: [],
      },
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
        onThinking: (delta) =>
          patchLast((m) => ({
            ...m,
            thinking: m.thinking + delta,
            thinkingStart: m.thinkingStart ?? Date.now(),
          })),
        onText: (delta) =>
          patchLast((m) => ({ ...endThinking(m), text: m.text + delta })),
        onTool: (name) =>
          patchLast((m) => ({ ...endThinking(m), tools: [...m.tools, name] })),
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
          patchLast((m) => ({ ...endThinking(m), text: msg, error: true }));
        },
        onDone: () => patchLast(endThinking),
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

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const lastClaude = [...messages]
    .reverse()
    .find((m) => m.role === "assistant");
  const liveClaude = busy && lastClaude === messages[messages.length - 1];

  const claudeLine = (() => {
    if (!lastClaude) {
      return null;
    }
    if (lastClaude.text) {
      return oneLine(lastClaude.text);
    }
    if (liveClaude) {
      const tool = lastClaude.tools[lastClaude.tools.length - 1];
      return tool ? `${TOOL_LABELS[tool] || tool}…` : "Thinking…";
    }
    return lastClaude.tools.length ? "Done" : "";
  })();

  const mark = (cls?: string) => (
    <span className={clsx("claude-avatar", cls)}>
      <ClaudeMark size={16} />
    </span>
  );

  return (
    <div className={clsx("claude-root", `theme-${theme}`)}>
      {/* the one entry point: a single Claude icon in the corner */}
      {!open && (
        <button
          className="claude-fab"
          onClick={() => updatePrefs({ open: true })}
          title="Open Claude"
          aria-label="Open Claude"
        >
          <ClaudeMark size={22} />
        </button>
      )}

      {/* single-line chat at the bottom of the canvas */}
      <div
        className={clsx("claude-bar", {
          "panel-open": open,
          wide: open && wide,
        })}
      >
        {(lastUser || lastClaude) && (
          <div
            className="claude-bar-lines"
            role="button"
            tabIndex={0}
            title="Open the full conversation"
            onClick={() => updatePrefs({ open: true })}
            onKeyDown={(e) =>
              (e.key === "Enter" || e.key === " ") &&
              updatePrefs({ open: true })
            }
          >
            {lastUser && (
              <div className="claude-bar-line user">
                <span className="claude-bar-prompt">&gt;</span>
                <span className="claude-bar-text">
                  {oneLine(lastUser.text)}
                </span>
              </div>
            )}
            {lastClaude && claudeLine !== "" && (
              <div
                className={clsx("claude-bar-line", {
                  error: lastClaude.error,
                })}
              >
                {liveClaude && !lastClaude.text ? (
                  <Spinner />
                ) : (
                  <span className="claude-dot">●</span>
                )}
                <span
                  className={clsx("claude-bar-text", {
                    "claude-shimmer": liveClaude && !lastClaude.text,
                  })}
                >
                  {claudeLine}
                </span>
              </div>
            )}
          </div>
        )}
        <form
          className="claude-bar-input"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          {mark()}
          <input
            value={input}
            placeholder="Ask Claude to draw or edit…"
            aria-label="Message Claude"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
          {busy ? (
            <button
              type="button"
              className="claude-send stop"
              onClick={stop}
              title="Stop"
              aria-label="Stop"
            >
              <Icon d="M7 7h10v10H7z" />
            </button>
          ) : (
            <button
              className="claude-send"
              disabled={!input.trim()}
              title="Send"
              aria-label="Send"
            >
              <Icon d="M12 19V5M5 12l7-7 7 7" />
            </button>
          )}
        </form>
      </div>

      {open && (
        <aside
          className={clsx("claude-panel", { wide })}
          // lets the editor keep fitted content clear of the docked panel
          data-viewport-ui="side"
          aria-label="Claude chat"
        >
          <header className="claude-header">
            <div className="claude-title">
              {mark("lg")}
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
                title={wide ? "Narrower" : "Wider"}
                onClick={() => updatePrefs({ wide: !wide })}
              >
                <Icon
                  d={
                    wide
                      ? "M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"
                      : "M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"
                  }
                />
              </button>
              {ready && (
                <button
                  title="Disconnect Claude account"
                  onClick={signOutOfClaude}
                >
                  <Icon d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
                </button>
              )}
              <button
                title="Close"
                onClick={() => updatePrefs({ open: false })}
              >
                <Icon d="M6 6l12 12M18 6L6 18" />
              </button>
            </div>
          </header>

          <div className="claude-messages" ref={scrollRef}>
            {status?.state === "offline" && (
              <div className="claude-banner">
                <strong>Claude bridge isn't running</strong>
                <p>
                  Self-hosted? Make sure the <code>claude-bridge</code> service
                  is up. Running locally? In a terminal:
                </p>
                <code>cd claude-bridge && yarn install && yarn start</code>
              </div>
            )}
            {status?.state === "signin_required" && (
              <div className="claude-connect">
                <div className="claude-empty-logo">
                  <ClaudeMark size={26} />
                </div>
                <h3>Sign in to use Claude</h3>
                <p>
                  Sign in to your account first, then connect your Claude plan.
                </p>
                <button
                  className="claude-primary"
                  onClick={() => goToSignIn("signin")}
                >
                  Sign in
                </button>
              </div>
            )}
            {status?.state === "ok" && !status.loggedIn && (
              <ConnectCard
                onConnected={async () => setStatus(await getStatus())}
              />
            )}
            {ready && !messages.length && (
              <div className="claude-empty">
                <div className="claude-empty-logo">
                  <ClaudeMark size={26} />
                </div>
                <h3>What shall we draw?</h3>
                <p>
                  Describe a diagram or scene and I'll build it on the canvas.
                </p>
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
              const live = busy && isLast && m.role === "assistant";
              if (m.role === "user") {
                return (
                  <div key={m.id} className="claude-msg user">
                    <div className="claude-user-text">{m.text}</div>
                  </div>
                );
              }
              const thinkingLive =
                live && !!m.thinking && m.thinkingMs === undefined;
              return (
                <div
                  key={m.id}
                  className={clsx("claude-msg", { error: m.error })}
                >
                  {m.thinking && (
                    <ThinkingBlock message={m} live={thinkingLive} />
                  )}
                  {m.tools.map((t, j) => {
                    const toolLive =
                      live && j === m.tools.length - 1 && !m.text;
                    return (
                      <div key={j} className="claude-tool">
                        {toolLive ? (
                          <Spinner />
                        ) : (
                          <span className="claude-dot ok">●</span>
                        )}
                        <span className={clsx({ "claude-shimmer": toolLive })}>
                          {TOOL_LABELS[t] || t}
                        </span>
                      </div>
                    );
                  })}
                  {m.text && (
                    <div className="claude-reply">
                      <span className="claude-dot">●</span>
                      <div className="claude-reply-text">{m.text}</div>
                    </div>
                  )}
                  {live && !m.text && !m.tools.length && !thinkingLive && (
                    <div className="claude-tool">
                      <Spinner />
                      <span className="claude-shimmer">Thinking…</span>
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
                ready
                  ? "Ask Claude to draw or edit…"
                  : "Connect Claude to start…"
              }
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
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
                aria-label="Stop"
              >
                <Icon d="M7 7h10v10H7z" />
              </button>
            ) : (
              <button
                className="claude-send"
                disabled={!ready || !input.trim()}
                title="Send"
                aria-label="Send"
              >
                <Icon d="M12 19V5M5 12l7-7 7 7" />
              </button>
            )}
          </form>
        </aside>
      )}
    </div>
  );
};
