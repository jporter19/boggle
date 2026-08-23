#!/usr/bin/env bash
# Deploy Word Paths static app to Lightsail hub (/var/www/words).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY_HOST="${DEPLOY_HOST:-54.175.0.107}"
DEPLOY_KEY="${DEPLOY_KEY:-$HOME/.ssh/lightsail-ai-hub.pem}"
DEPLOY_USER="${DEPLOY_USER:-ec2-user}"
REMOTE_DIR="${REMOTE_DIR:-/var/www/words}"

if [[ ! -f "$DEPLOY_KEY" ]]; then
  echo "Missing SSH key: $DEPLOY_KEY" >&2
  exit 1
fi

if [[ ! -f "$ROOT/public/data/rules.json" ]]; then
  echo "Missing rules.json (public/data/rules.json)" >&2
  exit 1
fi

if [[ ! -f "$ROOT/public/data/dictionary.json" ]]; then
  echo "Missing dictionary. Run: python3 scripts/build_dictionary.py" >&2
  exit 1
fi

if [[ ! -f "$ROOT/public/data/boards.json" ]]; then
  echo "Missing board bank. Run: python3 scripts/generate_boards.py" >&2
  exit 1
fi

if [[ ! -f "$ROOT/public/index.html" ]]; then
  echo "Missing public/index.html" >&2
  exit 1
fi

echo "→ Smoke tests"
python3 "$ROOT/scripts/smoke_test.py"

SSH=(ssh -i "$DEPLOY_KEY" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new)
RSYNC_SSH="ssh -i $DEPLOY_KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"

echo "→ Preparing remote dir ${REMOTE_DIR}"
"${SSH[@]}" "${DEPLOY_USER}@${DEPLOY_HOST}" \
  "sudo mkdir -p '${REMOTE_DIR}' && sudo chown -R ${DEPLOY_USER}:${DEPLOY_USER} '${REMOTE_DIR}'"

echo "→ Syncing public site → ${REMOTE_DIR}"
rsync -az --delete -e "$RSYNC_SSH" \
  "$ROOT/public/" \
  "${DEPLOY_USER}@${DEPLOY_HOST}:${REMOTE_DIR}/"

echo "→ Done. Files on ${DEPLOY_HOST}:${REMOTE_DIR}"
"${SSH[@]}" "${DEPLOY_USER}@${DEPLOY_HOST}" \
  "ls -la '${REMOTE_DIR}' && ls -la '${REMOTE_DIR}/js' '${REMOTE_DIR}/data'"

echo
echo "If nginx does not yet route /words/, apply portal nginx config:"
echo "  cd /home/john/code/porter-family-portal && ./scripts/apply_nginx.sh"
echo "Register/grant the app in portal-admin (seed id: word-paths), then open:"
echo "  https://porterfamily.us/words/"
