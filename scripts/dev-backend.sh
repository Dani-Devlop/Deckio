#!/usr/bin/env bash
# Deckio — local development helper: boots the FastAPI backend on port 8001
# with auto-reload. Creates the virtualenv on first run.
#
# Usage:  ./scripts/dev-backend.sh
set -euo pipefail
cd "$(dirname "$0")/../backend"

if [ ! -d .venv ]; then
  echo ">>> creating virtualenv (backend/.venv)"
  python3 -m venv .venv
fi

if [ ! -x .venv/bin/uvicorn ]; then
  echo ">>> installing dependencies"
  .venv/bin/pip install -r requirements.txt
fi

echo ">>> starting Deckio API on http://0.0.0.0:8001 (docs at /docs)"
exec .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload
