import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { systemPrompt } from "../canvas.mjs";
import { installSkills, targets } from "../install-skills.mjs";
import { SKILLS_DIR, skillNames, skillsPrompt } from "../skills.mjs";

const files = (dir) =>
  readdirSync(dir, { recursive: true })
    .map(String)
    .filter((file) => statSync(path.join(dir, file)).isFile())
    .sort();

const text = (file) => readFileSync(file, "utf8").replace(/\r\n/g, "\n");

test("every default skill is named after its folder and described", () => {
  assert.deepEqual(skillNames(), ["creativity", "designer", "excalidraw"]);
  for (const name of skillNames()) {
    const source = text(path.join(SKILLS_DIR, name, "SKILL.md"));
    assert.match(source, new RegExp(`^---\nname: ${name}\ndescription: .+`));
  }
});

test("the chat panels get the skills in their instructions", () => {
  const prompt = systemPrompt("Claude");
  for (const heading of ["# Designer", "# Excalidraw", "# Creativity"]) {
    assert.ok(prompt.includes(heading), heading);
  }
  assert.doesNotMatch(skillsPrompt(), /^description:|references\//m);
  // Codex takes its instructions on the command line (32767 chars on Windows)
  assert.ok(prompt.length < 14000, `instructions are ${prompt.length} chars`);
});

test("the repository's copies match the skills (yarn skills:sync)", () => {
  for (const dir of targets(false)) {
    for (const name of skillNames()) {
      const source = path.join(SKILLS_DIR, name);
      for (const file of files(source)) {
        const copy = path.join(dir, name, file);
        assert.ok(existsSync(copy), `${copy} is missing`);
        assert.equal(text(copy), text(path.join(source, file)), copy);
      }
    }
  }
});

test("installing updates its own copies and keeps the user's skills", (t) => {
  const home = mkdtempSync(path.join(os.tmpdir(), "skills-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const dirs = targets(true, home);
  const own = path.join(dirs[0], "designer");
  mkdirSync(own, { recursive: true });
  writeFileSync(path.join(own, "SKILL.md"), "mine");

  const first = installSkills(dirs);
  assert.deepEqual(first.skipped, [own]);
  assert.equal(text(path.join(own, "SKILL.md")), "mine");
  assert.equal(first.installed.length, dirs.length * skillNames().length - 1);

  assert.deepEqual(installSkills(dirs).skipped, [own]);
  assert.deepEqual(installSkills(dirs, { force: true }).skipped, []);
  assert.match(text(path.join(own, "SKILL.md")), /^---\nname: designer/);
});
