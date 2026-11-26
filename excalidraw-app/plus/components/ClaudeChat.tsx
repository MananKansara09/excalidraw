import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
} from "@excalidraw/excalidraw";
import { useEffect, useRef, useState } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { PLUS_API_BASE } from "../api";

type Message = { role: "user" | "assistant"; content: string };

const MERMAID_BLOCK = /```mermaid\s*\n([\s\S]*?)(?:```|$)/;

/** Splits a reply into text and its (single) Mermaid diagram, if any. */
const splitReply = (content: string) => {
  const match = MERMAID_BLOCK.exec(content);
  if (!match) {
    return { text: content.trim(), mermaid: null };
  }
  return {
    text: content.replace(MERMAID_BLOCK, "").trim(),
    mermaid: match[1].trim(),
  };
};

/** Streams a chat reply from the Plus server (SSE), calling `onDelta` per chunk. */
const streamChat = async (
  messages: Message[],
  onDelta: (delta: string) => void,
  signal: AbortSignal,
) => {
  const response = await fetch(`${PLUS_API_BASE}/ai/chat/streaming`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ messages }),
    signal,
  });
  if (!response.ok || !response.body) {
    let message = "Claude couldn't answer right now.";
    try {
      message = (await response.json()).error || message;
    } catch {}
    throw new Error(message);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data: ") || line === "data: [DONE]") {
        continue;
      }
      const chunk = JSON.parse(line.slice(6));
      if (chunk.type === "content") {
        onDelta(chunk.delta);
      } else if (chunk.type === "error") {
        throw new Error(chunk.error?.message || "Generation failed");
      }
    }
  }
};

const insertDiagram = async (api: ExcalidrawImperativeAPI, mermaid: string) => {
  const { parseMermaidToExcalidraw } = await import(
    "@excalidraw/mermaid-to-excalidraw"
  );
  const { elements, files } = await parseMermaidToExcalidraw(mermaid);
  const converted = convertToExcalidrawElements(elements, {
    regenerateIds: true,
  });
  if (!converted.length) {
    return;
  }
  // center the diagram in the current viewport
  const state = api.getAppState();
  const minX = Math.min(...converted.map((el) => el.x));
  const minY = Math.min(...converted.map((el) => el.y));
  const maxX = Math.max(...converted.map((el) => el.x + el.width));
  const maxY = Math.max(...converted.map((el) => el.y + el.height));
  const dx =
    -state.scrollX + state.width / state.zoom.value / 2 - (minX + maxX) / 2;
  const dy =
    -state.scrollY + state.height / state.zoom.value / 2 - (minY + maxY) / 2;
  const placed = converted.map((el) => ({
    ...el,
    x: el.x + dx,
    y: el.y + dy,
  }));
  if (files) {
    api.addFiles(Object.values(files) as any);
  }
  api.updateScene({
    elements: [...api.getSceneElements(), ...placed],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  api.setActiveTool({ type: "selection" });
};

const SparkIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path
      fill="currentColor"
      d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9L12 2zm7 11l.9 2.6 2.6.9-2.6.9L19 20l-.9-2.6-2.6-.9 2.6-.9L19 13z"
    />
  </svg>
);

const Reply = ({
  message,
  api,
}: {
  message: Message;
  api: ExcalidrawImperativeAPI;
}) => {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">(
    "idle",
  );
  if (message.role === "user") {
    return <div className="claude-chat__msg is-user">{message.content}</div>;
  }
  const { text, mermaid } = splitReply(message.content);
  return (
    <div className="claude-chat__msg">
      {text && <div className="claude-chat__text">{text}</div>}
      {mermaid && (
        <>
          <pre className="claude-chat__code">{mermaid}</pre>
          <button
            type="button"
            className="claude-chat__insert"
            disabled={state === "busy"}
            onClick={async () => {
              setState("busy");
              try {
                await insertDiagram(api, mermaid);
                setState("done");
              } catch {
                setState("error");
              }
            }}
          >
            {state === "busy"
              ? "Inserting…"
              : state === "done"
              ? "Inserted ✓"
              : state === "error"
              ? "Couldn't draw this — retry"
              : "Insert on canvas"}
          </button>
        </>
      )}
    </div>
  );
};

/**
 * Floating Claude assistant. A gradient button opens a slim prompt bar at the
 * bottom of the canvas; replies pop up above it, with an "Insert on canvas"
 * action for diagrams.
 */
export const ClaudeChat = ({ api }: { api: ExcalidrawImperativeAPI }) => {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const send = async () => {
    const content = input.trim();
    if (!content || busy) {
      return;
    }
    const history: Message[] = [...messages, { role: "user", content }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setError(null);
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamChat(
        history,
        (delta) =>
          setMessages((current) => {
            const next = current.slice();
            const last = next[next.length - 1];
            next[next.length - 1] = {
              ...last,
              content: last.content + delta,
            };
            return next;
          }),
        controller.signal,
      );
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        setError(err?.message || "Claude couldn't answer right now.");
      }
      // drop an empty placeholder reply
      setMessages((current) =>
        current[current.length - 1]?.content === ""
          ? current.slice(0, -1)
          : current,
      );
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    abortRef.current?.abort();
    setOpen(false);
  };

  return (
    <div className="claude-chat">
      {open && (
        <div className="claude-chat__stack" role="dialog" aria-label="Claude">
          {(messages.length > 0 || error) && (
            <div className="claude-chat__log" ref={logRef}>
              {messages.map((message, index) => (
                <Reply key={index} message={message} api={api} />
              ))}
              {busy && messages[messages.length - 1]?.content === "" && (
                <div className="claude-chat__typing">Thinking…</div>
              )}
              {error && <div className="claude-chat__error">{error}</div>}
            </div>
          )}
          <form
            className="claude-chat__bar"
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
          >
            <span className="claude-chat__bar-icon">
              <SparkIcon />
            </span>
            <input
              ref={inputRef}
              value={input}
              placeholder="Ask Claude or describe a diagram…"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                // keep editor shortcuts from firing while typing
                event.stopPropagation();
                if (event.key === "Escape") {
                  close();
                }
              }}
              aria-label="Message Claude"
            />
            <button
              type="submit"
              className="claude-chat__send"
              disabled={busy || !input.trim()}
              aria-label="Send"
            >
              ↑
            </button>
          </form>
        </div>
      )}
      <button
        type="button"
        className="claude-chat__fab"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
      >
        <SparkIcon />
        <span>Claude</span>
      </button>
    </div>
  );
};
