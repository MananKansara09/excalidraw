/**
 * Pure helpers for the chat endpoint (no SDK import, so they're unit-testable):
 * turning uploaded files into prompt content, and turning the Agent SDK's
 * message stream into the events the browser shows in its chat and log view.
 */

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENTS = 5;
/** Largest chat request body: five 5 MB files as base64, plus the prompt. */
export const MAX_CHAT_BODY =
  Math.ceil((MAX_ATTACHMENTS * MAX_ATTACHMENT_BYTES * 4) / 3) + 1024 * 1024;

const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
const TEXT_EXTENSIONS = new Set(
  (
    "txt md markdown csv tsv json xml yaml yml html htm css js jsx ts tsx py " +
    "java go rs sql mmd mermaid log excalidraw"
  ).split(" "),
);
const MAX_TEXT_CHARS = 400_000;

const extensionOf = (name) => (name.split(".").pop() || "").toLowerCase();

/** Throws an Error (message safe to show the user) for a bad upload list. */
export const validateAttachments = (input) => {
  if (input === undefined || input === null) {
    return [];
  }
  if (!Array.isArray(input) || input.length > MAX_ATTACHMENTS) {
    throw new Error(`Attach at most ${MAX_ATTACHMENTS} files.`);
  }
  return input.map((file) => {
    if (
      !file ||
      typeof file.name !== "string" ||
      typeof file.mediaType !== "string" ||
      typeof file.data !== "string" ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(file.data)
    ) {
      throw new Error("Each attachment needs a name, type and base64 data.");
    }
    const name = file.name.slice(0, 200);
    const bytes = Buffer.byteLength(file.data, "base64");
    if (bytes > MAX_ATTACHMENT_BYTES) {
      throw new Error(`${name} is larger than 5 MB.`);
    }
    const ext = extensionOf(name);
    const isPdf = file.mediaType === "application/pdf" || ext === "pdf";
    const isImage = IMAGE_TYPES.has(file.mediaType);
    const isText =
      file.mediaType.startsWith("text/") || TEXT_EXTENSIONS.has(ext);
    if (!isPdf && !isImage && !isText) {
      throw new Error(
        `${name} can't be read. Attach a PDF, an image or a text file; export Word and Excel files to PDF or CSV first.`,
      );
    }
    return {
      name,
      kind: isImage ? "image" : isPdf ? "pdf" : "text",
      mediaType: file.mediaType,
      data: file.data,
    };
  });
};

/** Content blocks for the user turn: attachments first, then the request. */
export const buildUserContent = (promptText, attachments) => {
  const blocks = [];
  for (const file of attachments) {
    if (file.kind === "image") {
      blocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: file.mediaType,
          data: file.data,
        },
      });
    } else if (file.kind === "pdf") {
      blocks.push({
        type: "document",
        title: file.name,
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: file.data,
        },
      });
    } else {
      const text = Buffer.from(file.data, "base64").toString("utf8");
      blocks.push({
        type: "text",
        text: `Attached file "${file.name}":\n\n${text.slice(
          0,
          MAX_TEXT_CHARS,
        )}${text.length > MAX_TEXT_CHARS ? "\n… (truncated)" : ""}`,
      });
    }
  }
  blocks.push({ type: "text", text: promptText });
  return blocks;
};

const MODEL_ID = /^[a-zA-Z0-9][\w.:/[\]-]{0,99}$/;
export const isModelId = (value) =>
  typeof value === "string" && MODEL_ID.test(value);

/**
 * The Agent SDK's model list as picker rows. Per-token prices are dropped:
 * the panel runs on the user's subscription.
 */
export const toModelChoices = (models) =>
  (Array.isArray(models) ? models : [])
    .filter((m) => isModelId(m?.value))
    .map((m) => {
      const parts = String(m.description || "")
        .split(" · ")
        .filter((part) => part && !part.includes("per Mtok"));
      const title = String(m.displayName || m.value);
      // "Opus 5.5 · Best for …": the versioned name makes the better title
      const name =
        m.value === "default"
          ? "Default"
          : parts[0]?.startsWith(title)
          ? parts.shift()
          : title;
      return { value: m.value, name, description: parts.join(" · ") };
    });

const stripToolPrefix = (name) =>
  String(name).replace(/^mcp__excalidraw__/, "");

const MAX_RESULT_CHARS = 8000;

const toolResultText = (content) => {
  const text = Array.isArray(content)
    ? content.map((part) => (part?.type === "text" ? part.text : "")).join("")
    : typeof content === "string"
    ? content
    : JSON.stringify(content ?? "");
  return text.length > MAX_RESULT_CHARS
    ? `${text.slice(0, MAX_RESULT_CHARS)}… (truncated)`
    : text;
};

/**
 * Translates one Agent SDK message into browser events via `emit(event, data)`.
 * `friendlyError(code, detail)` words errors for the user.
 */
export const translateMessage = (msg, emit, friendlyError) => {
  if (msg.type === "system" && msg.subtype === "init") {
    emit("session", { sessionId: msg.session_id, model: msg.model });
  } else if (msg.type === "stream_event") {
    const ev = msg.event;
    if (msg.parent_tool_use_id) {
      return;
    }
    if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
      emit("text", { delta: ev.delta.text });
    } else if (
      ev.type === "content_block_delta" &&
      ev.delta.type === "thinking_delta"
    ) {
      emit("thinking", { delta: ev.delta.thinking });
    } else if (
      ev.type === "content_block_start" &&
      ev.content_block.type === "tool_use"
    ) {
      emit("tool", { name: stripToolPrefix(ev.content_block.name) });
    }
  } else if (msg.type === "assistant") {
    if (msg.error) {
      emit("error", { code: msg.error, message: friendlyError(msg.error) });
    }
    // the finished message carries each tool call's full input
    for (const block of msg.message?.content ?? []) {
      if (block.type === "tool_use" && !msg.parent_tool_use_id) {
        emit("tool_use", {
          id: block.id,
          name: stripToolPrefix(block.name),
          input: block.input,
        });
      }
    }
  } else if (msg.type === "user") {
    const content = msg.message?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "tool_result") {
          emit("tool_result", {
            id: block.tool_use_id,
            output: toolResultText(block.content),
            isError: !!block.is_error,
          });
        }
      }
    }
  } else if (msg.type === "result") {
    if (msg.is_error) {
      emit("error", {
        code: msg.subtype,
        message: friendlyError(msg.subtype, msg.result),
      });
    }
    emit("done", {
      sessionId: msg.session_id,
      durationMs: msg.duration_ms,
      turns: msg.num_turns,
      costUsd: msg.total_cost_usd,
    });
  }
};
