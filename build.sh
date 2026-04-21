#!/bin/bash
set -e

echo "[excel-db] 프론트엔드 빌드 중..."

if ! command -v node &> /dev/null; then
    echo "[오류] Node.js가 설치되어 있지 않습니다."
    exit 1
fi

cd frontend
npm install
npm run build
cd ..

echo "[excel-db] PyInstaller 패키징 중..."

source venv/bin/activate
pyinstaller excel_db.spec --clean

echo ""
echo "[완료] dist/excel-db/ 폴더에 실행파일이 생성되었습니다."
echo "실행: ./dist/excel-db/excel-db"
