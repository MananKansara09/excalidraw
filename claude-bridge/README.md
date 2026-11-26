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
- Only `http://localhost:3000` may call it; set `CLAUDE_BRIDGE_ORIGINS` (comma-separated) if the app runs elsewhere, and `CLAUDE_BRIDGE_PORT` / `VITE_APP_CLAUDE_BRIDGE_URL` to change the port.
