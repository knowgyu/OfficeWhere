#!/bin/bash
set -e

echo "[officewhere] 개발 환경 설정 중..."

if ! command -v python3 &> /dev/null; then
    echo "[오류] Python3이 설치되어 있지 않습니다."
    exit 1
fi

if ! python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'; then
    PYVER=$(python3 -c 'import sys; print(".".join(map(str, sys.version_info[:3])))')
    echo "[오류] Python 3.10 이상이 필요합니다. 현재: $PYVER ($(which python3))"
    echo "       pyenv 사용 시 ~/.zshrc 에 다음을 추가하고 새 셸을 여세요:"
    echo "         export PYENV_ROOT=\"\$HOME/.pyenv\""
    echo "         eval \"\$(pyenv init -)\""
    echo "       그 후: pyenv install 3.11.9 && pyenv global 3.11.9"
    exit 1
fi

python3 -m venv venv
if [ ! -x "venv/bin/python" ]; then
    echo "[오류] 가상환경 Python을 찾을 수 없습니다: venv/bin/python"
    exit 1
fi

venv/bin/python -m pip install --upgrade pip
venv/bin/python -m pip install -r requirements-dev.txt

if ! command -v npm &> /dev/null; then
    echo "[오류] npm이 설치되어 있지 않습니다."
    exit 1
fi

cd frontend
npm ci
cd ..

echo ""
echo "[완료] 개발 환경 설정이 완료되었습니다."
echo "웹 테스트 실행: ./dev-web.sh"
echo "기본 주소: http://127.0.0.1:15173"
echo "포트 변경 예: BACKEND_PORT=18766 FRONTEND_PORT=15174 ./dev-web.sh"
echo "Electron 실행: cd frontend 후 npm run electron:dev"
