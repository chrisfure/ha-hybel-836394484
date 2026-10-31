#!/usr/bin/env bash
# Kjør Gjestesiden lokalt mot en falsk Home Assistant.
#   Gjestesiden: http://localhost:8200   Oppsett: http://localhost:8099
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .dev-data-gjest
[ -f .dev-data-gjest/options.json ] || echo '{"log_level": "debug"}' > .dev-data-gjest/options.json
MOCK_SET=gjest node tools/mock-ha.mjs &
MOCK=$!
trap 'kill $MOCK 2>/dev/null' EXIT
sleep 0.5
DATA_DIR=.dev-data-gjest HA_WS_URL=ws://127.0.0.1:8123/api/websocket HA_TOKEN=dev DEV_ADMIN_OPEN=1 node gjest/server/main.js
