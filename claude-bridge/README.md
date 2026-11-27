# Claude bridge

Powers the **Claude** chat panel in the Excalidraw app. It runs the [Claude Agent SDK](https://docs.claude.com/en/docs/claude-code/sdk), which drives your local Claude Code install, so requests use **your own Claude subscription login**. Nothing is shared between users: each person runs the bridge on their own machine.

```bash
claude login                 # once, if you aren't signed in yet
yarn install:claude-bridge   # from the repo root
yarn start:claude-bridge     # listens on 127.0.0.1:3016
yarn start                   # the app; /claude-bridge is proxied by Vite
```

- Claude gets **no** file/shell tools. Its only tools draw on the canvas (`add_elements`, `update_elements`, `delete_elements`, `clear_canvas`); the browser applies them.
- `ANTHROPIC_API_KEY` is ignored so the subscription is used (set `CLAUDE_BRIDGE_ALLOW_API_KEY=1` to opt out).
- Only `http://localhost:3000` and `http://localhost:3001` (the port in `.env.development`) may call it; set `CLAUDE_BRIDGE_ORIGINS` (comma-separated) if the app runs elsewhere, and `CLAUDE_BRIDGE_PORT` / `VITE_APP_CLAUDE_BRIDGE_URL` to change the port.

## Several users on one bridge

Multiuser mode (`CLAUDE_BRIDGE_MODE=multiuser`, the Docker deployment) serves all three assistants. Each signed-in user gets:

- their own sign-ins, chats and temp files under `CLAUDE_BRIDGE_DATA/users/<hash>/`, and CLI environments without the server's secrets;
- one chat at a time per assistant (`CLAUDE_BRIDGE_MAX_CONCURRENT`, default 8, caps all users and assistants together).

All users run as the same operating-system user, so the separation rests on no agent being able to read someone else's files:

| Agent | Own sign-in | What stops file reading |
| --- | --- | --- |
| Claude | `CLAUDE_CONFIG_DIR` | no built-in tools; `CLAUDE_CODE_DISABLE_ATTACHMENTS=1` (otherwise `@/path` in a message or on the canvas sends that file); only conversation ids can be resumed |
| Codex | `CODEX_HOME`, credentials kept in a file | shell, image viewing and other tools switched off; a model list without `apply_patch`, which reads files even in the read-only sandbox |
| Antigravity | its own `HOME`, token kept in a file | the guard hook, plus `read_file` deny rules on other users' folders and `/proc` in case the hook fails |

Keep all of these, and run `yarn test` after updating any CLI or SDK: `test/isolation.node-test.mjs` and `test/agents.node-test.mjs` check this against the real CLIs (the Antigravity ones are skipped where `agy` isn't installed).

Local mode has no authentication and only listens on this machine.

## Models

- `GET /models` returns the models the signed-in account offers (the list Claude Code's `/model` picker shows); the panel sends the chosen one as `model` with each `POST /chat`. Asking for the list sends no prompt. It is cached for 10 minutes and dropped on sign-in or sign-out.

## Default skills

`skills/` holds the skills every assistant starts with: `designer`, `excalidraw` and `creativity` (one `SKILL.md` each).

- **Chat panels** (Claude, Antigravity, Codex): the bridge adds the skills to their instructions. Restart the bridge after editing one.
- **Coding tools in this repository**: copies in `.claude/skills` (Claude Code) and `.agents/skills` (Codex, Antigravity) are committed, so they work on clone. After editing a skill, run `yarn skills:sync`; `yarn test` in `claude-bridge` fails if the copies are stale.
- **Coding tools everywhere**: `yarn skills:install` copies them to `~/.claude/skills`, `~/.agents/skills` and `~/.gemini/config/skills`. A skill of your own with the same name is kept unless you pass `--force`.

## Attachments and logs

- `POST /chat` accepts `attachments: [{ name, mediaType, data }]` (base64): up to 5 files, **5 MB each**. PDFs and images go to Claude as document/image blocks; text files (txt, md, csv, json, code…) are inlined. Word/Excel files must be exported to PDF/CSV first. Claude still gets no file or shell tools.
- The event stream also carries `tool_use` (full input), `tool_result`, and `done` stats, which the panel's **Logs** tab shows. `yarn test` runs the helper tests.

## Antigravity

The same bridge powers the **Antigravity** chat, picked from the plate at the bottom of the canvas. It runs your own [Antigravity CLI](https://antigravity.google/docs/cli/headless/) (`agy`) in headless stream-json mode, so requests use **your Antigravity sign-in**. The Python Antigravity SDK is not used: it only accepts a Gemini API key or Vertex AI.

- **Run** (from the repo root): `yarn start:antigravity-bridge`, or `yarn dev:antigravity-bridge` to restart on file changes. These are the Claude bridge's commands under another name: one process on port 3016 serves both chats, so run only one of them.
- **Sign-in / sign-out**: the panel opens a terminal running `agy` on the bridge's machine. Sign in there, or type `/logout`.
- **Canvas edits**: the bridge serves the canvas tools to `agy` as an MCP server. Each turn has a new secret address.
- **Lockdown**: `agy` runs in `~/.excalidraw-antigravity`, where a `PreToolUse` hook (`antigravity-guard.mjs`) refuses every tool except the canvas ones and reading uploaded files. Permission rules also deny commands, file writes and URL access, and a turn is stopped if a refused tool ever runs.
- **Attachments**: text files are inlined; images and PDFs are saved to the work folder for the turn, then deleted.
- `agy` takes no system prompt (it opens each new conversation) and streams no thinking text.
- **Shared server**: each user signs in by pasting a Google code into the panel; see [Several users on one bridge](#several-users-on-one-bridge).
- Settings: `AGY_BIN`, `ANTIGRAVITY_WORK_DIR`. Routes are under `/claude-bridge/antigravity/`.

## Codex

The same bridge powers the **Codex** chat. Turns run through the [Codex SDK](https://www.npmjs.com/package/@openai/codex-sdk); sign-in and the model list come from `codex app-server`, the CLI that ships with the SDK, so requests use **your own ChatGPT plan**.

- **Install and run** (from the repo root): `yarn install:codex-bridge`, then `yarn start:codex-bridge`, or `yarn dev:codex-bridge` to restart on file changes. One process on port 3016 serves all three chats: run only one of these commands.
- **Sign-in / sign-out**: **Sign in with ChatGPT** in the panel opens the approval page; the panel updates once you approve. The browser must be on the bridge's machine.
- **Separate from your Codex CLI**: the panel keeps its sign-in, settings and sessions in `~/.excalidraw-codex`, so your Codex MCP servers, plugins and hooks never load. Sign in once in the panel.
- **Canvas edits**: the bridge serves the canvas tools to Codex as an MCP server. Each turn has a new secret address.
- **Lockdown**: commands, file viewing, browsing, plugins, apps and sub-agents are switched off, the sandbox is read-only, nothing can be approved, and a turn is stopped if a command, file change or web search shows up.
- **Replies** arrive one finished paragraph at a time: the SDK doesn't stream partial text.
- **Attachments**: text files and the text of PDFs are inlined (scanned PDFs can't be read); images are attached, then deleted.
- `OPENAI_API_KEY` and `CODEX_API_KEY` are ignored (set `CODEX_BRIDGE_ALLOW_API_KEY=1` to keep them).
- **Shared server**: each user signs in with a one-time code, in their own Codex home; see [Several users on one bridge](#several-users-on-one-bridge).
- Settings: `CODEX_BIN`, `CODEX_BRIDGE_DATA`, `CODEX_BRIDGE_HOME`. Routes are under `/claude-bridge/codex/`.
