import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  buildUserContent,
  findLoginUrl,
  MAX_ATTACHMENT_BYTES,
  translateMessage,
  validateAttachments,
  isModelId,
  toModelChoices,
} from "../chat.mjs";

const b64 = (value) => Buffer.from(value).toString("base64");

describe("attachments", () => {
  test("accepts PDFs, images and text and builds content blocks", () => {
    const files = validateAttachments([
      {
        name: "plan.md",
        mediaType: "text/markdown",
        data: b64("# Plan\nship"),
      },
      { name: "spec.pdf", mediaType: "application/pdf", data: b64("%PDF-1.4") },
      { name: "shot.png", mediaType: "image/png", data: b64("png") },
      { name: "data.csv", mediaType: "", data: b64("a,b\n1,2") },
    ]);
    const blocks = buildUserContent("make a diagram", files);
    assert.deepEqual(
      blocks.map((b) => b.type),
      ["text", "document", "image", "text", "text"],
    );
    assert.match(blocks[0].text, /plan\.md[\s\S]*ship/);
    assert.equal(blocks[1].source.media_type, "application/pdf");
    assert.match(blocks[3].text, /data\.csv[\s\S]*a,b/);
    assert.equal(blocks.at(-1).text, "make a diagram");
  });

  test("rejects files over 5 MB, unreadable types and too many files", () => {
    const big = b64(Buffer.alloc(MAX_ATTACHMENT_BYTES + 3));
    assert.throws(
      () =>
        validateAttachments([
          { name: "big.txt", mediaType: "text/plain", data: big },
        ]),
      /larger than 5 MB/,
    );
    // exactly 5 MB is fine
    assert.equal(
      validateAttachments([
        {
          name: "ok.txt",
          mediaType: "text/plain",
          data: b64(Buffer.alloc(MAX_ATTACHMENT_BYTES)),
        },
      ]).length,
      1,
    );
    assert.throws(
      () =>
        validateAttachments([
          { name: "a.docx", mediaType: "application/zip", data: b64("x") },
        ]),
      /can't be read/,
    );
    assert.throws(
      () =>
        validateAttachments(
          Array.from({ length: 6 }, () => ({
            name: "a.txt",
            mediaType: "text/plain",
            data: "",
          })),
        ),
      /at most 5/,
    );
    assert.throws(
      () =>
        validateAttachments([
          { name: "a.txt", mediaType: "text/plain", data: "not base64!!" },
        ]),
      /base64/,
    );
    assert.deepEqual(validateAttachments(undefined), []);
  });
});

describe("message translation", () => {
  const run = (messages) => {
    const events = [];
    for (const msg of messages) {
      translateMessage(
        msg,
        (event, data) => events.push([event, data]),
        (code, detail) => `friendly:${code}:${detail ?? ""}`,
      );
    }
    return events;
  };

  test("streams text, thinking, tool calls with input, results and stats", () => {
    const events = run([
      { type: "system", subtype: "init", session_id: "s1", model: "claude-x" },
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "thinking_delta", thinking: "hmm" },
        },
      },
      {
        type: "stream_event",
        event: {
          type: "content_block_start",
          content_block: {
            type: "tool_use",
            name: "mcp__excalidraw__add_elements",
          },
        },
      },
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tu1",
              name: "mcp__excalidraw__add_elements",
              input: { elements: [{ id: "a" }] },
            },
          ],
        },
      },
      {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu1",
              content: [{ type: "text", text: "add_elements: 1 item(s)" }],
            },
          ],
        },
      },
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "Done." },
        },
      },
      {
        type: "result",
        session_id: "s1",
        duration_ms: 1200,
        num_turns: 2,
        total_cost_usd: 0.01,
      },
    ]);
    assert.deepEqual(
      events.map((e) => e[0]),
      [
        "session",
        "thinking",
        "tool",
        "tool_use",
        "tool_result",
        "text",
        "done",
      ],
    );
    assert.deepEqual(events[0][1], { sessionId: "s1", model: "claude-x" });
    assert.deepEqual(events[2][1], { name: "add_elements" });
    assert.deepEqual(events[3][1], {
      id: "tu1",
      name: "add_elements",
      input: { elements: [{ id: "a" }] },
    });
    assert.deepEqual(events[4][1], {
      id: "tu1",
      output: "add_elements: 1 item(s)",
      isError: false,
    });
    assert.deepEqual(events[6][1], {
      sessionId: "s1",
      durationMs: 1200,
      turns: 2,
      costUsd: 0.01,
    });
  });

  test("reports errors in plain words and ignores sub-agent chatter", () => {
    const events = run([
      {
        type: "stream_event",
        parent_tool_use_id: "x",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "hidden" },
        },
      },
      { type: "assistant", error: "rate_limit", message: { content: [] } },
      {
        type: "result",
        is_error: true,
        subtype: "error_max_turns",
        session_id: "s",
      },
    ]);
    assert.deepEqual(
      events.map((e) => e[0]),
      ["error", "error", "done"],
    );
    assert.equal(events[0][1].message, "friendly:rate_limit:");
  });
});

test("model list becomes picker rows without per-token prices", () => {
  assert.deepEqual(
    toModelChoices([
      {
        value: "default",
        displayName: "Default (recommended)",
        description: "Use the default model · $4/$20 per Mtok",
      },
      {
        value: "opus",
        displayName: "Opus",
        description: "Opus 5.5 · Best for complex tasks · $4/$20 per Mtok",
      },
      { value: "--bad flag" },
    ]),
    [
      {
        value: "default",
        name: "Default",
        description: "Use the default model",
      },
      {
        value: "opus",
        name: "Opus 5.5",
        description: "Best for complex tasks",
      },
    ],
  );
  assert.equal(isModelId("claude-fable-5-2[1m]"), true);
  assert.equal(isModelId("--flag"), false);
});

describe("sign-in link", () => {
  const url = "https://claude.com/cai/oauth/authorize?code=true&state=abc-_1";

  test("reads a plain link", () => {
    assert.equal(findLoginUrl(`visit: ${url}\nPaste code > `), url);
  });

  test("drops terminal hyperlink escape codes", () => {
    const linked = `\x1b]8;;${url}\x07${url}\x1b]8;;\x07`;
    assert.equal(findLoginUrl(`visit: ${linked}\n`), url);
  });

  test("waits for the whole link", () => {
    assert.equal(findLoginUrl(`visit: ${url.slice(0, -3)}`), null);
  });
});
