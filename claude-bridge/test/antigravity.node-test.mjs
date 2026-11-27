import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  answerMcp,
  createTranslator,
  errorCodeFor,
  findAccountEmail,
  isConversationId,
  parseModels,
} from "../antigravity-core.mjs";
import { isAllowedCall } from "../antigravity-guard.mjs";

const root = path.resolve(os.tmpdir(), "agy-test", "attachments");

describe("agy output", () => {
  it("reads the model list and skips chatter", () => {
    assert.deepEqual(
      parseModels(
        "Fetching available models...\r\ngemini-3.8-flash-low\tGemini 3.8 Flash (Low)\r\n",
      ),
      [
        {
          value: "gemini-3.8-flash-low",
          name: "Gemini 3.8 Flash (Low)",
          description: "",
        },
      ],
    );
    assert.deepEqual(parseModels("Error: You are not logged in"), []);
  });

  it("finds the account and validates ids", () => {
    assert.equal(
      findAccountEmail("applyAuthResult: email=a@b.com, authMethod=consumer"),
      "a@b.com",
    );
    assert.equal(findAccountEmail("nothing"), null);
    assert.ok(isConversationId("844bb832-a750-42b4-a9b5-9c3b7f2ada4f"));
    assert.ok(!isConversationId("--dangerously-skip-permissions"));
    assert.equal(
      errorCodeFor("authentication required"),
      "authentication_failed",
    );
    assert.equal(errorCodeFor("RESOURCE_EXHAUSTED"), "rate_limit");
  });
});

describe("guard", () => {
  const allowed = (name, args) => isAllowedCall(name, args, [root]);

  it("allows only canvas tools and reading the uploads", () => {
    assert.ok(
      allowed("call_mcp_tool", {
        ServerName: "excalidraw",
        ToolName: "add_elements",
      }),
    );
    assert.ok(allowed("view_file", { AbsolutePath: path.join(root, "a.png") }));
    for (const [name, args] of [
      ["call_mcp_tool", { ServerName: "codegraph", ToolName: "add_elements" }],
      ["run_command", { CommandLine: "dir" }],
      ["search_web", { query: "x" }],
      ["invoke_subagent", {}],
      ["read_file", { Path: path.join(root, "..", "secret.txt") }],
      ["read_file", { Path: "relative.txt" }],
      ["read_file", {}],
    ]) {
      assert.ok(!allowed(name, args), `${name} ${JSON.stringify(args)}`);
    }
  });

  it("answers as a hook, refusing anything unreadable", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "agy-guard-"));
    try {
      copyFileSync(
        fileURLToPath(new URL("../antigravity-guard.mjs", import.meta.url)),
        path.join(dir, "guard.mjs"),
      );
      writeFileSync(
        path.join(dir, "guard.json"),
        JSON.stringify({ readRoots: [root] }),
      );
      const run = (input) =>
        JSON.parse(
          spawnSync(process.execPath, ["guard.mjs"], { cwd: dir, input })
            .stdout,
        ).decision;
      assert.equal(
        run(JSON.stringify({ toolCall: { name: "finish", args: {} } })),
        "allow",
      );
      assert.equal(
        run(JSON.stringify({ toolCall: { name: "run_command", args: {} } })),
        "deny",
      );
      assert.equal(run("not json"), "deny");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("translator", () => {
  const collect = () => {
    const events = [];
    const violations = [];
    const translator = createTranslator({
      emit: (event, data) => events.push([event, data]),
      friendlyError: (code) => code,
      readRoots: [root],
      onViolation: (name) => violations.push(name),
    });
    return { events, violations, translator };
  };
  const step = (step_update) => ({ event: "step_update", step_update });

  it("shows canvas calls and text, and hides bookkeeping", () => {
    const { events, translator } = collect();
    const tool = {
      step_type: "tool",
      step_index: 4,
      tool_info: {
        name: "call_mcp_tool",
        parameters: {
          ServerName: "excalidraw",
          ToolName: "add_elements",
          Arguments: { elements: [{}] },
        },
        output: "ok",
      },
    };
    translator.handle(step({ ...tool, state: "ACTIVE" }));
    translator.handle(step({ ...tool, state: "DONE" }));
    translator.handle(
      step({
        step_type: "tool",
        step_index: 5,
        state: "DONE",
        tool_info: { name: "update_steps", parameters: {} },
      }),
    );
    translator.handle(
      step({
        step_type: "agent_response",
        step_index: 6,
        state: "ACTIVE",
        text_delta: "Done",
      }),
    );
    translator.handle({
      event: "result",
      result: { status: "SUCCESS", response: "Done" },
    });
    assert.deepEqual(
      events.map(([name]) => name),
      ["tool", "tool_use", "tool_result", "text", "done"],
    );
    assert.ok(translator.finished);
  });

  it("reports a forbidden tool that ran, but not one that was refused", () => {
    const { violations, translator } = collect();
    const run = { name: "run_command", parameters: {} };
    translator.handle(
      step({
        step_type: "tool",
        state: "DONE",
        tool_info: { ...run, error: { message: "denied" } },
      }),
    );
    assert.deepEqual(violations, []);
    translator.handle(
      step({ step_type: "tool", state: "DONE", tool_info: run }),
    );
    assert.deepEqual(violations, ["run_command"]);
  });

  it("turns a failed turn into an error", () => {
    const { events, translator } = collect();
    translator.handle({
      event: "result",
      result: { status: "ERROR", error: "quota exceeded" },
    });
    assert.deepEqual(events[0], [
      "error",
      { code: "rate_limit", message: "rate_limit" },
    ]);
  });
});

describe("canvas MCP server", () => {
  const ask = (method, params, ops = []) =>
    answerMcp({ jsonrpc: "2.0", id: 1, method, params }, (_, op) =>
      ops.push(op),
    );

  it("lists the canvas tools", () => {
    assert.equal(ask("tools/list").result.tools.length, 4);
    assert.equal(ask("server/discover").error.code, -32601);
    assert.equal(answerMcp({ method: "notifications/initialized" }), null);
  });

  it("forwards valid calls only", () => {
    const ops = [];
    ask(
      "tools/call",
      { name: "delete_elements", arguments: { ids: ["a"] } },
      ops,
    );
    const bad = ask(
      "tools/call",
      { name: "add_elements", arguments: { elements: "x" } },
      ops,
    );
    assert.ok(bad.result.isError);
    assert.deepEqual(ops, [{ op: "delete", ids: ["a"] }]);
  });
});
