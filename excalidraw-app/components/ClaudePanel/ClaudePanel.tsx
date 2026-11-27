import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { newElementWith } from "@excalidraw/element";
import clsx from "clsx";
import { useCallback, useEffect, useRef, useState } from "react";

import type { OrderedExcalidrawElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { goToSignIn } from "../../plus/auth";

import { HistoryView, LogsView, formatSize } from "./ClaudeViews";
import { Markdown } from "./Markdown";
import { ModelPicker } from "./ModelPicker";
import {
  disconnect,
  getModels,
  getStatus,
  openAgentTerminal,
  startLogin,
  streamChat,
  submitLoginCode,
} from "./claudeBridge";
import { loadChats, newChatId, saveChats } from "./history";
import { applyOp, summarizeScene } from "./sceneOps";

import "./ClaudePanel.scss";

import type { Layout } from "./AgentHub";
import type { Agent, AgentId } from "./agents";
import type { BridgeStatus, ModelChoice } from "./claudeBridge";
import type { Chat, LogBody, LogEvent, Message, ToolCall } from "./history";

type View = "chat" | "logs" | "history";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 5;
const ACCEPT =
  ".pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.md,.markdown,.csv,.tsv,.json,.xml,.yaml,.yml,.html,.css,.js,.ts,.tsx,.py,.sql,.mmd,.log";

/** starter diagrams on the empty chat */
const SUGGESTIONS = [
  {
    title: "Flowchart",
    hint: "Steps and decisions",
    icon: "M8 3h8v5H8zM12 8v4M12 12l5 4.5-5 4.5-5-4.5z",
    prompt: "Create a flowchart for a user login with 2FA",
  },
  {
    title: "Architecture",
    hint: "Services and data",
    icon: "M9 3h6v5H9zM3 16h6v5H3zM15 16h6v5h-6zM12 8v4M6 16v-4h12v4",
    prompt:
      "Draw a microservices architecture with an API gateway, 3 services and a database",
  },
  {
    title: "Bar chart",
    hint: "Compare values",
    icon: "M4 4v16h16M8 16v-5M12.5 16V8M17 16v-3",
    prompt:
      "Draw a bar chart comparing quarterly revenue (sample data), with labelled axes",
  },
  {
    title: "Mind map",
    hint: "Branch out ideas",
    icon: "M9 12h6M9 12 5 6M9 12l-4 6M15 12l4-6M15 12l4 6",
    prompt: "Sketch a mind map about launching a product",
  },
  {
    title: "ER diagram",
    hint: "Tables and relations",
    icon: "M3 5h7v14H3zM14 5h7v14h-7zM3 10h7M14 10h7M10 14h4",
    prompt: "Make an ER diagram for a blog (users, posts, comments)",
  },
  {
    title: "Timeline",
    hint: "Roadmap and phases",
    icon: "M3 12h18M7 12V7M12 12v5M17 12V7",
    prompt: "Draw a product roadmap timeline with four quarters and milestones",
  },
];

/** one-tap refinements offered under a finished drawing */
const FOLLOW_UPS = ["Tidy up the layout", "Add colour coding", "Add labels"];

const TOOL_LABELS: Record<string, string> = {
  add_elements: "Drawing",
  update_elements: "Editing",
  delete_elements: "Removing",
  clear_canvas: "Clearing canvas",
};

/** the saved model choice; Claude's used to live with the layout prefs */
const loadModel = (agent: Agent): string => {
  try {
    const saved = localStorage.getItem(agent.modelKey);
    if (saved) {
      return saved;
    }
    if (agent.id === "claude") {
      const old = JSON.parse(
        localStorage.getItem("excalidraw-claude-panel") || "{}",
      );
      if (typeof old.model === "string") {
        return old.model;
      }
    }
  } catch {}
  return "default";
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

const ICON = {
  clip: "m21 11-9.2 9.2a5 5 0 0 1-7-7l9.2-9.2a3.5 3.5 0 0 1 5 5L9.8 18.2a2 2 0 0 1-3-3L15 7",
  panel: "M3 4h18v16H3zM15 4v16",
  bar: "M3 4h18v16H3zM3 15h18",
  close: "M6 6l12 12M18 6L6 18",
  plus: "M12 5v14M5 12h14",
  send: "M12 19V5M5 12l7-7 7 7",
  stop: "M7 7h10v10H7z",
  wider: "M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7",
  narrower: "M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7",
  signOut: "M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9",
  down: "M12 5v14M5 12l7 7 7-7",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  check: "m5 12 5 5 9-10",
  fit: "M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5",
  rewind: "M4 4v6h6M4.5 10a8 8 0 1 1 .5 6",
};

/**
 * The editor listens for keys on the whole document, so anything pressed while
 * in the chat must stay in the chat. Ctrl/Cmd shortcuts still reach the canvas
 * (e.g. undoing a restore) unless a text field is focused.
 */
const keepKeysInChat = (e: React.KeyboardEvent) => {
  const typing =
    e.target instanceof HTMLInputElement ||
    e.target instanceof HTMLTextAreaElement;
  if (typing || !(e.ctrlKey || e.metaKey)) {
    e.stopPropagation();
  }
};

const readFileAsBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error(`Couldn't read ${file.name}`));
    reader.readAsDataURL(file);
  });

const SPINNER_FRAMES = ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"];

/** a cycling spinner glyph, as in the CLIs */
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

const patchCall = (
  calls: ToolCall[] | undefined,
  match: (c: ToolCall) => boolean,
  patch: Partial<ToolCall>,
): ToolCall[] | undefined => {
  const index = calls ? calls.findLastIndex(match) : -1;
  if (!calls || index === -1) {
    return calls;
  }
  return calls.map((c, i) => (i === index ? { ...c, ...patch } : c));
};

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** sign-in to the user's own account: open the link, paste the code */
const ConnectCard = ({
  agent,
  onConnected,
}: {
  agent: Agent;
  onConnected: () => void;
}) => {
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
      const { url: authUrl } = await startLogin(agent.base);
      setUrl(authUrl);
      if (popup) {
        popup.opener = null;
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
      await submitLoginCode(agent.base, code.trim());
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
      <agent.Logo size={36} />
      <h3>Connect your {agent.name} account</h3>
      <p>
        {agent.name} uses <b>your own</b> subscription. You only do this once.
      </p>
      {!url ? (
        <button className="claude-primary" onClick={begin} disabled={busy}>
          {busy ? "Starting…" : `Sign in with ${agent.name}`}
        </button>
      ) : (
        <ol className="claude-steps">
          <li>
            <a href={url} target="_blank" rel="noopener noreferrer">
              Open the {agent.name} sign-in page
            </a>{" "}
            and approve access.
          </li>
          <li>Copy the code it shows and paste it here:</li>
          <li>
            <input
              className="claude-field"
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

/**
 * On your own computer, Antigravity signs in inside its own CLI: open a
 * terminal there, then watch for the login to appear.
 */
const AntigravityConnectCard = ({
  agent,
  installed,
  onCheck,
}: {
  agent: Agent;
  installed: boolean;
  onCheck: () => void;
}) => {
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!waiting) {
      return;
    }
    const id = window.setInterval(onCheck, 4000);
    return () => window.clearInterval(id);
  }, [waiting, onCheck]);

  const begin = async () => {
    setError("");
    try {
      await openAgentTerminal(agent.base, "login");
      setWaiting(true);
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div className="claude-connect">
      <agent.Logo size={36} />
      <h3>Sign in to Antigravity</h3>
      {installed ? (
        <>
          <p>
            Antigravity uses <b>your own</b> Antigravity sign-in, through the{" "}
            <code>agy</code> CLI on this computer.
          </p>
          <button className="claude-primary" onClick={begin}>
            {waiting ? "Open the terminal again" : "Sign in with Antigravity"}
          </button>
          {waiting && (
            <p className="claude-shimmer">
              Finish signing in in the terminal window. This updates on its own.
            </p>
          )}
        </>
      ) : (
        <>
          <p>
            Install the Antigravity CLI (<code>agy</code>) on the computer that
            runs the bridge, then check again.
          </p>
          <button className="claude-primary" onClick={onCheck}>
            Check again
          </button>
        </>
      )}
      {error && <div className="claude-connect-error">{error}</div>}
    </div>
  );
};

/**
 * Codex signs in to ChatGPT in the browser, which hands the login back to the
 * bridge (on a shared one, after entering a one-time code there): open the
 * page, then watch for the login to appear.
 */
const CodexConnectCard = ({
  agent,
  installed,
  onCheck,
}: {
  agent: Agent;
  installed: boolean;
  onCheck: () => void;
}) => {
  const [url, setUrl] = useState<string | null>(null);
  const [userCode, setUserCode] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!url) {
      return;
    }
    const id = window.setInterval(onCheck, 3000);
    return () => window.clearInterval(id);
  }, [url, onCheck]);

  const begin = async () => {
    setBusy(true);
    setError("");
    // open synchronously so the popup isn't blocked, point it once we have the URL
    const popup = window.open("", "_blank");
    try {
      const login = await startLogin(agent.base);
      setUrl(login.url);
      setUserCode(login.userCode);
      if (popup) {
        popup.opener = null;
        popup.location.href = login.url;
      }
    } catch (e: any) {
      popup?.close();
      setError(e.message);
    }
    setBusy(false);
  };

  return (
    <div className="claude-connect">
      <agent.Logo size={36} />
      <h3>Sign in to Codex</h3>
      {installed ? (
        <>
          <p>
            Codex uses <b>your own</b> ChatGPT plan. You only do this once.
          </p>
          <button className="claude-primary" onClick={begin} disabled={busy}>
            {busy
              ? "Starting…"
              : url
              ? "Start sign-in again"
              : "Sign in with ChatGPT"}
          </button>
          {url && (
            <>
              <a href={url} target="_blank" rel="noopener noreferrer">
                Open the sign-in page
              </a>
              {userCode && (
                <p>
                  Enter this code there: <code>{userCode}</code>
                </p>
              )}
              <p className="claude-shimmer">
                Approve access in the browser. This updates on its own.
              </p>
            </>
          )}
        </>
      ) : (
        <>
          <p>
            Install Codex for the bridge (<code>yarn install:codex-bridge</code>
            ), restart it, then check again.
          </p>
          <button className="claude-primary" onClick={onCheck}>
            Check again
          </button>
        </>
      )}
      {error && <div className="claude-connect-error">{error}</div>}
    </div>
  );
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** one step of Claude's work: "Drawing · 12 elements", with its outcome */
const ToolStep = ({
  name,
  call,
  live,
}: {
  name: string;
  call?: ToolCall;
  live: boolean;
}) => {
  const label = TOOL_LABELS[name] || name.replace(/^mcp__\w+__/, "");
  const status = call?.status ?? (live ? "running" : "done");
  const running = live && status === "running";
  return (
    <li className={clsx("claude-step", status)}>
      <span className="claude-step-node" aria-hidden>
        {running ? <Spinner /> : status === "error" ? "✕" : "✓"}
      </span>
      <span
        className={clsx("claude-step-label", { "claude-shimmer": running })}
      >
        {running ? `${label}…` : label}
      </span>
      {call?.count !== undefined && (
        <span className="claude-step-chip">
          {plural(call.count, "element")}
        </span>
      )}
      {call?.durationMs !== undefined && !running && (
        <span className="claude-step-time">
          {(call.durationMs / 1000).toFixed(1)}s
        </span>
      )}
    </li>
  );
};

/** the canvas work of one reply as a timeline; long finished runs fold away */
const Activity = ({ message, live }: { message: Message; live: boolean }) => {
  const [toggled, setToggled] = useState<boolean | null>(null);
  const working = live && !message.text;
  const expanded = toggled ?? (working || message.tools.length <= 3);
  const elements = (message.toolCalls ?? []).reduce(
    (sum, c) => sum + (c.count ?? 0),
    0,
  );
  return (
    <div className="claude-activity">
      <button
        type="button"
        className="claude-activity-head"
        aria-expanded={expanded}
        onClick={() => setToggled(!expanded)}
      >
        <span className={clsx({ "claude-shimmer": working })}>
          {working
            ? "Working on the canvas"
            : plural(message.tools.length, "step")}
        </span>
        {elements > 0 && (
          <span className="claude-activity-total">
            {plural(elements, "element")}
          </span>
        )}
        <span className={clsx("claude-caret", { open: expanded })}>›</span>
      </button>
      {expanded && (
        <ol className="claude-timeline">
          {message.tools.map((name, j) => (
            <ToolStep
              key={j}
              name={name}
              call={message.toolCalls?.[j]}
              live={working && j === message.tools.length - 1}
            />
          ))}
        </ol>
      )}
    </div>
  );
};

const CopyButton = ({ text }: { text: string }) => {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title="Copy reply"
      aria-label="Copy reply"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {}
      }}
    >
      <Icon d={copied ? ICON.check : ICON.copy} />
    </button>
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
        <Markdown
          className="claude-thinking-body"
          text={message.thinking.trim()}
        />
      )}
    </div>
  );
};

/** one assistant's chat: the bottom bar or the side panel */
export const ClaudePanel = ({
  agent,
  active,
  layout,
  onLayout,
  onBusyChange,
  excalidrawAPI,
  theme,
}: {
  agent: Agent;
  /** whether this is the assistant picked on the plate */
  active: boolean;
  layout: Layout;
  onLayout: (patch: Partial<Layout>) => void;
  onBusyChange: (id: AgentId, busy: boolean) => void;
  excalidrawAPI: ExcalidrawImperativeAPI;
  theme: "light" | "dark";
}) => {
  const { wide, mode } = layout;
  const open = active && layout.open;
  const { name } = agent;
  const [modelPref, setModelPref] = useState(() => loadModel(agent));
  const [view, setView] = useState<View>("chat");
  const [messages, setMessages] = useState<Message[]>([]);
  const [logs, setLogs] = useState<LogEvent[]>([]);
  const [chats, setChats] = useState<Chat[]>(() => loadChats(agent.historyKey));
  const [chatId, setChatId] = useState(newChatId);
  /** user-message id of the checkpoint shown in the bar (null = latest) */
  const [focusId, setFocusId] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const ready = status?.state === "ok" && status.loggedIn;
  const owner =
    ready && status.state === "ok"
      ? status.email || status.user || agent.id
      : null;
  const plan = status?.state === "ok" ? status.plan : null;
  const [models, setModels] = useState<ModelChoice[]>([]);
  // a saved choice this account doesn't offer falls back to the first
  const model = models.find((m) => m.value === modelPref) ?? models[0];
  const sessionId = useRef<string | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  /** the canvas as it was before each prompt, so any prompt can be rewound */
  const checkpoints = useRef(new Map<number, OrderedExcalidrawElement[]>());
  const scrollRef = useRef<HTMLDivElement>(null);
  /** follow new output, until the reader scrolls up */
  const stickRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const refreshStatus = useCallback(
    async (fresh = false) => setStatus(await getStatus(agent.base, fresh)),
    [agent],
  );

  const checkStatus = useCallback(() => refreshStatus(), [refreshStatus]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const next = await getStatus(agent.base);
      if (!cancelled) {
        setStatus(next);
      }
    };
    if (!status) {
      poll();
    }
    // keep retrying while the bridge is down so it recovers on its own
    const id = window.setInterval(
      () => status?.state === "offline" && poll(),
      3000,
    );
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [status, agent]);

  // after a sign-out was started in the terminal, wait for it to take effect
  const [signingOut, setSigningOut] = useState(false);
  useEffect(() => {
    if (!signingOut) {
      return;
    }
    if (!ready) {
      setSigningOut(false);
      return;
    }
    const id = window.setInterval(() => refreshStatus(true), 8000);
    const stopWaiting = window.setTimeout(() => setSigningOut(false), 120000);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(stopWaiting);
    };
  }, [signingOut, ready, refreshStatus]);

  useEffect(() => {
    onBusyChange(agent.id, busy);
  }, [agent, busy, onBusyChange]);

  // each account has its own model list
  useEffect(() => {
    setModels([]);
    if (!owner) {
      return;
    }
    let cancelled = false;
    getModels(agent.base).then((next) => !cancelled && setModels(next));
    return () => {
      cancelled = true;
    };
  }, [owner, agent]);

  const scrollToLatest = useCallback(() => {
    stickRef.current = true;
    setAtBottom(true);
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, []);

  // history and empty states read from the top; chat and logs follow along
  const hasFeed =
    view === "logs" ? logs.length > 0 : view === "chat" && messages.length > 0;
  useEffect(() => {
    if (!hasFeed) {
      scrollRef.current?.scrollTo({ top: 0 });
      setAtBottom(true);
    } else if (stickRef.current) {
      scrollToLatest();
    }
  }, [messages, logs, view, open, mode, hasFeed, scrollToLatest]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (el && hasFeed) {
      const near = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
      stickRef.current = near;
      setAtBottom(near);
    }
  };

  // close the "⋯" menu on any outside click
  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const close = () => setMenuOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menuOpen]);

  useEffect(() => {
    if (open && mode === "panel") {
      inputRef.current?.focus();
    }
  }, [open, mode]);

  // the composer grows with its text: one line at rest, capped by max-height in CSS
  useEffect(() => {
    const el = inputRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [input, open, mode]);

  const fitDrawing = useCallback(() => {
    const elements = excalidrawAPI.getSceneElements();
    if (elements.length) {
      excalidrawAPI.setViewport({
        target: elements,
        fit: "scale-down",
        animation: { duration: 300 },
        offsets: { ui: true },
      });
    }
  }, [excalidrawAPI]);

  // after the side panel opens/closes/resizes, bring the drawing back in view
  const panelShown = open && mode === "panel";
  const isFirstLayout = useRef(true);
  useEffect(() => {
    if (isFirstLayout.current) {
      isFirstLayout.current = false;
      return;
    }
    // only the chat in front moves the canvas
    if (!active) {
      return;
    }
    const id = window.setTimeout(fitDrawing, 300);
    return () => window.clearTimeout(id);
    // switching assistants changes `active`, not the layout: don't refit then
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelShown, wide, fitDrawing]);

  // keep this chat in the saved history
  useEffect(() => {
    if (!owner || !messages.length) {
      return;
    }
    const id = window.setTimeout(() => {
      setChats((prev) => {
        const existing = prev.find((c) => c.id === chatId);
        const first = messages.find((m) => m.role === "user");
        const chat: Chat = {
          id: chatId,
          owner,
          title: (first?.text || "New chat").slice(0, 60),
          sessionId: sessionId.current,
          createdAt: existing?.createdAt ?? Date.now(),
          updatedAt: Date.now(),
          messages,
          logs,
        };
        const next = [chat, ...prev.filter((c) => c.id !== chatId)];
        saveChats(agent.historyKey, next);
        return next;
      });
    }, 400);
    return () => window.clearTimeout(id);
  }, [messages, logs, owner, chatId, agent]);

  const ownChats = chats
    .filter((c) => c.owner === owner)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const patchLast = (fn: (m: Message) => Message) =>
    setMessages((ms) => ms.map((m, i) => (i === ms.length - 1 ? fn(m) : m)));

  const addLog = (event: LogBody) =>
    setLogs((l) => [
      ...l,
      { ...event, id: nextId.current++, at: Date.now() } as LogEvent,
    ]);

  /** streamed text/thinking grows one log line instead of one per token */
  const appendLog = (kind: "text" | "thinking", delta: string) =>
    setLogs((l) => {
      const last = l[l.length - 1];
      if (last && last.kind === kind) {
        return [...l.slice(0, -1), { ...last, text: last.text + delta }];
      }
      return [
        ...l,
        { kind, text: delta, id: nextId.current++, at: Date.now() } as LogEvent,
      ];
    });

  const patchTool = (
    match: (e: Extract<LogEvent, { kind: "tool" }>) => boolean,
    patch: Partial<Extract<LogEvent, { kind: "tool" }>>,
  ) =>
    setLogs((l) => {
      const index = l.findLastIndex((e) => e.kind === "tool" && match(e));
      if (index === -1) {
        return l;
      }
      const next = l.slice();
      next[index] = { ...next[index], ...patch } as LogEvent;
      return next;
    });

  // freezes the "Thought for Ns" timer when the answer/tools start
  const endThinking = (m: Message): Message =>
    m.thinkingStart && m.thinkingMs === undefined
      ? { ...m, thinkingMs: Date.now() - m.thinkingStart }
      : m;

  const addFiles = (incoming: File[]) => {
    let next = files;
    let error = "";
    for (const file of incoming) {
      const ext = `.${file.name.split(".").pop()?.toLowerCase()}`;
      if (next.length >= MAX_FILES) {
        error = `You can attach up to ${MAX_FILES} files.`;
      } else if (file.size > MAX_FILE_BYTES) {
        error = `${file.name} is larger than 5 MB.`;
      } else if (!ACCEPT.split(",").includes(ext)) {
        error = `${file.name} can't be read. Attach a PDF, an image or a text file; export Word and Excel files to PDF or CSV first.`;
      } else {
        next = [...next, file];
      }
    }
    setFiles(next);
    setFileError(error);
  };

  const send = async (text: string) => {
    const message =
      text.trim() || (files.length ? "Use the attached file(s)." : "");
    if (!message || busy) {
      return;
    }
    if (!ready) {
      // the connect / sign-in cards live in the side panel
      onLayout({ open: true, mode: "panel" });
      return;
    }
    stickRef.current = true;
    // a clicked suggestion disappears; don't let focus fall back to the page
    inputRef.current?.focus();
    const sent = files;
    const userId = nextId.current++;
    setFocusId(null);
    checkpoints.current.set(userId, [
      ...excalidrawAPI.getSceneElementsIncludingDeleted(),
    ]);
    setInput("");
    setFiles([]);
    setFileError("");
    setBusy(true);
    const fileInfo = sent.map((f) => ({ name: f.name, size: f.size }));
    setMessages((ms) => [
      ...ms,
      {
        id: userId,
        role: "user",
        text: message,
        thinking: "",
        tools: [],
        files: fileInfo,
      },
      {
        id: nextId.current++,
        role: "assistant",
        text: "",
        thinking: "",
        tools: [],
      },
    ]);
    addLog({ kind: "user", text: message, files: fileInfo });

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const attachments = await Promise.all(
        sent.map(async (file) => ({
          name: file.name,
          mediaType: file.type || "application/octet-stream",
          data: await readFileAsBase64(file),
        })),
      );
      await streamChat(
        agent.base,
        {
          message,
          sessionId: sessionId.current,
          model: model?.value,
          scene: summarizeScene(excalidrawAPI),
          attachments,
        },
        {
          onSession: (id, model) => {
            if (id !== sessionId.current) {
              addLog({ kind: "session", sessionId: id, model });
            }
            sessionId.current = id;
          },
          onThinking: (delta) => {
            appendLog("thinking", delta);
            patchLast((m) => ({
              ...m,
              thinking: m.thinking + delta,
              thinkingStart: m.thinkingStart ?? Date.now(),
            }));
          },
          onText: (delta) => {
            appendLog("text", delta);
            patchLast((m) => ({ ...endThinking(m), text: m.text + delta }));
          },
          onTool: (name) => {
            addLog({ kind: "tool", name, status: "running" });
            patchLast((m) => ({
              ...endThinking(m),
              tools: [...m.tools, name],
              toolCalls: [
                ...(m.toolCalls ?? []),
                { name, status: "running", startedAt: Date.now() },
              ],
            }));
          },
          onToolUse: ({ id, name, input }) => {
            patchTool((e) => e.name === name && !e.toolId, {
              toolId: id,
              input,
            });
            const i = input as any;
            const count =
              i?.elements?.length ?? i?.updates?.length ?? i?.ids?.length;
            patchLast((m) => ({
              ...m,
              toolCalls: patchCall(
                m.toolCalls,
                (c) => c.name === name && !c.toolId,
                { toolId: id, count },
              ),
            }));
          },
          onToolResult: ({ id, output, isError }) => {
            patchTool((e) => e.toolId === id, {
              output,
              status: isError ? "error" : "done",
            });
            patchLast((m) => ({
              ...m,
              toolCalls: patchCall(m.toolCalls, (c) => c.toolId === id, {
                status: isError ? "error" : "done",
                result: output?.split("\n")[0].slice(0, 200),
                durationMs:
                  Date.now() -
                  (m.toolCalls?.find((c) => c.toolId === id)?.startedAt ??
                    Date.now()),
              }),
            }));
          },
          onOps: (op) => {
            applyOp(excalidrawAPI, op);
            const count =
              op.op === "add"
                ? op.elements.length
                : op.op === "update"
                ? op.updates.length
                : op.op === "delete"
                ? op.ids.length
                : 0;
            addLog({
              kind: "canvas",
              text: `${op.op}${count ? ` · ${count} element(s)` : ""}`,
            });
          },
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
            addLog({ kind: "error", text: msg });
            patchLast((m) => ({ ...endThinking(m), text: msg, error: true }));
          },
          onDone: (stats) => {
            const parts = ["Done"];
            if (stats?.durationMs) {
              parts.push(`${(stats.durationMs / 1000).toFixed(1)}s`);
            }
            if (stats?.turns) {
              parts.push(`${stats.turns} turn(s)`);
            }
            addLog({ kind: "done", text: parts.join(" · ") });
            patchLast(endThinking);
          },
        },
        controller.signal,
      );
    } catch (e: any) {
      const msg = e?.message || "Something went wrong.";
      addLog({ kind: "error", text: msg });
      patchLast((m) => ({ ...m, text: msg, error: true }));
    }
    // a tool call cut off by an error or Stop is not still running
    patchTool((e) => e.status === "running", { status: "error" });
    patchLast((m) => ({
      ...m,
      toolCalls: m.toolCalls?.map((c) =>
        c.status === "running" ? { ...c, status: "error" } : c,
      ),
    }));
    abortRef.current = null;
    setBusy(false);
  };

  const stop = () => abortRef.current?.abort();

  const resetChat = () => {
    stop();
    sessionId.current = undefined;
    checkpoints.current.clear();
    setFocusId(null);
    setMenuOpen(false);
    setMessages([]);
    setLogs([]);
    setChatId(newChatId());
  };

  const newChat = () => {
    resetChat();
    setView("chat");
  };

  const openChat = (chat: Chat) => {
    stop();
    checkpoints.current.clear();
    stickRef.current = true;
    setFocusId(null);
    setMenuOpen(false);
    sessionId.current = chat.sessionId;
    nextId.current =
      Math.max(
        0,
        ...chat.messages.map((m) => m.id),
        ...chat.logs.map((l) => l.id),
      ) + 1;
    setMessages(chat.messages);
    setLogs(chat.logs);
    setChatId(chat.id);
    setView("chat");
  };

  const deleteChat = (id: string) => {
    setChats((prev) => {
      const next = prev.filter((c) => c.id !== id);
      saveChats(agent.historyKey, next);
      return next;
    });
    if (id === chatId) {
      resetChat();
    }
  };

  const clearChats = () => {
    if (!window.confirm("Delete all past chats?")) {
      return;
    }
    setChats((prev) => {
      const next = prev.filter((c) => c.owner !== owner);
      saveChats(agent.historyKey, next);
      return next;
    });
    resetChat();
  };

  /** puts the canvas back as it was before a prompt (undoable with Ctrl+Z) */
  const restoreCheckpoint = (messageId: number) => {
    const snapshot = checkpoints.current.get(messageId);
    if (!snapshot) {
      return;
    }
    const wanted = new Map(snapshot.map((el) => [el.id, el]));
    const current = excalidrawAPI.getSceneElementsIncludingDeleted();
    const seen = new Set<string>();
    const next = current.map((el) => {
      seen.add(el.id);
      const old = wanted.get(el.id);
      if (!old) {
        return el.isDeleted ? el : newElementWith(el, { isDeleted: true });
      }
      return newElementWith(
        el,
        { ...old, version: Math.max(el.version, old.version) + 1 } as any,
        true,
      );
    });
    for (const old of snapshot) {
      if (!seen.has(old.id)) {
        next.push(old);
      }
    }
    excalidrawAPI.updateScene({
      elements: next,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  };

  /** Antigravity on this computer: signing in and out happens in its terminal */
  const usesTerminal = status?.state === "ok" && status.signIn === "terminal";

  const signOut = async () => {
    if (usesTerminal) {
      if (
        !window.confirm(
          "Signing out also signs you out of the Antigravity CLI. A terminal will open: type /logout there. Continue?",
        )
      ) {
        return;
      }
      stop();
      try {
        await openAgentTerminal(agent.base, "logout");
        setSigningOut(true);
      } catch (e: any) {
        window.alert(e.message);
      }
      return;
    }
    stop();
    await disconnect(agent.base);
    resetChat();
    await refreshStatus();
  };

  const userMessages = messages.filter((m) => m.role === "user");
  // the checkpoint shown in the bar: the one picked from the circles, else the latest
  const shownUser =
    userMessages.find((m) => m.id === focusId) ??
    userMessages[userMessages.length - 1];
  const shownIndex = shownUser ? messages.indexOf(shownUser) : -1;
  const shownClaude =
    shownIndex >= 0 && messages[shownIndex + 1]?.role === "assistant"
      ? messages[shownIndex + 1]
      : undefined;
  const liveClaude = busy && shownClaude === messages[messages.length - 1];
  // every other chat, newest closest to the bar
  const otherChats = ownChats.filter((c) => c.id !== chatId).slice(0, 5);
  // one circle per prompt of this chat = a checkpoint
  const dots = userMessages.slice(-8);
  const canRestoreShown = !!shownUser && checkpoints.current.has(shownUser.id);

  const claudeLine = (() => {
    if (!shownClaude) {
      return null;
    }
    if (shownClaude.text) {
      return oneLine(shownClaude.text);
    }
    if (liveClaude) {
      const tool = shownClaude.tools[shownClaude.tools.length - 1];
      return tool ? `${TOOL_LABELS[tool] || tool}…` : "Thinking…";
    }
    return shownClaude.tools.length ? "Done" : "";
  })();

  const mark = (cls?: string) => (
    <span className={clsx("claude-avatar", cls)}>
      <agent.Logo size={16} />
    </span>
  );

  const fileChips = (files.length > 0 || fileError) && (
    <div className="claude-files">
      {files.map((file, i) => (
        <span key={`${file.name}-${i}`} className="claude-file-chip">
          {file.name} · {formatSize(file.size)}
          <button
            type="button"
            aria-label={`Remove ${file.name}`}
            onClick={() => setFiles(files.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </span>
      ))}
      {fileError && <span className="claude-file-error">{fileError}</span>}
    </div>
  );

  const attachButton = (
    <button
      type="button"
      className="claude-icon-btn"
      title="Attach a file (PDF, image or text, up to 5 MB)"
      aria-label="Attach a file"
      onClick={() => fileInput.current?.click()}
    >
      <Icon d={ICON.clip} />
    </button>
  );

  const sendButton = busy ? (
    <button
      type="button"
      className="claude-send stop"
      onClick={stop}
      title="Stop"
      aria-label="Stop"
    >
      <Icon d={ICON.stop} />
    </button>
  ) : (
    <button
      className="claude-send"
      disabled={!input.trim() && !files.length}
      title="Send"
      aria-label="Send"
    >
      <Icon d={ICON.send} />
    </button>
  );

  const modelPicker = (
    <ModelPicker
      agent={agent}
      models={models}
      selected={model}
      connected={!!ready}
      plan={ready ? plan : null}
      onSelect={(value) => {
        setModelPref(value);
        try {
          localStorage.setItem(agent.modelKey, value);
        } catch {}
        inputRef.current?.focus();
      }}
      onConnect={() => {
        setView("chat");
        onLayout({ open: true, mode: "panel" });
      }}
    />
  );

  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      if (e.dataTransfer.types.includes("Files")) {
        e.preventDefault();
        setDragging(true);
      }
    },
    onDragLeave: () => setDragging(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      addFiles([...e.dataTransfer.files]);
    },
    onPaste: (e: React.ClipboardEvent) => {
      const pasted = [...e.clipboardData.files];
      if (pasted.length) {
        e.preventDefault();
        addFiles(pasted);
      }
    },
  };

  return (
    <div
      className={clsx("claude-root", `agent-${agent.id}`, `theme-${theme}`)}
      hidden={!active}
      onKeyDown={keepKeysInChat}
    >
      <input
        ref={fileInput}
        type="file"
        hidden
        multiple
        accept={ACCEPT}
        onChange={(e) => {
          addFiles([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />

      {/* bottom chat: the current exchange, with earlier prompts stacked behind */}
      {open && mode === "bar" && (
        <div
          className={clsx("claude-bar", { dragging })}
          role="dialog"
          aria-label={name}
          // clicks on plain areas focus the chat, not the canvas
          tabIndex={-1}
          {...dropProps}
        >
          {ready && dots.length > 0 && (
            <div className="claude-dots" aria-label="Checkpoints">
              {dots.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={clsx("claude-dot-cp", {
                    active: m.id === shownUser?.id,
                    saved: checkpoints.current.has(m.id),
                  })}
                  title={oneLine(m.text)}
                  aria-label={`Checkpoint: ${oneLine(m.text)}`}
                  aria-pressed={m.id === shownUser?.id}
                  onClick={() => {
                    setFocusId(m.id);
                    setMenuOpen(false);
                  }}
                />
              ))}
            </div>
          )}
          {ready && otherChats.length > 0 && (
            <div className="claude-stack" aria-label="Other chats">
              {otherChats.map((c, i) => (
                <button
                  key={c.id}
                  type="button"
                  className="claude-cp"
                  style={{ "--depth": i } as React.CSSProperties}
                  title="Open this chat"
                  onClick={() => openChat(c)}
                >
                  <span className="claude-cp-icon">↺</span>
                  <span className="claude-cp-text">{oneLine(c.title)}</span>
                </button>
              ))}
            </div>
          )}
          {!ready && status?.state !== undefined && (
            <button
              type="button"
              className="claude-bar-lines claude-bar-setup"
              onClick={() => onLayout({ mode: "panel" })}
            >
              {status?.state === "offline"
                ? "The bridge isn't running — open the side panel for help"
                : `Connect ${name} to start — open the side panel`}
            </button>
          )}
          {ready && (shownUser || shownClaude) && (
            <div className="claude-bar-lines">
              {shownUser && (
                <div className="claude-bar-line user">
                  <span className="claude-bar-prompt">&gt;</span>
                  <span className="claude-bar-text">
                    {oneLine(shownUser.text)}
                  </span>
                  <div
                    className="claude-more"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="claude-icon-btn"
                      title="More"
                      aria-label="More"
                      aria-expanded={menuOpen}
                      onClick={() => setMenuOpen((o) => !o)}
                    >
                      ⋯
                    </button>
                    {menuOpen && (
                      <div className="claude-menu" role="menu">
                        <button
                          type="button"
                          role="menuitem"
                          disabled={!canRestoreShown || busy}
                          title={
                            canRestoreShown
                              ? undefined
                              : "The canvas can't be restored after a reload"
                          }
                          onClick={() => {
                            setMenuOpen(false);
                            shownUser && restoreCheckpoint(shownUser.id);
                          }}
                        >
                          ↺ Restore canvas to before this
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setMenuOpen(false);
                            newChat();
                          }}
                        >
                          + New chat
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="danger"
                          onClick={() => {
                            setMenuOpen(false);
                            deleteChat(chatId);
                          }}
                        >
                          Delete this chat
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {shownClaude && claudeLine !== "" && (
                <div
                  className={clsx("claude-bar-line", {
                    error: shownClaude.error,
                  })}
                >
                  {liveClaude && !shownClaude.text ? (
                    <Spinner />
                  ) : (
                    <span className="claude-dot">●</span>
                  )}
                  <span
                    className={clsx("claude-bar-text", {
                      "claude-shimmer": liveClaude && !shownClaude.text,
                    })}
                  >
                    {claudeLine}
                  </span>
                </div>
              )}
            </div>
          )}
          {fileChips}
          {modelPicker}
          <form
            className="claude-bar-input"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            {mark()}
            <input
              className="claude-field"
              value={input}
              placeholder={`Ask ${name} to draw or edit…`}
              aria-label={`Message ${name}`}
              onChange={(e) => setInput(e.target.value)}
            />
            {attachButton}
            <button
              type="button"
              className="claude-icon-btn"
              title="Switch to the side panel (chat, logs, history)"
              aria-label="Switch to the side panel"
              onClick={() => onLayout({ mode: "panel" })}
            >
              <Icon d={ICON.panel} />
            </button>
            <button
              type="button"
              className="claude-icon-btn"
              title="Close"
              aria-label={`Close ${name}`}
              onClick={() => onLayout({ open: false })}
            >
              <Icon d={ICON.close} />
            </button>
            {sendButton}
          </form>
        </div>
      )}

      {open && mode === "panel" && (
        // not an <aside>: the editor hides those on phones
        <div
          className={clsx("claude-panel", { wide, dragging })}
          // lets the editor keep fitted content clear of the docked panel
          data-viewport-ui="side"
          role="complementary"
          // clicks on plain areas focus the chat, not the canvas
          tabIndex={-1}
          aria-label={`${name} chat`}
          {...dropProps}
        >
          <header className="claude-header">
            <div className="claude-title">
              {mark("lg")}
              <div>
                <strong>{name}</strong>
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
                    ? status.email || `your ${name} account`
                    : "not connected"}
                </small>
              </div>
            </div>
            <div className="claude-actions">
              <button
                title="New chat"
                aria-label="New chat"
                onClick={newChat}
                disabled={!messages.length && !busy}
              >
                <Icon d={ICON.plus} />
              </button>
              <button
                className="claude-wide-toggle"
                title={wide ? "Narrower" : "Wider"}
                aria-label={wide ? "Narrower" : "Wider"}
                onClick={() => onLayout({ wide: !wide })}
              >
                <Icon d={wide ? ICON.narrower : ICON.wider} />
              </button>
              <button
                title="Switch to the bottom chat"
                aria-label="Switch to the bottom chat"
                onClick={() => onLayout({ mode: "bar" })}
              >
                <Icon d={ICON.bar} />
              </button>
              {ready && (
                <button
                  title={`Disconnect ${name} account`}
                  aria-label={`Disconnect ${name} account`}
                  onClick={signOut}
                >
                  <Icon d={ICON.signOut} />
                </button>
              )}
              <button
                title="Close"
                aria-label={`Close ${name}`}
                onClick={() => onLayout({ open: false })}
              >
                <Icon d={ICON.close} />
              </button>
            </div>
          </header>

          <nav className="claude-tabs" role="tablist">
            {(["chat", "logs", "history"] as const).map((tab) => (
              <button
                key={tab}
                role="tab"
                aria-selected={view === tab}
                className={clsx({ active: view === tab })}
                onClick={() => setView(tab)}
              >
                {tab === "chat" ? "Chat" : tab === "logs" ? "Logs" : "History"}
                {tab === "logs" && logs.length > 0 && (
                  <span className="claude-tab-count">{logs.length}</span>
                )}
              </button>
            ))}
          </nav>

          <div className="claude-messages" ref={scrollRef} onScroll={onScroll}>
            {view === "history" ? (
              <HistoryView
                chats={ownChats}
                activeId={chatId}
                onOpen={openChat}
                onDelete={deleteChat}
                onNew={newChat}
                onClear={clearChats}
              />
            ) : view === "logs" ? (
              <LogsView logs={logs} />
            ) : (
              <>
                {status?.state === "offline" && (
                  <div className="claude-banner">
                    <strong>The bridge isn't running</strong>
                    <p>
                      Self-hosted? Make sure the <code>claude-bridge</code>{" "}
                      service is up. Running locally? Start (or, after an
                      update, restart) it in a terminal:
                    </p>
                    <code>cd claude-bridge && yarn install && yarn start</code>
                  </div>
                )}
                {status?.state === "signin_required" && (
                  <div className="claude-connect">
                    <agent.Logo size={36} />
                    <h3>Sign in to use {name}</h3>
                    <p>
                      Sign in to your account first, then connect your {name}{" "}
                      plan.
                    </p>
                    <button
                      className="claude-primary"
                      onClick={() => goToSignIn("signin")}
                    >
                      Sign in
                    </button>
                  </div>
                )}
                {status?.state === "ok" &&
                  !status.loggedIn &&
                  (usesTerminal ? (
                    <AntigravityConnectCard
                      agent={agent}
                      installed={status.installed !== false}
                      onCheck={checkStatus}
                    />
                  ) : agent.id === "codex" ? (
                    <CodexConnectCard
                      agent={agent}
                      installed={status.installed !== false}
                      onCheck={checkStatus}
                    />
                  ) : (
                    <ConnectCard
                      agent={agent}
                      onConnected={() => refreshStatus()}
                    />
                  ))}
                {ready && !messages.length && (
                  <div className="claude-empty">
                    <agent.Logo size={36} />
                    <h3>What shall we draw?</h3>
                    <p>
                      Describe it, or attach a document, and I'll build it on
                      the canvas.
                    </p>
                    <div className="claude-suggestions">
                      {SUGGESTIONS.map((s) => (
                        <button
                          key={s.title}
                          type="button"
                          title={s.prompt}
                          onClick={() => send(s.prompt)}
                          disabled={busy}
                        >
                          <Icon d={s.icon} />
                          <strong>{s.title}</strong>
                          <small>{s.hint}</small>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {messages.map((m, i) => {
                  const isLast = i === messages.length - 1;
                  const live = busy && isLast && m.role === "assistant";
                  if (m.role === "user") {
                    const canRestore = checkpoints.current.has(m.id);
                    return (
                      <div key={m.id} className="claude-msg user">
                        <div className="claude-user-text">
                          {m.text}
                          {m.files?.map((f, j) => (
                            <span key={j} className="claude-file-chip">
                              {f.name}
                            </span>
                          ))}
                        </div>
                        {canRestore && (
                          <button
                            type="button"
                            className="claude-restore"
                            disabled={busy}
                            title="Restore the canvas to how it was before this prompt"
                            onClick={() => restoreCheckpoint(m.id)}
                          >
                            <Icon d={ICON.rewind} />
                            Restore checkpoint
                          </button>
                        )}
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
                      {m.tools.length > 0 && (
                        <Activity message={m} live={live} />
                      )}
                      {m.text &&
                        (m.error ? (
                          <div className="claude-reply-text" role="alert">
                            {m.text}
                          </div>
                        ) : (
                          <Markdown
                            className="claude-reply-text"
                            text={m.text}
                          />
                        ))}
                      {live && !m.text && !m.tools.length && !thinkingLive && (
                        <div className="claude-working">
                          <Spinner />
                          <span className="claude-shimmer">Thinking…</span>
                        </div>
                      )}
                      {!live && m.text && !m.error && (
                        <div className="claude-msg-actions">
                          <CopyButton text={m.text} />
                          {m.tools.length > 0 && (
                            <button
                              type="button"
                              title="Show the drawing"
                              aria-label="Show the drawing"
                              onClick={fitDrawing}
                            >
                              <Icon d={ICON.fit} />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>

          <footer className="claude-dock">
            {!atBottom && view !== "history" && (
              <button
                type="button"
                className="claude-latest"
                onClick={scrollToLatest}
              >
                <Icon d={ICON.down} />
                Latest
              </button>
            )}
            {ready &&
              view === "chat" &&
              !busy &&
              !input &&
              !!messages[messages.length - 1]?.tools.length && (
                <div className="claude-followups">
                  {FOLLOW_UPS.map((f) => (
                    <button key={f} type="button" onClick={() => send(f)}>
                      {f}
                    </button>
                  ))}
                </div>
              )}
            {fileChips}
            {modelPicker}
            <form
              className="claude-composer"
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
            >
              {attachButton}
              <textarea
                ref={inputRef}
                className="claude-field"
                value={input}
                rows={1}
                // never disabled: keys typed at a dead field would hit the canvas
                aria-label={`Message ${name}`}
                placeholder={
                  ready
                    ? `Ask ${name} to draw or edit…`
                    : `Connect ${name} to start…`
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
              {sendButton}
            </form>
          </footer>
        </div>
      )}
    </div>
  );
};
