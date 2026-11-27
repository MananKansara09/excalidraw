import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  codexConfig,
  codexThreadOptions,
  createTranslator,
  errorCodeFor,
  errorText,
  isThreadId,
  toAccount,
  toModelChoices,
} from "../codex-core.mjs";
import { buildInput } from "../codex.mjs";

const run = (events) => {
  const emitted = [];
  const violations = [];
  const translator = createTranslator({
    emit: (event, data) => emitted.push([event, data]),
    friendlyError: (code, detail) => `${code}: ${detail}`,
    onViolation: (what) => violations.push(what),
  });
  events.forEach(translator.handle);
  return { emitted, violations, translator };
};

test("Codex gets no tool but the canvas ones", () => {
  const config = codexConfig({ mcpUrl: "http://x/mcp", instructions: "hi" });
  for (const name of ["shell_tool", "unified_exec", "view_image", "plugins"]) {
    assert.equal(config.features[name], false);
  }
  assert.deepEqual(Object.keys(config.mcp_servers), ["excalidraw"]);
  const options = codexThreadOptions({ model: "default", workDir: "/w" });
  assert.equal(options.model, undefined);
  assert.equal(options.sandboxMode, "read-only");
  assert.equal(options.approvalPolicy, "never");
  assert.equal(options.webSearchMode, "disabled");
});

test("thread events become chat events", () => {
  const call = {
    id: "item_1",
    type: "mcp_tool_call",
    server: "excalidraw",
    tool: "add_elements",
    arguments: { elements: [{}] },
  };
  const { emitted, violations, translator } = run([
    { type: "thread.started", thread_id: "t1" },
    {
      type: "item.completed",
      item: { id: "item_0", type: "reasoning", text: "Plan" },
    },
    { type: "item.started", item: { ...call, status: "in_progress" } },
    {
      type: "item.completed",
      item: {
        ...call,
        status: "completed",
        result: { content: [{ type: "text", text: "ok" }] },
      },
    },
    {
      type: "item.completed",
      item: { id: "item_2", type: "agent_message", text: "Drawn." },
    },
    { type: "turn.completed", usage: {} },
  ]);
  assert.deepEqual(violations, []);
  assert.deepEqual(
    emitted.map(([event]) => event),
    ["session", "thinking", "tool", "tool_use", "tool_result", "text", "done"],
  );
  assert.equal(emitted[4][1].output, "ok");
  assert.equal(emitted[6][1].sessionId, "t1");
  assert.equal(translator.finished, true);
});

test("a tool outside the canvas is reported", () => {
  const { violations, emitted } = run([
    { type: "item.started", item: { type: "command_execution" } },
    { type: "item.completed", item: { type: "file_change" } },
    {
      type: "item.started",
      item: { type: "mcp_tool_call", server: "other", tool: "x" },
    },
  ]);
  assert.equal(violations.length, 3);
  assert.deepEqual(emitted, []);
});

test("a failed turn is reported once; reconnecting isn't a failure", () => {
  const detail = 'unexpected status 401: {"error":{"message":"token expired"}}';
  const { emitted } = run([
    { type: "error", message: "Reconnecting... 1/5" },
    { type: "error", message: detail },
    { type: "turn.failed", error: { message: detail } },
  ]);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0][1].code, "authentication_failed");
});

test("errors are classified and unwrapped", () => {
  assert.equal(errorCodeFor("429 Too Many Requests"), "rate_limit");
  assert.equal(errorCodeFor("The model x is not found"), "model_not_found");
  assert.equal(errorCodeFor("boom"), "agent_error");
  assert.equal(errorText('{"error":{"message":"nope"}}'), "nope");
  assert.equal(errorText("plain"), "plain");
});

test("account and model answers are read", () => {
  assert.deepEqual(toAccount({ account: null }), {
    loggedIn: false,
    email: null,
    plan: null,
  });
  assert.deepEqual(
    toAccount({
      account: { type: "chatgpt", email: "a@b.c", planType: "plus" },
    }),
    { loggedIn: true, email: "a@b.c", plan: "plus" },
  );
  const models = toModelChoices([
    { model: "m1", displayName: "M One", description: "d", isDefault: true },
    { model: "m2", hidden: true },
  ]);
  assert.deepEqual(
    models.map((m) => m.value),
    ["default", "m1"],
  );
  assert.deepEqual(toModelChoices([]), []);
});

test("only thread ids can be resumed", () => {
  assert.equal(isThreadId("01a21da2-4d1a-75f3-8172-99e0b967a6b3"), true);
  assert.equal(isThreadId("--last"), false);
});

/** a one-page PDF saying `text` */
const pdf = (text) => {
  const stream = `BT /F1 12 Tf 10 100 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = objects.map((object, i) => {
    const at = body.length;
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
    return at;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .map((at) => `${String(at).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size ${
    objects.length + 1
  } /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body).toString("base64");
};

test("attachments: text and PDFs are inlined, images saved", async () => {
  const folder = mkdtempSync(path.join(os.tmpdir(), "codex-test-"));
  try {
    const input = await buildInput(
      "draw",
      [
        {
          name: "a.txt",
          kind: "text",
          data: Buffer.from("alpha").toString("base64"),
        },
        { name: "b.pdf", kind: "pdf", data: pdf("bravo") },
        { name: "c d.png", kind: "image", data: "aGk=" },
      ],
      folder,
    );
    assert.match(input[0].text, /alpha[\s\S]*bravo[\s\S]*draw$/);
    assert.equal(input[1].type, "local_image");
    assert.equal(readFileSync(input[1].path, "utf8"), "hi");
    await assert.rejects(
      buildInput("x", [{ name: "bad.pdf", kind: "pdf", data: "aGk=" }], folder),
      /bad\.pdf/,
    );
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
