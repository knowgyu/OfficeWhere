#!/bin/bash
set -e

echo "[office-data-joiner] 개발 환경 설정 중..."

if ! command -v python3 &> /dev/null; then
    echo "[오류] Python3이 설치되어 있지 않습니다."
    exit 1
fi

python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements-dev.txt

if ! command -v npm &> /dev/null; then
    echo "[오류] npm이 설치되어 있지 않습니다."
    exit 1
fi

cd frontend
npm ci
cd ..

echo ""
echo "[완료] 개발 환경 설정이 완료되었습니다."
echo "개발 서버 실행: source venv/bin/activate 후 python -m uvicorn backend.main:app --port 8765 --reload"
