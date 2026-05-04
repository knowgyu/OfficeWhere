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
if [[ "$(uname -s)" == "Darwin" ]]; then
    echo "[officewhere] macOS Electron 패키징 중..."
    npm run package:mac
else
    echo "[officewhere] 패키징은 Windows build.bat 또는 macOS GitHub Actions/release runner에서 수행하세요."
fi
cd ..

echo ""
echo "[완료] 프론트엔드와 Electron main/preload 빌드가 완료되었습니다."
echo "Windows release zip은 bundled Python 런타임을 포함해 Windows에서 build.bat 또는 GitHub Actions로 생성하세요."
echo "macOS release dmg/zip은 Apple Silicon macOS에서 private Python 런타임을 준비해 생성합니다."
