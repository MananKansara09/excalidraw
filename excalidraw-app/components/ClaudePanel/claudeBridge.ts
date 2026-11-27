export type BridgeOp =
  | { op: "add"; elements: Record<string, any>[] }
  | { op: "update"; updates: Record<string, any>[] }
  | { op: "delete"; ids: string[] }
  | { op: "clear" };

export type SceneSummary = {
  elements: Record<string, any>[];
  selectedIds: string[];
};

export type AttachmentPayload = {
  name: string;
  mediaType: string;
  /** base64, without the data-URL prefix */
  data: string;
};

export type DoneStats = {
  durationMs?: number;
  turns?: number;
  costUsd?: number;
};

type Handlers = {
  onSession: (sessionId: string, model?: string) => void;
  onText: (delta: string) => void;
  onThinking?: (delta: string) => void;
  onTool: (name: string) => void;
  onToolUse?: (call: { id: string; name: string; input: unknown }) => void;
  onToolResult?: (result: {
    id: string;
    output: string;
    isError: boolean;
  }) => void;
  onOps: (op: BridgeOp) => void;
  onError: (message: string, code?: string) => void;
  onDone: (stats?: DoneStats) => void;
};

export type BridgeStatus =
  | {
      state: "ok";
      loggedIn: boolean;
      email: string | null;
      /** subscription tier, e.g. "pro" or "max" */
      plan?: string | null;
      /** false when the agent's CLI is missing on the bridge's machine */
      installed?: boolean;
      /** the signed-in app user, on a shared bridge */
      user?: string;
      /** Antigravity: "code" to paste one here, "terminal" to sign in there */
      signIn?: "code" | "terminal";
    }
  | { state: "signin_required" }
  | { state: "offline" };

const OFFLINE_MESSAGE =
  "Can't reach the bridge. Start (or restart) it with `cd claude-bridge && yarn install && yarn start`.";

const post = async (url: string, body?: unknown) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {}
  return { ok: res.ok, status: res.status, json };
};

/** `base` is the agent's address; `fresh` skips the bridge's cached answer */
export const getStatus = async (
  base: string,
  fresh = false,
): Promise<BridgeStatus> => {
  try {
    const res = await fetch(`${base}/status${fresh ? "?fresh=1" : ""}`, {
      cache: "no-store",
    });
    if (res.status === 401) {
      return { state: "signin_required" };
    }
    if (!res.ok) {
      return { state: "offline" };
    }
    const json = await res.json();
    return {
      state: "ok",
      loggedIn: !!json.loggedIn,
      email: json.email ?? null,
      plan: json.plan ?? null,
      installed: json.installed,
      user: json.user,
      signIn: json.signIn,
    };
  } catch {
    return { state: "offline" };
  }
};

export type ModelChoice = {
  value: string;
  name: string;
  description: string;
};

/** the models the connected account can use; empty when they can't be read */
export const getModels = async (base: string): Promise<ModelChoice[]> => {
  try {
    const res = await fetch(`${base}/models`, { cache: "no-store" });
    const json = res.ok ? await res.json() : null;
    return Array.isArray(json?.models) ? json.models : [];
  } catch {
    return [];
  }
};

/**
 * Starts a browser sign-in: returns the page the user must authorize on and,
 * for some agents, a one-time code to enter there.
 */
export const startLogin = async (
  base: string,
): Promise<{ url: string; userCode?: string }> => {
  const { ok, json } = await post(`${base}/auth/login`);
  if (!ok || !json?.url) {
    throw new Error(json?.error || "Couldn't start the sign-in.");
  }
  return { url: json.url, userCode: json.userCode };
};

/** completes the login with the code shown after authorizing */
export const submitLoginCode = async (base: string, code: string) => {
  const { ok, json } = await post(`${base}/auth/code`, { code });
  if (!ok) {
    throw new Error(json?.error || "That code didn't work.");
  }
};

/** on your own computer Antigravity signs in and out in its CLI's terminal */
export const openAgentTerminal = async (
  base: string,
  action: "login" | "logout",
) => {
  const { ok, json } = await post(`${base}/auth/${action}`);
  if (!ok) {
    throw new Error(json?.error || "Couldn't open a terminal.");
  }
};

export const disconnect = async (base: string) => {
  await post(`${base}/auth/logout`);
};

/** POSTs a chat turn and dispatches the server-sent events as they arrive */
export const streamChat = async (
  base: string,
  body: {
    message: string;
    sessionId?: string;
    model?: string;
    scene: SceneSummary;
    attachments?: AttachmentPayload[];
  },
  handlers: Handlers,
  signal: AbortSignal,
) => {
  let res: Response;
  try {
    res = await fetch(`${base}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e: any) {
    if (e?.name === "AbortError") {
      return;
    }
    handlers.onError(OFFLINE_MESSAGE, "offline");
    return;
  }
  if (!res.ok || !res.body) {
    if (res.status === 401) {
      handlers.onError(
        "Please sign in again to keep chatting.",
        "signin_required",
      );
    } else if (res.status === 404 || res.status >= 502) {
      handlers.onError(OFFLINE_MESSAGE, "offline");
    } else {
      let message = `Bridge error (${res.status}).`;
      try {
        message = (await res.json()).error || message;
      } catch {}
      handlers.onError(message);
    }
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const dispatch = (event: string, raw: string) => {
    let data: any;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    switch (event) {
      case "session":
        return handlers.onSession(data.sessionId, data.model);
      case "text":
        return handlers.onText(data.delta);
      case "thinking":
        return handlers.onThinking?.(data.delta);
      case "tool":
        return handlers.onTool(data.name);
      case "tool_use":
        return handlers.onToolUse?.(data);
      case "tool_result":
        return handlers.onToolResult?.(data);
      case "ops":
        return handlers.onOps(data);
      case "error":
        return handlers.onError(data.message, data.code);
      case "done":
        return handlers.onDone(data);
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        let event = "message";
        let data = "";
        for (const line of chunk.split("\n")) {
          if (line.startsWith("event: ")) {
            event = line.slice(7);
          } else if (line.startsWith("data: ")) {
            data += line.slice(6);
          }
        }
        dispatch(event, data);
      }
    }
  } catch (e: any) {
    if (e?.name !== "AbortError") {
      handlers.onError("The connection to the bridge was interrupted.");
    }
  }
};
