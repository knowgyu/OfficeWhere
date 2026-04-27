#!/bin/bash
set -euo pipefail

echo "[officewhere] 프론트엔드/Electron 빌드 중..."

if ! command -v node >/dev/null 2>&1; then
    echo "[오류] Node.js가 설치되어 있지 않습니다."
    exit 1
fi

cd frontend
npm ci
npm run build
npm run build:electron
cd ..

echo ""
echo "[완료] 프론트엔드와 Electron main/preload 빌드가 완료되었습니다."
echo "Windows release zip은 bundled Python 런타임을 포함해 Windows에서 build.bat 또는 GitHub Actions로 생성하세요."
echo "macOS/Linux packaged releases will use the embedded-Python direction in a later pass."
