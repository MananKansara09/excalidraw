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
  onError: (message: string) => void;
  onDone: () => void;
};

const BASE = "/claude-bridge";

export const checkBridge = async (): Promise<boolean> => {
  try {
    const res = await fetch(`${BASE}/health`, { cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
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
    handlers.onError(
      "Can't reach the Claude bridge. Start it with `cd claude-bridge && yarn install && yarn start`.",
    );
    return;
  }
  if (!res.ok || !res.body) {
    handlers.onError(
      res.status === 404 || res.status >= 502
        ? "Can't reach the Claude bridge. Start it with `cd claude-bridge && yarn install && yarn start`."
        : `Bridge error (${res.status}).`,
    );
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
        return handlers.onError(data.message);
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
