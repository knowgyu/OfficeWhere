@echo off
setlocal EnableExtensions
chcp 65001 > nul
echo [office-data-joiner] 개발 환경 설정 중...
echo.

set "PYTHON_CMD="
where py >nul 2>&1
if %errorlevel% neq 0 (
    where python >nul 2>&1
    if %errorlevel% neq 0 (
        echo [오류] Python이 설치되어 있지 않습니다.
        echo Python 3.10 이상을 https://python.org 에서 설치하세요.
        pause
        exit /b 1
    )
    set "PYTHON_CMD=python"
) else (
    set "PYTHON_CMD=py -3"
)

%PYTHON_CMD% -c "import sys; raise SystemExit(0 if sys.version_info >= (3,10) else 1)" >nul 2>&1
if %errorlevel% neq 0 (
    echo [오류] Python 3.10 이상이 필요합니다.
    %PYTHON_CMD% --version
    pause
    exit /b 1
)
for /f "usebackq tokens=*" %%v in (`%PYTHON_CMD% --version 2^>^&1`) do set "PYVER=%%v"
echo [확인] %PYVER% 감지됨.

%PYTHON_CMD% -m venv venv
if %errorlevel% neq 0 (
    echo [오류] 가상환경 생성에 실패했습니다.
    pause
    exit /b 1
)

call venv\Scripts\activate
python -m pip install --upgrade pip
python -m pip install -r requirements-dev.txt

if %errorlevel% neq 0 (
    echo [오류] 패키지 설치에 실패했습니다.
    pause
    exit /b 1
)

where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo [오류] npm이 설치되어 있지 않습니다.
    echo 프론트엔드 빌드와 build.bat 실행에는 Node.js LTS가 필요합니다.
    echo https://nodejs.org 에서 LTS 버전을 설치한 뒤 새 CMD 창에서 setup.bat을 다시 실행하세요.
    pause
    exit /b 1
)

cd frontend
call npm ci
if %errorlevel% neq 0 (
    echo [오류] 프론트엔드 의존성 설치에 실패했습니다.
    pause
    exit /b 1
)
cd ..

echo.
echo [완료] 개발 환경 설정이 완료되었습니다.
echo 개발 서버 실행: venv\Scripts\activate 후 python -m uvicorn backend.main:app --port 8765 --reload
pause
