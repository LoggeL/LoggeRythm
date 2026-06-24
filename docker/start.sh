#!/usr/bin/env sh
set -eu

mkdir -p "${STORAGE_DIR:-/data/storage}"

cd /app/api
uvicorn app.main:app --host 127.0.0.1 --port "${API_PORT:-8000}" &
api_pid=$!

cd /app/web
npm run start -- --hostname 0.0.0.0 --port "${PORT:-3000}" &
web_pid=$!

term() {
  kill "$api_pid" "$web_pid" 2>/dev/null || true
  wait "$api_pid" "$web_pid" 2>/dev/null || true
}
trap term INT TERM

while :; do
  if ! kill -0 "$api_pid" 2>/dev/null; then
    echo "API process exited" >&2
    term
    exit 1
  fi
  if ! kill -0 "$web_pid" 2>/dev/null; then
    echo "Web process exited" >&2
    term
    exit 1
  fi
  sleep 2
done
