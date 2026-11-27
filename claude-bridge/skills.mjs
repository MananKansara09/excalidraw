/**
 * The default skills in `skills/<name>/SKILL.md`. The same files serve two
 * readers: the chat panels get them in their instructions (their agents are
 * locked to the canvas tools, so they can't open files), and coding tools get
 * copies of the folders, see install-skills.mjs.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SKILLS_DIR = fileURLToPath(new URL("./skills", import.meta.url));

export const skillNames = () =>
  readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

/** a SKILL.md without its frontmatter and pointers to files beside it */
const skillBody = (name) =>
  readFileSync(path.join(SKILLS_DIR, name, "SKILL.md"), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .replace(/^.*`references\/.*$\n?/gm, "")
    .trim();

export const skillsPrompt = () =>
  `Apply these built-in skills when they help. The element rules and tool limits above win over anything in them.

${skillNames().map(skillBody).join("\n\n")}`;
