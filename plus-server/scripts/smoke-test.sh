#!/usr/bin/env bash
# Post-deploy smoke test for the Excalidraw Plus server.
#
#   plus-server/scripts/smoke-test.sh https://draw.example.com
#
# Creates a throwaway account ("smoke-<timestamp>@example.invalid") and a
# scene, and checks every layer a deployment can break: TLS, routing, the
# session cookie, saving, event streams through the proxy, share links, MCP.
# Set CURL_OPTS=-k to accept a self-signed certificate.

set -euo pipefail

BASE="${1:?usage: smoke-test.sh https://your-domain}"
BASE="${BASE%/}"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT
CURL=(curl -sS ${CURL_OPTS:-} -b "$JAR" -c "$JAR")
FAILED=0

pass() { printf '  \033[32mok\033[0m   %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAILED=1; }
# prints a field of the JSON on stdin, or nothing if it isn't there
json() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const v=JSON.parse(d)$1;console.log(v??'')}catch{console.log('')}})"; }

echo "Smoke-testing $BASE"

# 1. server up and routed
if [ "$("${CURL[@]}" "$BASE/api/health")" = '{"ok":true}' ]; then
  pass "API health"
else
  fail "API health (is the server running and proxied at /api?)"
fi

# 2. web app served
if "${CURL[@]}" "$BASE/" | grep -qi "<html"; then
  pass "web app served"
else
  fail "web app (index.html) not served"
fi

# 3. sign up; the session cookie must be Secure on HTTPS
EMAIL="smoke-$(date +%s)@example.invalid"
HEADERS="$(mktemp)"
"${CURL[@]}" -D "$HEADERS" -o /dev/null -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"smoke-test-password\"}" \
  "$BASE/api/v1/auth/signup"
if grep -qi '^set-cookie: eplus_session=' "$HEADERS"; then
  pass "sign up ($EMAIL)"
else
  fail "sign up"
fi
if [[ "$BASE" == https://* ]]; then
  if grep -i '^set-cookie: eplus_session=' "$HEADERS" | grep -qi 'secure'; then
    pass "session cookie is Secure"
  else
    fail "session cookie lacks Secure (set PLUS_SECURE_COOKIES=true)"
  fi
fi
rm -f "$HEADERS"

# 4. create and save a scene
SCENE="$("${CURL[@]}" -H 'Content-Type: application/json' -d '{"name":"Smoke test"}' \
  "$BASE/api/v1/scenes" | json '.scene.id')"
[ -n "$SCENE" ] && pass "create scene" || fail "create scene"
VERSION="$("${CURL[@]}" -H 'Content-Type: application/json' \
  -d '{"elements":[{"id":"smoke","type":"rectangle","x":0,"y":0,"width":10,"height":10,"version":1,"versionNonce":1}]}' \
  "$BASE/api/v1/scenes/$SCENE/sync" | json '.version')"
[ "${VERSION:-0}" -ge 2 ] && pass "save scene (version $VERSION)" || fail "save scene"

# 5. event stream arrives promptly through the proxy (live sync, presence,
#    comments and voice signaling all depend on it)
EVENTS="$(timeout 5 "${CURL[@]}" -N "$BASE/api/v1/scenes/$SCENE/events" 2>/dev/null | head -c 200 || true)"
if grep -q "event: hello" <<<"$EVENTS"; then
  pass "event stream (not buffered by the proxy)"
else
  fail "event stream: nothing within 5s; disable proxy buffering/compression for text/event-stream"
fi

# 6. share links work signed out
TOKEN="$("${CURL[@]}" -H 'Content-Type: application/json' -d '{"role":"viewer"}' \
  "$BASE/api/v1/scenes/$SCENE/links" | json '.links[0].token')"
ROLE="$(curl -sS ${CURL_OPTS:-} -H "X-Share-Token: $TOKEN" "$BASE/api/v1/scenes/$SCENE" | json '.scene.role')"
[ "$ROLE" = "viewer" ] && pass "read-only share link" || fail "read-only share link"
LINK_URL="$("${CURL[@]}" "$BASE/api/v1/scenes/$SCENE/access" | json '.links[0].url')"
if [ "$LINK_URL" = "$BASE/#share=$TOKEN" ]; then
  pass "share URLs use $BASE"
else
  fail "share URL is '$LINK_URL' (set PLUS_PUBLIC_URL=$BASE)"
fi

# 7. MCP with an API key
KEY="$("${CURL[@]}" -H 'Content-Type: application/json' -d '{"name":"smoke"}' \
  "$BASE/api/v1/me/api-keys" | json '.key')"
TOOLS="$(curl -sS ${CURL_OPTS:-} -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' "$BASE/mcp" | json '.result.tools.length')"
[ "${TOOLS:-0}" -gt 0 ] && pass "MCP ($TOOLS tools)" || fail "MCP endpoint"

# 8. AI status (informational)
AI="$("${CURL[@]}" "$BASE/api/v1/ai/usage" | json '.configured')"
if [ "$AI" = "true" ]; then
  pass "AI configured (server key)"
else
  echo "  info AI has no server key: users must add their own in Account settings"
fi

# clean up the test scene
"${CURL[@]}" -o /dev/null -X DELETE "$BASE/api/v1/scenes/$SCENE"

echo
if [ "$FAILED" = 0 ]; then
  echo "All checks passed."
else
  echo "Some checks failed."
  exit 1
fi
