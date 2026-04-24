#!/bin/bash
set -e

echo "[office-data-joiner] 개발 환경 설정 중..."

if ! command -v python3 &> /dev/null; then
    echo "[오류] Python3이 설치되어 있지 않습니다."
    exit 1
fi

python3 -m venv venv
if [ ! -x "venv/bin/python" ]; then
    echo "[오류] 가상환경 Python을 찾을 수 없습니다: venv/bin/python"
    exit 1
fi

venv/bin/python -m pip install --upgrade pip
venv/bin/python -m pip install -r requirements-dev.txt

if ! command -v npm &> /dev/null; then
    echo "[오류] npm이 설치되어 있지 않습니다."
    exit 1
fi

cd frontend
npm ci
cd ..

echo ""
echo "[완료] 개발 환경 설정이 완료되었습니다."
echo "Backend 실행: source venv/bin/activate 후 python backend_server.py --host 127.0.0.1 --port 8765"
echo "Frontend 실행: cd frontend 후 npm run dev"
echo "Electron 실행: cd frontend 후 npm run electron:dev"
