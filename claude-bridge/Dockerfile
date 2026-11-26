# Claude bridge for the Excalidraw Claude panel, multiuser mode: each signed-in
# user connects their own Claude account. Only reachable from the Plus server
# on the compose network. See DEPLOY.md.

FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    CLAUDE_BRIDGE_MODE=multiuser \
    CLAUDE_BRIDGE_HOST=0.0.0.0 \
    CLAUDE_BRIDGE_PORT=3016 \
    CLAUDE_BRIDGE_DATA=/data \
    CLAUDE_BIN=/usr/local/bin/claude

# the Claude Code CLI: runs `claude auth login` and powers the Agent SDK
# (keep this version in step with the SDK in package.json)
RUN npm install -g @anthropic-ai/claude-code@2.1.332 --no-audit --no-fund

WORKDIR /app
COPY claude-bridge/package.json ./
RUN npm install --omit=dev --no-package-lock --no-audit --no-fund

COPY claude-bridge/server.mjs claude-bridge/chat.mjs ./

# per-user Claude logins live here: keep it on a volume (and private)
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3016

HEALTHCHECK --interval=30s --timeout=5s \
  CMD node -e "fetch('http://localhost:3016/claude-bridge/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
