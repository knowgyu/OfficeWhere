#!/bin/bash
set -e

echo "[office-data-joiner] 프론트엔드 빌드 중..."

if ! command -v node &> /dev/null; then
    echo "[오류] Node.js가 설치되어 있지 않습니다."
    exit 1
fi

cd frontend
npm ci
npm run build
npm run build:electron
cd ..

echo "[office-data-joiner] Backend PyInstaller 패키징 중..."

if [ ! -x "venv/bin/python" ]; then
    echo "[오류] 가상환경 Python을 찾을 수 없습니다. 먼저 ./setup.sh 를 실행하세요."
    exit 1
fi

venv/bin/python -m PyInstaller office_data_joiner_backend.spec --clean -y

echo ""
echo "[완료] dist/office-data-joiner-backend/ 폴더에 backend 실행파일이 생성되었습니다."
echo "Windows Electron zip은 Windows에서 build.bat 또는 GitHub Actions로 생성하세요."
