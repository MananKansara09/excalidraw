# Bridge for the Excalidraw assistant panels (Claude, Codex, Antigravity),
# multiuser mode: each signed-in user connects their own accounts. Only
# reachable from the Plus server on the compose network. See DEPLOY.md.

FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    CLAUDE_BRIDGE_MODE=multiuser \
    CLAUDE_BRIDGE_HOST=0.0.0.0 \
    CLAUDE_BRIDGE_PORT=3016 \
    CLAUDE_BRIDGE_DATA=/data \
    CLAUDE_BIN=/usr/local/bin/claude \
    AGY_BIN=/usr/local/bin/agy

# certificates for the Codex and Antigravity CLIs
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

# the Antigravity CLI, from Google's installer (it checks the download's
# checksum; it always installs the latest release)
RUN curl -fsSL https://antigravity.google/cli/install.sh \
  | bash -s -- --dir /usr/local/bin

# the Claude Code CLI: runs `claude auth login` and powers the Agent SDK
# (keep this version in step with the SDK in package.json)
RUN npm install -g @anthropic-ai/claude-code@2.1.332 --no-audit --no-fund

WORKDIR /app
COPY claude-bridge/package.json ./
RUN npm install --omit=dev --no-package-lock --no-audit --no-fund

COPY claude-bridge/*.mjs ./
COPY claude-bridge/skills ./skills

# per-user sign-ins live here: keep it on a volume (and private)
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3016

HEALTHCHECK --interval=30s --timeout=5s \
  CMD node -e "fetch('http://localhost:3016/claude-bridge/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
