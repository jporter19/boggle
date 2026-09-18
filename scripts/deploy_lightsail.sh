#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY_APP="${DEPLOY_APP:-/home/john/code/porter-family-portal/scripts/deploy_app.sh}"
exec "$DEPLOY_APP" --kind static --root "$ROOT" \
  --require public/data/rules.json \
  --require public/data/dictionary.json \
  --require public/data/boards.json \
  "$@"
