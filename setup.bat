@echo off
chcp 65001 > nul
echo [excel-db] 개발 환경 설정 중...

where python >nul 2>&1
if %errorlevel% neq 0 (
    echo [오류] Python이 설치되어 있지 않습니다. https://python.org 에서 설치하세요.
    pause
    exit /b 1
)

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

echo.
echo [완료] 개발 환경 설정이 완료되었습니다.
echo 개발 서버 실행: venv\Scripts\activate 후 python -m uvicorn backend.main:app --port 8765 --reload
pause
