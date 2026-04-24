@echo off
setlocal EnableExtensions
chcp 65001 > nul
echo [office-data-joiner] 프론트엔드 빌드 중...

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [오류] Node.js가 설치되어 있지 않습니다.
    echo 소스에서 exe를 빌드하려면 Node.js LTS가 필요합니다.
    call :OfferWingetInstall "Node.js LTS" "OpenJS.NodeJS.LTS" "https://nodejs.org/"
    echo.
    echo Node.js 설치 후 새 CMD/PowerShell 창에서 build.bat을 다시 실행하세요.
    pause
    exit /b 1
)

where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo [오류] npm이 설치되어 있지 않습니다.
    echo Node.js LTS 설치 시 npm 옵션이 포함되어야 합니다.
    call :OfferWingetInstall "Node.js LTS" "OpenJS.NodeJS.LTS" "https://nodejs.org/"
    echo.
    echo Node.js 설치 후 새 CMD/PowerShell 창에서 build.bat을 다시 실행하세요.
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

echo [office-data-joiner] Electron main/preload 빌드 중...
call npm run build:electron
if %errorlevel% neq 0 (
    echo [오류] Electron 빌드 실패
    pause
    exit /b 1
)
cd ..

echo [office-data-joiner] Backend PyInstaller 패키징 중...

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

echo [office-data-joiner] Electron Windows zip 패키징 중...
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
echo legacy PyInstaller wrapper가 필요하면 수동으로 다음을 실행하세요:
echo venv\Scripts\python.exe -m PyInstaller office_data_joiner.spec --clean -y
pause
exit /b 0

:OfferWingetInstall
set "TOOL_NAME=%~1"
set "WINGET_ID=%~2"
set "DOWNLOAD_URL=%~3"
echo 공식 다운로드: %DOWNLOAD_URL%
where winget >nul 2>&1
if %errorlevel% neq 0 (
    echo winget을 찾을 수 없습니다. 위 공식 링크에서 직접 설치하세요.
    exit /b 1
)
set "INSTALL_ANSWER="
set /p "INSTALL_ANSWER=%TOOL_NAME%을(를) winget으로 설치할까요? [y/N] "
if /I not "%INSTALL_ANSWER%"=="Y" (
    echo 설치를 건너뜁니다.
    exit /b 1
)
winget install --id %WINGET_ID% -e --source winget
if %errorlevel% neq 0 (
    echo winget 설치에 실패했습니다. 위 공식 링크에서 직접 설치하세요.
    exit /b 1
)
echo 설치 요청이 완료되었습니다.
exit /b 0
