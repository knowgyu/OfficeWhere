@echo off
chcp 65001 > nul
echo [office-data-joiner] 프론트엔드 빌드 중...

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [오류] Node.js가 설치되어 있지 않습니다.
    echo 소스에서 exe를 빌드하려면 Node.js LTS가 필요합니다.
    echo https://nodejs.org 에서 LTS 버전을 설치한 뒤 새 CMD 창에서 build.bat을 다시 실행하세요.
    pause
    exit /b 1
)

where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo [오류] npm이 설치되어 있지 않습니다.
    echo Node.js LTS 설치 시 npm 옵션이 포함되어야 합니다.
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
cd ..

echo [office-data-joiner] PyInstaller 패키징 중...

call venv\Scripts\activate
if %errorlevel% neq 0 (
    echo [오류] 가상환경을 활성화할 수 없습니다. setup.bat을 먼저 실행하세요.
    pause
    exit /b 1
)

python -m PyInstaller office_data_joiner.spec --clean -y
if %errorlevel% neq 0 (
    echo [오류] PyInstaller 패키징 실패
    pause
    exit /b 1
)

echo.
echo [완료] dist\office-data-joiner\ 폴더에 실행파일이 생성되었습니다.
echo 실행: dist\office-data-joiner\office-data-joiner.exe
pause
