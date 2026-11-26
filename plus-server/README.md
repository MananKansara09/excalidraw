# Excalidraw Plus server

A self-hosted backend for the Plus features of the Excalidraw app in this repository:

- **Unlimited scenes and nested folders**, saved in the cloud (SQLite)
- **Accounts** (email + password), with sessions in an HttpOnly cookie
- **Access management**: share a scene with people as editor or viewer
- **Share links**: read-only links, edit links and iframe embeds
- **Teams**: owners, admins and members; invites by email (people without an account join when they sign up)
- **Live collaboration** on cloud scenes, with presence
- **Comments**: threads pinned to elements or canvas spots, replies, resolve
- **Voice hangouts and screen sharing** (WebRTC, signaled by this server)
- **Presentations**: per-scene slide order (export to PDF/PPTX runs in the app)
- **AI**: text-to-diagram and wireframe-to-code, 100 requests a day per user on the server's key, or unlimited with a user's own Anthropic API key
- **REST API** and **MCP server** authenticated with per-user API keys

It needs Node.js 22.18 or later (built-in SQLite and TypeScript type stripping) and has one dependency, `@anthropic-ai/sdk`.

## Running it

In development, run the server next to the app's Vite dev server, which proxies `/api` and `/mcp` to it so the app reaches it same-origin:

```bash
yarn start:plus-server
```

```bash
yarn start
```

In production, build the app (`yarn build:app`) and start the server: it serves `excalidraw-app/build` itself when that folder exists, so one process hosts both. Put it behind HTTPS and set `PLUS_SECURE_COOKIES=true`.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3015` | HTTP port |
| `PLUS_DATA_DIR` | `plus-server/data` | Where the SQLite database (and a generated secret) live |
| `PLUS_SECRET` | generated into the data dir | Encrypts users' own AI keys at rest. Set it explicitly in production |
| `PLUS_PUBLIC_URL` | none | Public origin of the app, used in share links returned by the API and MCP |
| `PLUS_STATIC_DIR` | `excalidraw-app/build` if built | Built web app to serve |
| `PLUS_SECURE_COOKIES` | `false` | Adds `Secure` to the session cookie (needs HTTPS) |
| `ANTHROPIC_API_KEY` | none | Server key for AI features. Without it, only users who add their own key can use AI |
| `PLUS_AI_DAILY_LIMIT` | `100` | AI requests per signed-in user per UTC day on the server key |
| `PLUS_AI_ANON_DAILY_LIMIT` | `10` | AI requests per IP per day for signed-out visitors |
| `PLUS_AI_EFFORT` | `medium` | Effort level for `claude-opus-5-5` (`low`, `medium`, `high`) |

The app reads `VITE_APP_PLUS_SERVER_URL` (dev proxy target) and `VITE_APP_PLUS_ICE_SERVERS` (a JSON array of `RTCIceServer`; defaults to a public STUN server, add a TURN server for users behind strict NATs).

## REST API

All endpoints live under `/api/v1` and accept either the web session cookie or an API key created in **Account settings**:

```bash
curl -H "Authorization: Bearer exk_..." https://your-host/api/v1/scenes?scope=all
```

`GET /api/v1` lists every endpoint. The main ones:

- `GET|POST /scenes`, `GET|PUT|PATCH|DELETE /scenes/:id`, `POST /scenes/:id/sync`
- `POST /scenes/:id/elements` adds shapes from compact descriptions, e.g. `{"elements": [{"id": "a", "type": "rectangle", "x": 0, "y": 0, "label": "API"}, {"type": "arrow", "start": "a", "end": "b"}]}`
- `GET /scenes/:id/summary` returns a readable digest of a scene
- `GET|POST /folders`, `GET|POST /teams`, `GET|POST /scenes/:id/comments`
- `GET|POST /scenes/:id/access`, `POST /scenes/:id/links`

`PUT /scenes/:id` replaces the scene's elements; `POST /scenes/:id/sync` merges them by element version, the way the editor does while collaborating.

## MCP server

`POST /mcp` speaks the Model Context Protocol over Streamable HTTP. Connect a client with an API key, e.g. Claude Code:

```bash
claude mcp add --transport http excalidraw https://your-host/mcp --header "Authorization: Bearer exk_..."
```

Tools: `list_teams`, `list_folders`, `list_scenes`, `get_scene`, `create_scene`, `add_elements`, `update_elements`, `delete_elements`, `list_comments`, `add_comment`, `create_share_link`.

## Tests

```bash
yarn test:plus-server
```

The tests start the server on a random port with an in-memory database and a fake AI provider, so they need no network or API key.

## Notes and limits

- Live collaboration on cloud scenes goes through this server (Server-Sent Events), unlike the app's end-to-end encrypted live rooms, which use the separate excalidraw-room service. Cloud scenes are stored unencrypted on your server.
- Hangouts are a peer-to-peer mesh: fine for small groups; larger calls need an SFU.
- The server keeps realtime state in memory, so run a single instance.
