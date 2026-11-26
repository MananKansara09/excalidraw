# Deploying Excalidraw with the Plus server

This deploys the app together with `plus-server/` (cloud scenes, sharing, teams, comments, presentations, voice, AI, REST API and MCP). One container serves the app and the API on `127.0.0.1:3015`; the Caddy already running on your server proxies your domain to it and handles HTTPS.

HTTPS is required, not optional: browsers allow the microphone and screen sharing only on secure origins, and the session cookie is marked `Secure`.

## What you need

- A Linux server (Ubuntu 22.04+ or similar) with **2 GB RAM or more**. Building the image needs around 4 GB; on a smaller server add swap, or build elsewhere (see [Building on another machine](#building-on-another-machine)).
- **Docker** with the Compose plugin: `curl -fsSL https://get.docker.com | sh`
- **Caddy** already running on the server (installed natively, e.g. as the `caddy` systemd service).
- A **domain** (e.g. `draw.example.com`) with an `A` record (and `AAAA` if you use IPv6) pointing at the server.

## Deploy

1. Get the code on the server:

   ```bash
   git clone -b claude/determined-bell-drytjn https://github.com/MananKansara09/excalidraw.git
   cd excalidraw
   ```

2. Create the settings file and fill it in:

   ```bash
   cp .env.plus.example .env.plus
   ```

   ```bash
   openssl rand -base64 32
   ```

   Edit `.env.plus`: set `DOMAIN` to your domain (and `PLUS_PORT` if 3015 is taken on the server) and paste the random string into `PLUS_SECRET`. Optionally set `ANTHROPIC_API_KEY` so every user gets 100 AI requests a day; without it, users can still add their own key in Account settings. Keep `PLUS_SECRET` stable: changing it makes stored AI keys unreadable. Never commit `.env.plus` (it's gitignored).

3. Build and start:

   ```bash
   docker compose -f docker-compose.plus.yml --env-file .env.plus up -d --build
   ```

   The first build takes a few minutes. Check that it's up:

   ```bash
   docker compose -f docker-compose.plus.yml --env-file .env.plus ps
   ```

   `plus` should show `(healthy)` after about 30 seconds. It only listens on localhost:

   ```bash
   curl http://127.0.0.1:3015/api/health
   ```

4. Point Caddy at it. Add the site block from `Caddyfile.plus` to your Caddyfile (usually `/etc/caddy/Caddyfile`), replacing `draw.example.com` with your domain (and the port, if you changed `PLUS_PORT`). Keep the `flush_interval -1` line and the `encode` match list: they stop Caddy from buffering or compressing the event streams that live sync and voice use. Then check and reload:

   ```bash
   caddy validate --config /etc/caddy/Caddyfile
   ```

   ```bash
   sudo systemctl reload caddy
   ```

   Open `https://your-domain` in a browser.

## Test the deployment

### Automated check

From the server or your laptop (needs `curl` and Node.js):

```bash
plus-server/scripts/smoke-test.sh https://draw.example.com
```

It creates a throwaway account (`smoke-<timestamp>@example.invalid`) and scene, and checks TLS and routing, the web app, sign-up and the `Secure` cookie, saving, that event streams pass through the proxy unbuffered (live sync and voice depend on this), share links, the share URL domain, and MCP. Every line should say `ok`. Each failure message names the setting to fix.

### Manual check in the browser

Use two browsers, or one normal and one private window:

1. **Account**: click **Sign in → Create an account**. The Workspace opens.
2. **Cloud save**: click **New scene**, draw a rectangle. The top bar shows **Saved**. Reload the page: the drawing is still there.
3. **Folders**: in **Workspace**, create a folder and move the scene into it.
4. **Sharing**: click **Share → Create edit link**, open it in the second window. Draw in one window: the change appears in the other within a second, and each window shows the other person's avatar.
5. **Read-only link and embed**: **Share → Create read-only link**. The link opens view-only. Paste the embed code into an HTML file to test the iframe.
6. **Access management**: sign up a second account, then **Share → People**, add it by email as **Can view**; in that account the scene appears under **Shared with me** and can't be edited.
7. **Comments**: open the sidebar (top-right panel icon) → comments tab, select a shape, write a comment. A pin appears on the shape, and the other window sees the comment live.
8. **Presentation**: draw two frames (press `F`), sidebar → presentation tab → **Present**. Arrow keys change slides, `L` is the laser, `Esc` exits.
9. **Export**: **Export PDF / PPTX** in the same tab; open both files.
10. **Voice and screen**: click **Voice** in both windows (allow the microphone), talk, then click 🖥️ to share a screen.
11. **Teams**: Workspace → **+ New team**, invite an email. Signing up with that email joins the team automatically.
12. **AI**: Account → paste an Anthropic key (or rely on the server key), then use **Text to diagram** from the toolbar's extra tools.
13. **API / MCP**: Account → **Create API key**, then:

    ```bash
    curl -H "Authorization: Bearer exk_..." https://draw.example.com/api/v1/scenes?scope=all
    ```

    ```bash
    claude mcp add --transport http excalidraw https://draw.example.com/mcp --header "Authorization: Bearer exk_..."
    ```

## Operating it

View logs:

```bash
docker compose -f docker-compose.plus.yml --env-file .env.plus logs -f plus
```

Update to the latest code (data is kept in the `plus-data` volume):

```bash
git pull
```

```bash
docker compose -f docker-compose.plus.yml --env-file .env.plus up -d --build
```

Back up the database (safe while running):

```bash
docker compose -f docker-compose.plus.yml --env-file .env.plus exec plus node --no-warnings -e "new (require('node:sqlite').DatabaseSync)('/data/plus.sqlite').exec(\"VACUUM INTO '/data/backup.sqlite'\")"
```

```bash
docker compose -f docker-compose.plus.yml --env-file .env.plus cp plus:/data/backup.sqlite ./plus-backup-$(date +%F).sqlite
```

Copy the backup off the server, and keep `.env.plus` (with `PLUS_SECRET`) backed up too.

To restore a backup, stop the server, check that only `plus.sqlite` is left (a clean stop folds SQLite's write-ahead log into it), copy the backup over it, and start again:

```bash
docker compose -f docker-compose.plus.yml --env-file .env.plus stop plus
```

```bash
docker compose -f docker-compose.plus.yml --env-file .env.plus run --rm --no-deps --entrypoint ls plus -la /data
```

If that lists `plus.sqlite-wal`, the server didn't stop cleanly: run `start` and `stop` again before restoring, or SQLite would replay that log over the backup. Then:

```bash
docker compose -f docker-compose.plus.yml --env-file .env.plus run --rm --no-deps -v "$PWD/plus-backup-2026-01-01.sqlite:/restore.sqlite:ro" --entrypoint cp plus /restore.sqlite /data/plus.sqlite
```

```bash
docker compose -f docker-compose.plus.yml --env-file .env.plus start plus
```

Updates don't need a Caddy reload; the site block stays the same.

Roll back a bad update: `git checkout <previous commit>` and run the `up -d --build` command again.

## Building on another machine

On a machine with Docker and enough memory:

```bash
docker build -f Dockerfile.plus -t excalidraw-plus .
```

```bash
docker save excalidraw-plus | gzip | ssh user@your-server 'gunzip | docker load'
```

On the server, in `docker-compose.plus.yml`, replace the `build:` block of the `plus` service with `image: excalidraw-plus`, then run the `up -d` command without `--build`.

## Without Docker

Needs Node.js 22.18 or later and a reverse proxy with HTTPS.

```bash
yarn install --frozen-lockfile
```

```bash
yarn build:app:docker
```

Run `node plus-server/src/index.ts` as a service with the variables from `.env.plus.example` (set `PORT` instead of `PLUS_PORT`), plus `PLUS_PUBLIC_URL=https://your-domain`, `PLUS_SECURE_COOKIES=true` and `PLUS_DATA_DIR=/var/lib/excalidraw-plus`. It listens on port 3015 and serves `excalidraw-app/build` itself.

Use the same `Caddyfile.plus` site block. With nginx instead, proxy everything to it and turn buffering off, or live sync and voice stop working:

```nginx
location / {
    proxy_pass http://127.0.0.1:3015;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_read_timeout 1h;
    client_max_body_size 50m;
}
```

Run a single instance: realtime state (presence, voice signaling) lives in the server's memory.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Caddy logs certificate errors | DNS doesn't point at the server yet, or port 80 is blocked. Fix it and run `sudo systemctl reload caddy`. |
| `502 Bad Gateway` from Caddy | The container isn't running or uses another port: check `docker compose ... ps` and that the `reverse_proxy` port matches `PLUS_PORT`. |
| Top bar shows **Offline**, edits don't appear in other windows | Event streams are being buffered: the Caddy site block lacks `flush_interval -1` or compresses `text/event-stream`, or another proxy (e.g. Cloudflare) buffers them. The smoke test's event stream check confirms the fix. |
| Signed in, but reloading signs you out | The site isn't on HTTPS while `PLUS_SECURE_COOKIES=true`. Use the HTTPS URL. |
| Share links point at the wrong domain | `DOMAIN` in `.env.plus` doesn't match the URL you use. |
| **Voice** asks nothing / mic is blocked | The page isn't on HTTPS, or the browser blocked the microphone for the site. |
| Voice connects for some people but not others | Strict NATs or corporate networks need a TURN server. Set `VITE_APP_PLUS_ICE_SERVERS` in `.env.production` to a JSON list such as `[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:turn.example.com:3478","username":"u","credential":"p"}]` and rebuild. |
| AI says it isn't set up | No `ANTHROPIC_API_KEY` in `.env.plus` and the user hasn't added their own key. |
| `429 Too many failed sign-ins` | 10 failed sign-ins for one email from one IP within 15 minutes; wait, or restart the `plus` service to reset. |
| Build is killed | Not enough memory; add swap or build elsewhere. |

The original `Dockerfile` and `docker-compose.yml` still build the plain static app with nginx, without any of the Plus features.
