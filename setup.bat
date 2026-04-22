@echo off
chcp 65001 > nul
echo [office-data-joiner] 개발 환경 설정 중...

where python >nul 2>&1
if %errorlevel% neq 0 (
    echo [오류] Python이 설치되어 있지 않습니다. https://python.org 에서 설치하세요.
    pause
    exit /b 1
)

for /f "tokens=2 delims= " %%v in ('python --version 2^>^&1') do set PYVER=%%v
for /f "tokens=1,2 delims=." %%a in ("%PYVER%") do (
    set PYMAJOR=%%a
    set PYMINOR=%%b
)
if %PYMAJOR% LSS 3 (
    echo [오류] Python 3.10 이상이 필요합니다. 현재 버전: %PYVER%
    pause
    exit /b 1
)
if %PYMAJOR% EQU 3 if %PYMINOR% LSS 10 (
    echo [오류] Python 3.10 이상이 필요합니다. 현재 버전: %PYVER%
    pause
    exit /b 1
)
echo [확인] Python %PYVER% 감지됨.

python -m venv venv
if %errorlevel% neq 0 (
    echo [오류] 가상환경 생성에 실패했습니다.
    pause
    exit /b 1
)

call venv\Scripts\activate
pip install --upgrade pip
pip install -r requirements-dev.txt

if %errorlevel% neq 0 (
    echo [오류] 패키지 설치에 실패했습니다.
    pause
    exit /b 1
)

where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo [오류] npm이 설치되어 있지 않습니다. https://nodejs.org 에서 설치하세요.
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
