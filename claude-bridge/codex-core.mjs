/**
 * Pure helpers for the Codex side of the bridge (no processes, no network, so
 * they're unit-testable): the Codex lockdown, reading the Codex SDK's events
 * and the account and model answers of the Codex app server.
 */
import { errorCodeFor as sharedErrorCode } from "./antigravity-core.mjs";
import { isModelId } from "./chat.mjs";

/**
 * Every Codex tool that reaches past the canvas, switched off: commands, file
 * viewing, browsing, other apps and plugins, sub-agents.
 */
const DISABLED_FEATURES = [
  "shell_tool",
  "unified_exec",
  "shell_snapshot",
  "view_image",
  "apps",
  "plugins",
  "remote_plugin",
  "hooks",
  "multi_agent",
  "image_generation",
  "browser_use",
  "browser_use_external",
  "computer_use",
  "in_app_browser",
  "tool_suggest",
  "skill_search",
  "skill_mcp_dependency_install",
  "workspace_dependencies",
  "goals",
  "sleep_tool",
];

/** `--config` overrides for one turn; `mcpUrl` is that turn's canvas server */
export const codexConfig = ({ mcpUrl, instructions }) => ({
  developer_instructions: instructions,
  model_reasoning_summary: "auto",
  features: Object.fromEntries(DISABLED_FEATURES.map((name) => [name, false])),
  // no AGENTS.md from the machine
  project_doc_max_bytes: 0,
  mcp_servers: {
    excalidraw: {
      url: mcpUrl,
      required: true,
      // the canvas tools run without asking; nobody is there to approve
      default_tools_approval_mode: "approve",
    },
  },
});

/** thread options that hold even if a tool were left switched on */
export const codexThreadOptions = ({ model, workDir }) => ({
  // "default" means: whatever Codex would pick for this account
  model: model && model !== "default" ? model : undefined,
  sandboxMode: "read-only",
  approvalPolicy: "never",
  networkAccessEnabled: false,
  webSearchMode: "disabled",
  skipGitRepoCheck: true,
  workingDirectory: workDir,
});

export const isThreadId = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);

export const errorCodeFor = (text) =>
  /\b401\b|unauthorized|not signed in|sign in again|token.*expired/i.test(text)
    ? "authentication_failed"
    : sharedErrorCode(text);

/** the API's errors arrive as a JSON string: keep just the sentence */
export const errorText = (message) => {
  const text = String(message ?? "");
  try {
    const json = JSON.parse(text.slice(text.indexOf("{")));
    return json.error?.message || json.message || text;
  } catch {
    return text;
  }
};

/** the app server's `account/read` answer */
export const toAccount = (result) => {
  const account = result?.account;
  return {
    loggedIn: !!account,
    email: account?.email ?? null,
    plan:
      account?.planType && account.planType !== "unknown"
        ? account.planType
        : null,
  };
};

/** the app server's `model/list` rows as picker rows */
export const toModelChoices = (models) => {
  const rows = (Array.isArray(models) ? models : []).filter(
    (m) => !m?.hidden && isModelId(m?.model),
  );
  if (!rows.length) {
    return [];
  }
  const standard = rows.find((m) => m.isDefault);
  return [
    {
      value: "default",
      name: "Default",
      description: standard
        ? `${standard.displayName || standard.model}, Codex's choice`
        : "Codex's choice",
    },
    ...rows.map((m) => ({
      value: m.model,
      name: String(m.displayName || m.model),
      description: String(m.description || ""),
    })),
  ];
};

const MAX_RESULT_CHARS = 8000;

// items that mean a tool outside the canvas ran: the lockdown didn't hold
const FORBIDDEN_ITEMS = {
  command_execution: "running a command",
  file_change: "changing files",
  web_search: "searching the web",
};

/**
 * Turns the Codex SDK's thread events into the same browser events the Claude
 * chat uses. A forbidden tool is reported through `onViolation` so the turn can
 * be stopped.
 */
export const createTranslator = ({
  emit,
  friendlyError,
  onViolation,
  model,
  sessionId,
  startedAt = Date.now(),
}) => {
  const started = new Set();
  let thread = sessionId;
  let wroteText = false;
  let finished = false;

  const fail = (message) => {
    // Codex reports a failed turn twice (`error`, then `turn.failed`)
    if (finished) {
      return;
    }
    finished = true;
    const detail = errorText(message);
    const code = errorCodeFor(detail);
    emit("error", { code, message: friendlyError(code, detail) });
  };

  const handleItem = (type, item) => {
    if (FORBIDDEN_ITEMS[item.type]) {
      onViolation?.(FORBIDDEN_ITEMS[item.type]);
      return;
    }
    const done = type === "item.completed";
    if (item.type === "mcp_tool_call") {
      if (item.server !== "excalidraw") {
        // Codex's own MCP bookkeeping (listing resources) is harmless
        if (item.server !== "codex") {
          onViolation?.(`${item.server}/${item.tool}`);
        }
        return;
      }
      if (!started.has(item.id)) {
        started.add(item.id);
        emit("tool", { name: item.tool });
        emit("tool_use", {
          id: item.id,
          name: item.tool,
          input: item.arguments,
        });
      }
      if (done) {
        const output =
          item.error?.message ??
          (item.result?.content ?? [])
            .map((part) => (part?.type === "text" ? part.text : ""))
            .join("");
        emit("tool_result", {
          id: item.id,
          output: String(output).slice(0, MAX_RESULT_CHARS),
          isError: item.status === "failed",
        });
      }
    } else if (done && item.type === "agent_message" && item.text) {
      emit("text", { delta: `${wroteText ? "\n\n" : ""}${item.text}` });
      wroteText = true;
    } else if (done && item.type === "reasoning" && item.text) {
      emit("thinking", { delta: `${item.text}\n\n` });
    }
  };

  const handle = (event) => {
    switch (event?.type) {
      case "thread.started":
        thread = event.thread_id;
        emit("session", { sessionId: thread, model });
        break;
      case "item.started":
      case "item.updated":
      case "item.completed":
        handleItem(event.type, event.item ?? {});
        break;
      case "turn.completed":
        finished = true;
        emit("done", { sessionId: thread, durationMs: Date.now() - startedAt });
        break;
      case "turn.failed":
        fail(event.error?.message);
        break;
      case "error":
        // retries are announced this way too; the turn goes on
        if (!/^reconnecting/i.test(event.message ?? "")) {
          fail(event.message);
        }
        break;
      default:
        break;
    }
  };

  return {
    handle,
    get finished() {
      return finished;
    },
  };
};
