// Saved chats and the log of what Claude did, kept in this browser.

export type ChatFile = { name: string; size: number };

export type Message = {
  id: number;
  role: "user" | "assistant";
  text: string;
  thinking: string;
  /** ms spent thinking, set once the first answer/tool output arrives */
  thinkingMs?: number;
  thinkingStart?: number;
  tools: string[];
  files?: ChatFile[];
  error?: boolean;
};

export type LogBody =
  | { kind: "user"; text: string; files: ChatFile[] }
  | { kind: "session"; sessionId: string; model?: string }
  | { kind: "thinking"; text: string }
  | { kind: "text"; text: string }
  | {
      kind: "tool";
      name: string;
      toolId?: string;
      input?: unknown;
      output?: string;
      status: "running" | "done" | "error";
    }
  | { kind: "canvas"; text: string }
  | { kind: "error"; text: string }
  | { kind: "done"; text: string };

export type LogEvent = { id: number; at: number } & LogBody;

export type Chat = {
  id: string;
  /** the Claude account the chat belongs to, so shared browsers stay separate */
  owner: string;
  title: string;
  sessionId?: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
  logs: LogEvent[];
};

const KEY = "excalidraw-claude-history";
const MAX_CHATS = 40;
const MAX_DETAIL = 4000;

export const loadChats = (): Chat[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const shrink = (chat: Chat): Chat => ({
  ...chat,
  logs: chat.logs.map((event) => {
    if (event.kind !== "tool") {
      return event;
    }
    const input = JSON.stringify(event.input ?? null);
    return {
      ...event,
      // a run cut short by a reload never finished
      status: event.status === "running" ? "error" : event.status,
      input:
        input.length > MAX_DETAIL
          ? `${input.slice(0, MAX_DETAIL)}… (truncated)`
          : event.input,
      output: event.output?.slice(0, MAX_DETAIL),
    };
  }),
});

export const saveChats = (chats: Chat[]) => {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify(
        [...chats]
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, MAX_CHATS)
          .map(shrink),
      ),
    );
  } catch {
    // storage full or unavailable: chats just won't survive a reload
  }
};

export const newChatId = () => Math.random().toString(36).slice(2, 12);
