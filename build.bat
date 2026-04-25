@echo off
setlocal EnableExtensions
chcp 65001 > nul
echo [officewhere] 프론트엔드 빌드 중...

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [오류] Node.js가 설치되어 있지 않습니다.
    echo https://nodejs.org/ 에서 LTS 버전을 설치한 뒤 새 CMD/PowerShell 창에서 다시 실행하세요.
    pause
    exit /b 1
)

where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo [오류] npm이 설치되어 있지 않습니다.
    echo https://nodejs.org/ 에서 Node.js LTS를 다시 설치하세요.
    pause
    exit /b 1
)

cd frontend
call npm ci
if %errorlevel% neq 0 (
    echo [오류] npm ci 실패
    pause
    exit /b 1
)

call npm run build
if %errorlevel% neq 0 (
    echo [오류] 프론트엔드 빌드 실패
    pause
    exit /b 1
)

echo [officewhere] Electron main/preload 빌드 중...
call npm run build:electron
if %errorlevel% neq 0 (
    echo [오류] Electron 빌드 실패
    pause
    exit /b 1
)
cd ..

echo [officewhere] Backend PyInstaller 패키징 중...

if not exist "venv\Scripts\python.exe" (
    echo [오류] 가상환경 Python을 찾을 수 없습니다. setup.bat을 먼저 실행하세요.
    pause
    exit /b 1
)

venv\Scripts\python.exe -m PyInstaller office_data_joiner_backend.spec --clean -y
if %errorlevel% neq 0 (
    echo [오류] Backend PyInstaller 패키징 실패
    pause
    exit /b 1
)

echo [officewhere] Electron Windows zip 패키징 중...
cd frontend
call npm run package:win
if %errorlevel% neq 0 (
    echo [오류] Electron 패키징 실패
    pause
    exit /b 1
)
cd ..

echo.
echo [완료] dist\electron\ 폴더에 Windows zip 산출물이 생성되었습니다.
pause
exit /b 0
