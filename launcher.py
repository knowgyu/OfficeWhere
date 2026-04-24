"""
office-data-joiner launcher
.exe 진입점: uvicorn 서버를 별도 스레드에서 시작하고 브라우저를 자동으로 엽니다.
"""
import asyncio
import multiprocessing
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser

PORT = 8765
HOST = "127.0.0.1"
URL = f"http://{HOST}:{PORT}"


def is_port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(1)
        try:
            s.connect((HOST, port))
            return True
        except (ConnectionRefusedError, OSError):
            return False


def is_office_data_joiner_running() -> bool:
    try:
        with urllib.request.urlopen(f"{URL}/api/files", timeout=1.5) as response:
            return response.status == 200
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def run_server():
    """uvicorn 서버 실행 (별도 스레드용)"""
    import uvicorn
    # PyInstaller frozen 모드에서는 문자열 import가 불가능하므로 앱 객체를 직접 전달
    if getattr(sys, "frozen", False):
        from backend.main import app
        uvicorn.run(app, host=HOST, port=PORT, log_level="warning")
    else:
        uvicorn.run("backend.main:app", host=HOST, port=PORT, log_level="warning")


def main():
    if is_port_in_use(PORT):
        if is_office_data_joiner_running():
            print(f"[office-data-joiner] 이미 실행 중입니다. 브라우저를 엽니다: {URL}")
            webbrowser.open(URL)
            return
        print(f"[office-data-joiner] 포트 {PORT}가 다른 프로그램에서 사용 중입니다.")
        print("[office-data-joiner] 해당 프로그램을 종료한 뒤 다시 실행해 주세요.")
        return

    print(f"[office-data-joiner] 서버를 시작합니다... (포트: {PORT})")
    print("[office-data-joiner] 종료하려면 이 창을 닫으세요.")

    server_thread = threading.Thread(target=run_server, daemon=True)
    server_thread.start()

    for _ in range(20):
        time.sleep(0.5)
        if is_port_in_use(PORT):
            break
    else:
        print("[office-data-joiner] 서버 시작에 실패했습니다.")
        sys.exit(1)

    time.sleep(1.0)
    print(f"[office-data-joiner] 브라우저를 엽니다: {URL}")
    webbrowser.open(URL)

    try:
        server_thread.join()
    except KeyboardInterrupt:
        print("\n[office-data-joiner] 서버를 종료합니다.")


if __name__ == "__main__":
    # Windows .exe에서 multiprocessing 안전 사용을 위한 필수 호출
    multiprocessing.freeze_support()
    # Windows Python 3.10+: ProactorEventLoop 대신 SelectorEventLoop 사용 (uvicorn 호환)
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    main()
