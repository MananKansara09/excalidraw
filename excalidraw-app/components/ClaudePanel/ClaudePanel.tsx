import clsx from "clsx";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { checkBridge, streamChat } from "./claudeBridge";
import { applyOp, summarizeScene } from "./sceneOps";

import "./ClaudePanel.scss";

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
  const [bridgeUp, setBridgeUp] = useState<boolean | null>(null);
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
      const up = await checkBridge();
      if (!cancelled) {
        setBridgeUp(up);
      }
    };
    poll();
    // keep retrying while offline so it flips green once the bridge starts
    const id = window.setInterval(() => bridgeUp !== true && poll(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [open, bridgeUp]);

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
    if (!message || busy) {
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
        onError: (msg) => {
          if (/can't reach/i.test(msg)) {
            setBridgeUp(false);
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
                up: bridgeUp === true,
                down: bridgeUp === false,
              })}
            >
              {bridgeUp === null
                ? "connecting…"
                : bridgeUp
                ? "your Claude Code login"
                : "bridge offline"}
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
          <button title="Close" onClick={() => updatePrefs({ open: false })}>
            <Icon d="M6 6l12 12M18 6L6 18" />
          </button>
        </div>
      </header>

      <div className="claude-messages" ref={scrollRef}>
        {bridgeUp === false && (
          <div className="claude-banner">
            <strong>Start the local bridge</strong>
            <p>
              Claude runs on your own machine using your Claude Code login. In a
              terminal:
            </p>
            <code>cd claude-bridge && yarn install && yarn start</code>
            <p>
              Not signed in yet? Run <code>claude login</code> first.
            </p>
          </div>
        )}
        {!messages.length && (
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
          placeholder="Ask Claude to draw or edit…"
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
          <button className="claude-send" disabled={!input.trim()} title="Send">
            <Icon d="M5 12h14M13 6l6 6-6 6" />
          </button>
        )}
      </form>
    </aside>
  );
};
