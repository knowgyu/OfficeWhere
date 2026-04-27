#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST="${HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-18765}"
FRONTEND_PORT="${FRONTEND_PORT:-15173}"

if [[ -x "$ROOT_DIR/venv/bin/python" ]]; then
  PYTHON_BIN="$ROOT_DIR/venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
  PYTHON_BIN="python3"
elif command -v python >/dev/null 2>&1; then
  PYTHON_BIN="python"
else
  echo "[오류] Python을 찾을 수 없습니다. 먼저 ./setup.sh 를 실행하세요." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "[오류] npm을 찾을 수 없습니다. Node.js LTS 설치 후 ./setup.sh 를 실행하세요." >&2
  exit 1
fi

cleanup() {
  if [[ -n "${BACKEND_PID:-}" ]] && kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
    echo ""
    echo "[officewhere] backend 종료 중..."
    kill "$BACKEND_PID" >/dev/null 2>&1 || true
    wait "$BACKEND_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

echo "[officewhere] backend 시작: http://${HOST}:${BACKEND_PORT}"
"$PYTHON_BIN" "$ROOT_DIR/backend_server.py" --host "$HOST" --port "$BACKEND_PORT" &
BACKEND_PID=$!

"$PYTHON_BIN" - <<PY
import sys, time, urllib.request
url = "http://${HOST}:${BACKEND_PORT}/api/health"
for _ in range(80):
    try:
        urllib.request.urlopen(url, timeout=0.5).read()
        sys.exit(0)
    except Exception:
        time.sleep(0.25)
print(f"[오류] backend health check 실패: {url}", file=sys.stderr)
sys.exit(1)
PY

echo "[officewhere] frontend 시작: http://${HOST}:${FRONTEND_PORT}"
echo "[officewhere] 종료하려면 Ctrl+C 를 누르세요."
cd "$ROOT_DIR/frontend"
BACKEND_PORT="$BACKEND_PORT" \
FRONTEND_PORT="$FRONTEND_PORT" \
VITE_BACKEND_URL="http://${HOST}:${BACKEND_PORT}" \
npm run dev -- --host "$HOST" --port "$FRONTEND_PORT" --strictPort
