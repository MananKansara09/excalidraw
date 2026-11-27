/**
 * The Antigravity agent's lock: a PreToolUse hook that refuses every tool
 * except the canvas ones and reading what the bridge itself handed over.
 *
 * The bridge copies this file into the agent's workspace (`.agents/`), next to
 * a `guard.json` listing the folders it may read. `agy` runs it for each tool
 * call: JSON in on stdin, a decision out on stdout. It must stay free of local
 * imports, and anything unexpected is refused.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const CANVAS = new Set([
  "add_elements",
  "update_elements",
  "delete_elements",
  "clear_canvas",
]);
// the agent's own bookkeeping: no effect outside the conversation
const HARMLESS = new Set(["finish", "update_steps"]);
const READERS = new Set(["read_file", "view_file"]);

const isInside = (file, root) => {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  return !!relative && !relative.startsWith("..") && !path.isAbsolute(relative);
};

export const isAllowedCall = (name, args, readRoots) => {
  if (name === "call_mcp_tool") {
    return args?.ServerName === "excalidraw" && CANVAS.has(args?.ToolName);
  }
  if (HARMLESS.has(name)) {
    return true;
  }
  if (READERS.has(name)) {
    let file = args?.Path ?? args?.AbsolutePath;
    if (typeof file !== "string") {
      return false;
    }
    try {
      if (file.startsWith("file:")) {
        file = fileURLToPath(file);
      }
    } catch {
      return false;
    }
    return (
      path.isAbsolute(file) && readRoots.some((root) => isInside(file, root))
    );
  }
  return false;
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  let input = "";
  process.stdin.on("data", (d) => (input += d));
  process.stdin.on("end", () => {
    let allowed = false;
    try {
      const { toolCall } = JSON.parse(input);
      const { readRoots } = JSON.parse(
        readFileSync(new URL("./guard.json", import.meta.url), "utf8"),
      );
      allowed = isAllowedCall(toolCall.name, toolCall.args, readRoots);
    } catch {}
    process.stdout.write(
      JSON.stringify(
        allowed
          ? { decision: "allow" }
          : {
              decision: "deny",
              reason:
                "Only the excalidraw canvas tools are available here. Draw with those.",
            },
      ),
    );
  });
}
