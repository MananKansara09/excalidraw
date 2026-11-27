/**
 * A/B check of the default skills: the same requests go to Claude twice, with
 * the panel's instructions as they are and with the skills taken out.
 *
 *   node skills-eval/run.mjs with
 *   node skills-eval/run.mjs without
 *
 * Writes skills-eval/out/<variant>.json (every canvas operation and reply).
 * Uses the local `claude login`, so it spends some of that plan.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";

import { CANVAS_TOOLS, systemPrompt } from "../claude-bridge/canvas.mjs";
import { skillsPrompt } from "../claude-bridge/skills.mjs";

const require = createRequire(
  new URL("../claude-bridge/package.json", import.meta.url),
);
const load = (name) => import(pathToFileURL(require.resolve(name)).href);
const { query, createSdkMcpServer, tool } = await load(
  "@anthropic-ai/claude-agent-sdk",
);
const { z } = await load("zod");

const variant = process.argv[2];
if (variant !== "with" && variant !== "without") {
  throw new Error("Usage: node skills-eval/run.mjs with|without");
}

const REQUESTS = [
  `Project "Atlas": an AI agentic platform for enterprises (users and apps, API gateway, orchestrator, planner and worker agents, tool gateway, model router, memory, retrieval, guardrails, human approval, observability, data stores). Draw its system architecture.`,
  `Now add Atlas's technical documentation to the right of the architecture, one frame per document: agent execution flow, data model, API contract, security and guardrails, deployment, and non-functional requirements.`,
  `Now add a client presentation for Atlas below everything: 6 slides, one frame per slide, that a non-technical buyer can follow.`,
];

let instructions = `${systemPrompt("Claude")}
You cannot read files from disk or run commands. If asked for something unrelated to drawing, answer briefly.`;
if (variant === "without") {
  instructions = instructions.replace(`\n\n${skillsPrompt()}`, "");
}
if (instructions.includes("# Designer") !== (variant === "with")) {
  throw new Error("The instructions don't match the variant");
}

const ops = [];
const scene = new Map();
const apply = (op) => {
  ops.push({ turn, ...op });
  for (const el of op.elements ?? []) {
    scene.set(el.id ?? `anon-${scene.size}`, el);
  }
  for (const { id, ...props } of op.updates ?? []) {
    if (scene.has(id)) {
      scene.set(id, { ...scene.get(id), ...props });
    }
  }
  for (const id of op.ids ?? []) {
    scene.delete(id);
  }
  if (op.op === "clear") {
    scene.clear();
  }
};

/** like the browser's summary: what is on the canvas, briefly */
const summary = () =>
  scene.size
    ? `Current canvas (one JSON per line):\n${[...scene.values()]
        .slice(0, 200)
        .map(({ id, type, x, y, width, height, text, label, name }) =>
          JSON.stringify({
            id,
            type,
            x,
            y,
            w: width,
            h: height,
            text: text ?? label?.text ?? name,
          }),
        )
        .join("\n")}`
    : "The canvas is currently empty.";

const reply = (name, count) => ({
  content: [
    { type: "text", text: `${name}: ${count} item(s) sent to the canvas.` },
  ],
});
const list = z.array(z.object({}).passthrough()).min(1).max(300);
const server = () =>
  createSdkMcpServer({
    name: "excalidraw",
    version: "1.0.0",
    tools: [
      tool(
        "add_elements",
        "Add elements to the canvas using Excalidraw's skeleton format (shapes with labels, text, arrows with start/end bindings, frames).",
        { elements: list },
        async ({ elements }) => {
          apply({ op: "add", elements });
          return reply("add_elements", elements.length);
        },
      ),
      tool(
        "update_elements",
        "Update existing elements by id. Each entry is {id, ...propertiesToChange}.",
        { updates: list },
        async ({ updates }) => {
          apply({ op: "update", updates });
          return reply("update_elements", updates.length);
        },
      ),
      tool(
        "delete_elements",
        "Delete elements by id.",
        { ids: z.array(z.string()).min(1).max(300) },
        async ({ ids }) => {
          apply({ op: "delete", ids });
          return reply("delete_elements", ids.length);
        },
      ),
      tool(
        "clear_canvas",
        "Remove EVERYTHING from the canvas.",
        {},
        async () => {
          apply({ op: "clear" });
          return reply("clear_canvas", 0);
        },
      ),
    ],
  });

const env = { ...process.env };
delete env.ANTHROPIC_API_KEY;
delete env.ANTHROPIC_AUTH_TOKEN;
// a run started from inside Claude Code must not look like a nested session
for (const key of Object.keys(env)) {
  if (/^CLAUDE(CODE|_CODE|_AGENT)/.test(key)) {
    delete env[key];
  }
}

const outDir = fileURLToPath(new URL("./out", import.meta.url));
mkdirSync(outDir, { recursive: true });

const turns = [];
let sessionId;
let turn = 0;
for (const request of REQUESTS) {
  turn++;
  let text = "";
  let result;
  const stream = query({
    prompt: `${summary()}\n\n---\nUser request:\n${request}`,
    options: {
      cwd: os.tmpdir(),
      env,
      resume: sessionId,
      systemPrompt: instructions,
      settingSources: [],
      tools: [],
      mcpServers: { excalidraw: server() },
      allowedTools: CANVAS_TOOLS.map((n) => `mcp__excalidraw__${n}`),
      permissionMode: "dontAsk",
      maxTurns: 12,
    },
  });
  for await (const msg of stream) {
    if (msg.type === "system" && msg.subtype === "init") {
      sessionId = msg.session_id;
      console.log(`turn ${turn}: model ${msg.model}`);
    }
    if (msg.type === "assistant") {
      for (const block of msg.message?.content ?? []) {
        if (block.type === "text") {
          text += block.text;
        }
      }
    }
    if (msg.type === "result") {
      result = {
        ok: !msg.is_error,
        subtype: msg.subtype,
        durationMs: msg.duration_ms,
        toolTurns: msg.num_turns,
        outputTokens: msg.usage?.output_tokens,
      };
    }
  }
  turns.push({ request, reply: text, ...result });
  writeFileSync(
    `${outDir}/${variant}.json`,
    JSON.stringify({ variant, turns, ops }),
  );
  console.log(`turn ${turn}: ${JSON.stringify(result)}, ${scene.size} items`);
  if (!result?.ok) {
    console.log(text.slice(0, 500));
    process.exit(1);
  }
}
