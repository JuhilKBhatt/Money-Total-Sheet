#!/usr/bin/env bash
set -euo pipefail

# Resolve portable USB / project root relative to this .command script
APP_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$APP_ROOT"

mkdir -p "$APP_ROOT/secrets" "$APP_ROOT/data"

echo "=========================================================="
echo "  Accounts Dues Manager - Portable Encrypted USB Terminal"
echo "  Root: $APP_ROOT"
echo "=========================================================="

cleanup() {
  echo ""
  echo "[USB Safe Shutdown] Encrypted SQLite WAL flushed and closed."
}
trap cleanup EXIT INT TERM

# Locate Node.js executable (bundled portable node, system node, or homebrew/local)
if [ -f "$APP_ROOT/bin/mac/node" ]; then
  NODE_BIN="$APP_ROOT/bin/mac/node"
elif command -v node >/dev/null 2>&1; then
  NODE_BIN="node"
elif [ -f "/usr/local/bin/node" ]; then
  NODE_BIN="/usr/local/bin/node"
elif [ -f "/opt/homebrew/bin/node" ]; then
  NODE_BIN="/opt/homebrew/bin/node"
else
  echo ""
  echo "[Error] Node.js is required to launch Accounts Dues Manager."
  echo "Please install Node.js (v22+) from https://nodejs.org or place a node binary into bin/mac/node on this drive."
  echo ""
  read -n 1 -s -r -p "Press any key to exit..."
  echo ""
  exit 1
fi

export NODE_OPTIONS="--no-warnings"
export PORT="3003"
export ADM_ROOT_DIR="$APP_ROOT"

# Automatically open the default browser to the app
(sleep 1 && open "http://localhost:3003" 2>/dev/null || true) &

if [ -d "$APP_ROOT/frontend/node_modules/next" ]; then
  echo "[Mode] Launching Next.js Frontend + Encrypted SQLite Service..."
  npm --prefix "$APP_ROOT/frontend" run dev
else
  echo "[Mode] Launching Standalone Portable Server w/ Embedded UI & Encrypted SQLite..."
  exec "$NODE_BIN" --no-warnings "$APP_ROOT/backend/src/server.ts"
fi

