@echo off
chcp 65001 > nul
echo [excel-db] 프론트엔드 빌드 중...

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [오류] Node.js가 설치되어 있지 않습니다. https://nodejs.org 에서 설치하세요.
    pause
    exit /b 1
)

cd frontend
call npm install
if %errorlevel% neq 0 (
    echo [오류] npm install 실패
    pause
    exit /b 1
)

call npm run build
if %errorlevel% neq 0 (
    echo [오류] 프론트엔드 빌드 실패
    pause
    exit /b 1
)
cd ..

echo [excel-db] PyInstaller 패키징 중...

call venv\Scripts\activate
if %errorlevel% neq 0 (
    echo [오류] 가상환경을 활성화할 수 없습니다. setup.bat을 먼저 실행하세요.
    pause
    exit /b 1
)

pyinstaller excel_db.spec --clean
if %errorlevel% neq 0 (
    echo [오류] PyInstaller 패키징 실패
    pause
    exit /b 1
)

echo.
echo [완료] dist\excel-db\ 폴더에 실행파일이 생성되었습니다.
echo 실행: dist\excel-db\excel-db.exe
pause
