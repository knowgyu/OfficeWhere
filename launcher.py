"""
office-data-joiner launcher
.exe 진입점: uvicorn 서버를 별도 스레드에서 시작하고 브라우저를 자동으로 엽니다.
"""
import sys
import socket
import threading
import time
import webbrowser

PORT = 8765
HOST = "127.0.0.1"
URL = f"http://{HOST}:{PORT}"


def is_port_in_use(port: int) -> bool:
    """포트가 이미 사용 중인지 확인"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(1)
        try:
            s.connect((HOST, port))
            return True
        except (ConnectionRefusedError, OSError):
            return False


def run_server():
    """uvicorn 서버 실행 (별도 스레드용)"""
    import uvicorn
    uvicorn.run(
        "backend.main:app",
        host=HOST,
        port=PORT,
        log_level="warning",
    )


def main():
    # 이미 실행 중인지 확인
    if is_port_in_use(PORT):
        print(f"[office-data-joiner] 이미 실행 중입니다. 브라우저를 엽니다: {URL}")
        webbrowser.open(URL)
        return

    print(f"[office-data-joiner] 서버를 시작합니다... (포트: {PORT})")

    # 서버를 별도 데몬 스레드에서 실행
    server_thread = threading.Thread(target=run_server, daemon=True)
    server_thread.start()

    # 서버 준비 대기 (최대 10초)
    for _ in range(20):
        time.sleep(0.5)
        if is_port_in_use(PORT):
            break
    else:
        print("[office-data-joiner] 서버 시작에 실패했습니다.")
        sys.exit(1)

    # 추가 대기 후 브라우저 오픈
    time.sleep(1.0)
    print(f"[office-data-joiner] 브라우저를 엽니다: {URL}")
    webbrowser.open(URL)

    # 메인 스레드는 서버 스레드가 종료될 때까지 대기
    try:
        server_thread.join()
    except KeyboardInterrupt:
        print("\n[office-data-joiner] 서버를 종료합니다.")


if __name__ == "__main__":
    main()
