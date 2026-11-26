export type BridgeOp =
  | { op: "add"; elements: Record<string, any>[] }
  | { op: "update"; updates: Record<string, any>[] }
  | { op: "delete"; ids: string[] }
  | { op: "clear" };

export type SceneSummary = {
  elements: Record<string, any>[];
  selectedIds: string[];
};

type Handlers = {
  onSession: (sessionId: string) => void;
  onText: (delta: string) => void;
  onTool: (name: string) => void;
  onOps: (op: BridgeOp) => void;
  onError: (message: string, code?: string) => void;
  onDone: () => void;
};

const BASE = "/claude-bridge";

export type BridgeStatus =
  | { state: "ok"; loggedIn: boolean; email: string | null }
  | { state: "signin_required" }
  | { state: "offline" };

const OFFLINE_MESSAGE =
  "Can't reach the Claude bridge. Start it with `cd claude-bridge && yarn install && yarn start`.";

const post = async (path: string, body?: unknown) => {
  const res = await fetch(`${BASE}${path}`, {
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

export const getStatus = async (): Promise<BridgeStatus> => {
  try {
    const res = await fetch(`${BASE}/status`, { cache: "no-store" });
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
    };
  } catch {
    return { state: "offline" };
  }
};

/** starts `claude auth login`: returns the page the user must authorize on */
export const startLogin = async (): Promise<string> => {
  const { ok, json } = await post("/auth/login");
  if (!ok || !json?.url) {
    throw new Error(json?.error || "Couldn't start the Claude sign-in.");
  }
  return json.url;
};

/** completes the login with the code shown after authorizing */
export const submitLoginCode = async (code: string) => {
  const { ok, json } = await post("/auth/code", { code });
  if (!ok) {
    throw new Error(json?.error || "That code didn't work.");
  }
};

export const disconnect = async () => {
  await post("/auth/logout");
};

/** POSTs a chat turn and dispatches the server-sent events as they arrive */
export const streamChat = async (
  body: { message: string; sessionId?: string; scene: SceneSummary },
  handlers: Handlers,
  signal: AbortSignal,
) => {
  let res: Response;
  try {
    res = await fetch(`${BASE}/chat`, {
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
        return handlers.onSession(data.sessionId);
      case "text":
        return handlers.onText(data.delta);
      case "tool":
        return handlers.onTool(data.name);
      case "ops":
        return handlers.onOps(data);
      case "error":
        return handlers.onError(data.message, data.code);
      case "done":
        return handlers.onDone();
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
      handlers.onError("The connection to the Claude bridge was interrupted.");
    }
  }
};
