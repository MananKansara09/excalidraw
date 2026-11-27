/**
 * Copies the default skills to where coding tools look for them.
 *
 *   yarn skills:sync      this repository (committed, so it works on clone)
 *   yarn skills:install   your home folder, so every project gets them
 *
 * Claude Code reads `.claude/skills`; Codex and Antigravity read
 * `.agents/skills`. Their per-user folders differ, see `targets`.
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { SKILLS_DIR, skillNames } from "./skills.mjs";

const REPO = fileURLToPath(new URL("..", import.meta.url));
/** marks a copy as ours, so a user's own skill is never replaced */
const MARKER = ".excalidraw-skill";

export const PROJECT_TARGETS = [".claude/skills", ".agents/skills"];

export const targets = (global, home = os.homedir()) =>
  global
    ? [
        // Claude Code
        path.join(home, ".claude", "skills"),
        // Codex
        path.join(home, ".agents", "skills"),
        // Antigravity (app and CLI)
        path.join(home, ".gemini", "config", "skills"),
      ]
    : PROJECT_TARGETS.map((dir) => path.join(REPO, dir));

/** returns what was installed and what was left alone */
export const installSkills = (dirs, { force = false } = {}) => {
  const installed = [];
  const skipped = [];
  for (const dir of dirs) {
    for (const name of skillNames()) {
      const target = path.join(dir, name);
      const ours = existsSync(path.join(target, MARKER));
      if (existsSync(target) && !ours && !force) {
        skipped.push(target);
        continue;
      }
      rmSync(target, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      cpSync(path.join(SKILLS_DIR, name), target, { recursive: true });
      writeFileSync(
        path.join(target, MARKER),
        "Installed from claude-bridge/skills. Edit it there.\n",
      );
      installed.push(target);
    }
  }
  return { installed, skipped };
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const { installed, skipped } = installSkills(
    targets(process.argv.includes("--global")),
    { force: process.argv.includes("--force") },
  );
  for (const target of installed) {
    console.log(`installed ${target}`);
  }
  for (const target of skipped) {
    console.log(
      `kept ${target}: a skill of yours has this name (--force replaces it)`,
    );
  }
}
