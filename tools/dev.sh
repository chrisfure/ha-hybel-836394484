#!/usr/bin/env bash
# Kjør appen lokalt mot en falsk Home Assistant.
#   Leietaker: http://localhost:8100   Utleier: http://localhost:8099
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .dev-data
[ -f .dev-data/options.json ] || echo '{"require_cloudflare_access": false, "log_level": "debug"}' > .dev-data/options.json
node tools/mock-ha.mjs &
MOCK=$!
trap 'kill $MOCK 2>/dev/null' EXIT
sleep 0.5
DATA_DIR=.dev-data HA_WS_URL=ws://127.0.0.1:8123/api/websocket HA_TOKEN=dev DEV_ADMIN_OPEN=1 node hybel/server/main.js
