import clsx from "clsx";

import type { Chat, LogEvent } from "./history";

export const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const clock = (at: number) =>
  new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

const pretty = (value: unknown) => {
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
};

const toolSummary = (name: string, input: any) => {
  const count =
    input?.elements?.length ?? input?.updates?.length ?? input?.ids?.length;
  return count !== undefined ? `${name}(${count})` : `${name}()`;
};

/** Everything that happened in the chat, laid out like Claude Code's transcript. */
export const LogsView = ({ logs }: { logs: LogEvent[] }) => {
  if (!logs.length) {
    return (
      <div className="claude-log-empty">
        Nothing logged yet. Tool calls, results and thinking appear here as the
        assistant works.
      </div>
    );
  }
  return (
    <div className="claude-logs">
      {logs.map((event) => {
        const time = <time>{clock(event.at)}</time>;
        switch (event.kind) {
          case "user":
            return (
              <div key={event.id} className="claude-log user">
                {time}
                <span className="claude-log-mark">&gt;</span>
                <div className="claude-log-body">
                  {event.text}
                  {event.files.map((file, i) => (
                    <span key={i} className="claude-file-chip">
                      {file.name}
                    </span>
                  ))}
                </div>
              </div>
            );
          case "session":
            return (
              <div key={event.id} className="claude-log meta">
                {time}
                <span className="claude-log-mark">✻</span>
                <div className="claude-log-body">
                  session {event.sessionId.slice(0, 8)}
                  {event.model ? ` · ${event.model}` : ""}
                </div>
              </div>
            );
          case "thinking":
            return (
              <details key={event.id} className="claude-log thinking">
                <summary>
                  {time}
                  <span className="claude-log-mark">✻</span>
                  <span className="claude-log-body">Thinking</span>
                </summary>
                <pre>{event.text.trim()}</pre>
              </details>
            );
          case "text":
            return (
              <div key={event.id} className="claude-log">
                {time}
                <span className="claude-log-mark">●</span>
                <div className="claude-log-body">{event.text}</div>
              </div>
            );
          case "tool":
            return (
              <details
                key={event.id}
                className={clsx("claude-log tool", event.status)}
                open={event.status === "running"}
              >
                <summary>
                  {time}
                  <span className="claude-log-mark">●</span>
                  <span className="claude-log-body">
                    <b>{toolSummary(event.name, event.input)}</b>
                    {event.output !== undefined && (
                      <span className="claude-log-result">
                        <span className="claude-log-elbow">⎿</span>{" "}
                        {event.output.split("\n")[0]}
                      </span>
                    )}
                    {event.status === "running" && (
                      <span className="claude-log-result">running…</span>
                    )}
                  </span>
                </summary>
                {event.input !== undefined && <pre>{pretty(event.input)}</pre>}
                {event.output !== undefined && event.output.includes("\n") && (
                  <pre>{event.output}</pre>
                )}
              </details>
            );
          case "canvas":
            return (
              <div key={event.id} className="claude-log meta">
                {time}
                <span className="claude-log-mark">◆</span>
                <div className="claude-log-body">{event.text}</div>
              </div>
            );
          case "error":
            return (
              <div key={event.id} className="claude-log error">
                {time}
                <span className="claude-log-mark">✕</span>
                <div className="claude-log-body">{event.text}</div>
              </div>
            );
          case "done":
            return (
              <div key={event.id} className="claude-log meta">
                {time}
                <span className="claude-log-mark">✻</span>
                <div className="claude-log-body">{event.text}</div>
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
};

export const HistoryView = ({
  chats,
  activeId,
  onOpen,
  onDelete,
  onNew,
  onClear,
}: {
  chats: Chat[];
  activeId: string;
  onOpen: (chat: Chat) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  onClear: () => void;
}) => (
  <div className="claude-history">
    <button type="button" className="claude-history-new" onClick={onNew}>
      + New chat
    </button>
    {!chats.length && (
      <div className="claude-log-empty">Past chats will show up here.</div>
    )}
    {chats.map((chat) => (
      <div
        key={chat.id}
        className={clsx("claude-history-item", {
          active: chat.id === activeId,
        })}
      >
        <button type="button" onClick={() => onOpen(chat)}>
          <span className="claude-history-title">{chat.title}</span>
          <span className="claude-history-meta">
            {new Date(chat.updatedAt).toLocaleString([], {
              dateStyle: "medium",
              timeStyle: "short",
            })}{" "}
            · {chat.messages.filter((m) => m.role === "user").length} prompts
          </span>
        </button>
        <button
          type="button"
          className="claude-history-delete"
          title="Delete chat"
          aria-label="Delete chat"
          onClick={() => onDelete(chat.id)}
        >
          ×
        </button>
      </div>
    ))}
    {chats.length > 1 && (
      <button type="button" className="claude-history-clear" onClick={onClear}>
        Delete all chats
      </button>
    )}
  </div>
);
