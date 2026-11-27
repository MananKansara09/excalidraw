import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { newElementWith } from "@excalidraw/element";
import clsx from "clsx";
import { useCallback, useEffect, useRef, useState } from "react";

import type { OrderedExcalidrawElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { goToSignIn } from "../../plus/auth";

import { ClaudeLogo } from "./ClaudeLogo";
import { HistoryView, LogsView, formatSize } from "./ClaudeViews";
import { Markdown } from "./Markdown";
import {
  disconnect,
  getStatus,
  startLogin,
  streamChat,
  submitLoginCode,
} from "./claudeBridge";
import { loadChats, newChatId, saveChats } from "./history";
import { applyOp, summarizeScene } from "./sceneOps";

import "./ClaudePanel.scss";

import type { BridgeStatus } from "./claudeBridge";
import type { Chat, LogBody, LogEvent, Message, ToolCall } from "./history";

type Mode = "bar" | "panel";
type View = "chat" | "logs" | "history";

const PREFS_KEY = "excalidraw-claude-panel";
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 5;
const ACCEPT =
  ".pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.md,.markdown,.csv,.tsv,.json,.xml,.yaml,.yml,.html,.css,.js,.ts,.tsx,.py,.sql,.mmd,.log";

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

const loadPrefs = (): { open: boolean; wide: boolean; mode: Mode } => {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    return {
      open: !!raw.open,
      wide: !!raw.wide,
      mode: raw.mode === "panel" ? "panel" : "bar",
    };
  } catch {
    return { open: false, wide: false, mode: "bar" };
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

const ICON = {
  clip: "m21 11-9.2 9.2a5 5 0 0 1-7-7l9.2-9.2a3.5 3.5 0 0 1 5 5L9.8 18.2a2 2 0 0 1-3-3L15 7",
  panel: "M3 4h18v16H3zM15 4v16",
  bar: "M3 4h18v16H3zM3 15h18",
  close: "M6 6l12 12M18 6L6 18",
  plus: "M12 5v14M5 12h14",
  send: "M12 19V5M5 12l7-7 7 7",
  stop: "M7 7h10v10H7z",
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

/** the Claude starburst */
const ClaudeMark = ({ size = 18 }: { size?: number }) => (
  <ClaudeLogo size={size} />
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

/** one step of Claude's work: "Drawing · 12 elements", with its outcome */
const ToolCard = ({
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
  const detail =
    call?.count !== undefined
      ? `${call.count} element${call.count === 1 ? "" : "s"}`
      : null;
  return (
    <div className={clsx("claude-step", status)}>
      {running ? (
        <Spinner />
      ) : (
        <span className="claude-step-icon" aria-hidden>
          {status === "error" ? "✕" : "✓"}
        </span>
      )}
      <span
        className={clsx("claude-step-label", { "claude-shimmer": running })}
      >
        {running ? `${label}…` : label}
      </span>
      {detail && <span className="claude-step-chip">{detail}</span>}
      {call?.durationMs !== undefined && !running && (
        <span className="claude-step-time">
          {(call.durationMs / 1000).toFixed(1)}s
        </span>
      )}
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
        <Markdown
          className="claude-thinking-body"
          text={message.thinking.trim()}
        />
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
  const { open, wide, mode } = prefs;
  const [view, setView] = useState<View>("chat");
  const [messages, setMessages] = useState<Message[]>([]);
  const [logs, setLogs] = useState<LogEvent[]>([]);
  const [chats, setChats] = useState<Chat[]>(loadChats);
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
    ready && status.state === "ok" ? status.email || "claude" : null;
  const sessionId = useRef<string | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  /** the canvas as it was before each prompt, so any prompt can be rewound */
  const checkpoints = useRef(new Map<number, OrderedExcalidrawElement[]>());
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const updatePrefs = useCallback((patch: Partial<typeof prefs>) => {
    setPrefs((p) => {
      const next = { ...p, ...patch };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  // the corner icon is always on screen, so always know the connection state
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
  }, [messages, logs, view, open]);

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

  // after the side panel opens/closes/resizes, bring the drawing back in view
  const panelShown = open && mode === "panel";
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
  }, [panelShown, wide, excalidrawAPI]);

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
        saveChats(next);
        return next;
      });
    }, 400);
    return () => window.clearTimeout(id);
  }, [messages, logs, owner, chatId]);

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
      updatePrefs({ open: true, mode: "panel" });
      return;
    }
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
        {
          message,
          sessionId: sessionId.current,
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
      saveChats(next);
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
      saveChats(next);
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

  const signOutOfClaude = async () => {
    stop();
    await disconnect();
    resetChat();
    setStatus(await getStatus());
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
      <ClaudeMark size={16} />
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
    <div className={clsx("claude-root", `theme-${theme}`)}>
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

      {/* when closed, the corner icon is all that's left on screen */}
      {!open && (
        <button
          className={clsx("claude-fab", { busy })}
          onClick={() => updatePrefs({ open: true })}
          title="Open Claude"
          aria-label="Open Claude"
        >
          <ClaudeMark size={22} />
        </button>
      )}

      {/* bottom chat: the current exchange, with earlier prompts stacked behind */}
      {open && mode === "bar" && (
        <div
          className={clsx("claude-bar", { dragging })}
          role="dialog"
          aria-label="Claude"
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
              onClick={() => updatePrefs({ mode: "panel" })}
            >
              {status?.state === "offline"
                ? "Claude bridge isn't running — open the side panel for help"
                : "Connect Claude to start — open the side panel"}
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
            {attachButton}
            <button
              type="button"
              className="claude-icon-btn"
              title="Switch to the side panel (chat, logs, history)"
              aria-label="Switch to the side panel"
              onClick={() => updatePrefs({ mode: "panel" })}
            >
              <Icon d={ICON.panel} />
            </button>
            <button
              type="button"
              className="claude-icon-btn"
              title="Close"
              aria-label="Close Claude"
              onClick={() => updatePrefs({ open: false })}
            >
              <Icon d={ICON.close} />
            </button>
            {sendButton}
          </form>
        </div>
      )}

      {open && mode === "panel" && (
        <aside
          className={clsx("claude-panel", { wide, dragging })}
          // lets the editor keep fitted content clear of the docked panel
          data-viewport-ui="side"
          aria-label="Claude chat"
          {...dropProps}
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
                aria-label="New chat"
                onClick={newChat}
                disabled={!messages.length && !busy}
              >
                <Icon d={ICON.plus} />
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
              <button
                title="Switch to the bottom chat"
                aria-label="Switch to the bottom chat"
                onClick={() => updatePrefs({ mode: "bar" })}
              >
                <Icon d={ICON.bar} />
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
                aria-label="Close Claude"
                onClick={() => updatePrefs({ open: false })}
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

          <div className="claude-messages" ref={scrollRef}>
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
                    <strong>Claude bridge isn't running</strong>
                    <p>
                      Self-hosted? Make sure the <code>claude-bridge</code>{" "}
                      service is up. Running locally? In a terminal:
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
                      Sign in to your account first, then connect your Claude
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
                      Describe a diagram or scene, or attach a document, and
                      I'll build it on the canvas.
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
                            ↺ Restore checkpoint
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
                      {m.tools.map((t, j) => {
                        const toolLive =
                          live && j === m.tools.length - 1 && !m.text;
                        return (
                          <ToolCard
                            key={j}
                            name={t}
                            call={m.toolCalls?.[j]}
                            live={toolLive}
                          />
                        );
                      })}
                      {m.text && (
                        <div className="claude-reply">
                          <span className="claude-dot">●</span>
                          {m.error ? (
                            <div className="claude-reply-text">{m.text}</div>
                          ) : (
                            <Markdown
                              className="claude-reply-text"
                              text={m.text}
                            />
                          )}
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
              </>
            )}
          </div>

          {fileChips}
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
            {sendButton}
          </form>
        </aside>
      )}
    </div>
  );
};
