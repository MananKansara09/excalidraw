/**
 * Pure helpers for the Antigravity side of the bridge (no processes, no
 * network, so they're unit-testable): reading `agy` output and answering the
 * canvas MCP server's requests.
 */
import { isAllowedCall } from "./antigravity-guard.mjs";
import { CANVAS_TOOLS } from "./canvas.mjs";

const MODEL_LINE = /^([a-zA-Z0-9][\w.:/[\]-]{0,99})(?:\t+| {2,})(\S.*)$/;

/** `agy models` prints "slug<TAB>Name" lines; anything else is chatter */
export const parseModels = (output) =>
  String(output)
    .split(/\r?\n/)
    .map((line) => line.trim().match(MODEL_LINE))
    .filter(Boolean)
    .map(([, value, name]) => ({ value, name: name.trim(), description: "" }));

/** the signed-in account, as `agy` notes it in its log file */
export const findAccountEmail = (log) =>
  String(log).match(
    /(?:applyAuthResult: email=|authenticated successfully as )([^\s,]+@[^\s,]+)/,
  )?.[1] ?? null;

const CONVERSATION_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export const isConversationId = (value) =>
  typeof value === "string" && CONVERSATION_ID.test(value);

export const errorCodeFor = (text) => {
  if (/not logged in|authentication required|unauthenticated/i.test(text)) {
    return "authentication_failed";
  }
  if (/quota|rate.?limit|resource.?exhausted|\b429\b/i.test(text)) {
    return "rate_limit";
  }
  if (/model/i.test(text) && /unknown|invalid|not found/i.test(text)) {
    return "model_not_found";
  }
  return "agent_error";
};

const MAX_RESULT_CHARS = 8000;

/**
 * Turns `agy --output-format stream-json` events into the same browser events
 * the Claude chat uses. `readRoots` is what the agent may read; a tool that
 * ran outside the allowed set means the guard hook didn't hold, and is
 * reported through `onViolation` so the turn can be killed.
 */
export const createTranslator = ({
  emit,
  friendlyError,
  readRoots,
  onViolation,
  startedAt = Date.now(),
}) => {
  const started = new Set();
  let textStep = null;
  let finished = false;

  const handle = (msg) => {
    if (msg?.event === "init") {
      emit("session", {
        sessionId: msg.conversation_id,
        model: msg.init?.model,
      });
    } else if (msg?.event === "step_update") {
      const step = msg.step_update ?? {};
      if (step.step_type === "agent_response" && step.text_delta) {
        if (textStep !== step.step_index) {
          if (textStep === null && !step.text_delta.trim()) {
            return;
          }
          if (textStep !== null) {
            emit("text", { delta: "\n\n" });
          }
          textStep = step.step_index;
        }
        emit("text", { delta: step.text_delta });
        return;
      }
      if (step.step_type !== "tool") {
        return;
      }
      const info = step.tool_info ?? {};
      const args = info.parameters ?? {};
      const name = info.name || step.tool_name;
      const done = step.state !== "ACTIVE";
      if (done && !info.error && !isAllowedCall(name, args, readRoots)) {
        onViolation?.(name);
        return;
      }
      // only canvas work is shown; the agent's bookkeeping stays out of sight
      if (name !== "call_mcp_tool" || args.ServerName !== "excalidraw") {
        return;
      }
      const id = `agy-${step.step_index}`;
      if (!started.has(id)) {
        started.add(id);
        emit("tool", { name: args.ToolName });
        emit("tool_use", { id, name: args.ToolName, input: args.Arguments });
      }
      if (done) {
        const output = String(info.error?.message ?? info.output ?? "");
        emit("tool_result", {
          id,
          output: output.slice(0, MAX_RESULT_CHARS),
          isError: !!info.error,
        });
      }
    } else if (msg?.event === "result") {
      finished = true;
      const result = msg.result ?? {};
      if (result.status !== "SUCCESS") {
        const detail = result.error || `Antigravity stopped: ${result.status}`;
        const code = errorCodeFor(detail);
        emit("error", { code, message: friendlyError(code, detail) });
      } else if (textStep === null && result.response?.trim()) {
        emit("text", { delta: result.response });
      }
      // `agy` totals duration and turns over the whole conversation, so time
      // this turn here
      emit("done", {
        sessionId: result.conversation_id,
        durationMs: Date.now() - startedAt,
      });
    }
  };

  return {
    handle,
    get finished() {
      return finished;
    },
  };
};

// the canvas MCP server ---------------------------------------------------------

const elementList = {
  type: "array",
  minItems: 1,
  maxItems: 300,
  items: { type: "object" },
};

const object = (properties = {}) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
});

const TOOL_DEFS = {
  add_elements: {
    description:
      "Add elements to the canvas using Excalidraw's skeleton format (shapes with labels, text, arrows with start/end bindings, frames).",
    inputSchema: object({ elements: elementList }),
  },
  update_elements: {
    description:
      "Update existing elements by id. Each entry is {id, ...propertiesToChange} (e.g. x, y, width, height, strokeColor, backgroundColor, text).",
    inputSchema: object({ updates: elementList }),
  },
  delete_elements: {
    description: "Delete elements by id.",
    inputSchema: object({
      ids: {
        type: "array",
        minItems: 1,
        maxItems: 300,
        items: { type: "string" },
      },
    }),
  },
  clear_canvas: {
    description:
      "Remove EVERYTHING from the canvas. Only when the user explicitly asks to start over.",
    inputSchema: object(),
  },
};

const isList = (value, check) =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.length <= 300 &&
  value.every(check);
const isObject = (value) =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** the browser operation for a tool call, or null when the input is wrong */
export const toCanvasOp = (name, args = {}) => {
  if (name === "add_elements" && isList(args.elements, isObject)) {
    return { op: "add", elements: args.elements };
  }
  if (name === "update_elements" && isList(args.updates, isObject)) {
    return { op: "update", updates: args.updates };
  }
  if (
    name === "delete_elements" &&
    isList(args.ids, (id) => typeof id === "string")
  ) {
    return { op: "delete", ids: args.ids };
  }
  return name === "clear_canvas" ? { op: "clear" } : null;
};

/**
 * Answers one MCP JSON-RPC message. Returns null for notifications.
 * `emit` receives the canvas operations.
 */
export const answerMcp = (message, emit) => {
  const { id, method, params } = message ?? {};
  if (id === undefined || id === null) {
    return null;
  }
  const reply = (result) => ({ jsonrpc: "2.0", id, result });
  switch (method) {
    case "initialize":
      return reply({
        protocolVersion: params?.protocolVersion || "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "excalidraw", version: "1.0.0" },
      });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({
        tools: CANVAS_TOOLS.map((name) => ({ name, ...TOOL_DEFS[name] })),
      });
    case "tools/call": {
      const op = toCanvasOp(params?.name, params?.arguments);
      if (!op) {
        return reply({
          content: [{ type: "text", text: "Invalid tool name or arguments." }],
          isError: true,
        });
      }
      emit("ops", op);
      const count = (op.elements ?? op.updates ?? op.ids)?.length ?? 0;
      return reply({
        content: [
          {
            type: "text",
            text: `${params.name}: ${count} item(s) sent to the canvas.`,
          },
        ],
      });
    }
    default:
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: "Method not found" },
      };
  }
};
