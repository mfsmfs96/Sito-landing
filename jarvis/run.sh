#!/usr/bin/env bash
# Avvia JARVIS V0 in locale.
set -euo pipefail
cd "$(dirname "$0")"
[[ -d .venv ]] || { echo "Virtualenv assente. Esegui prima: ./scripts/setup.sh"; exit 1; }
# shellcheck disable=SC1091
source .venv/bin/activate
HOST="$(grep -E '^JARVIS_HOST=' .env 2>/dev/null | cut -d= -f2 || true)"; HOST="${HOST:-127.0.0.1}"
PORT="$(grep -E '^JARVIS_PORT=' .env 2>/dev/null | cut -d= -f2 || true)"; PORT="${PORT:-8080}"
echo "▶ JARVIS su http://${HOST}:${PORT}"
exec python -m uvicorn server.main:app --host "$HOST" --port "$PORT" "$@"
