from __future__ import annotations

import ctypes
import ctypes.wintypes
import os
import platform
import subprocess
import sys
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Sequence

EVERYTHING_HELP_URL = "https://www.voidtools.com/downloads/"
EVERYTHING_SDK_HELP_URL = "https://www.voidtools.com/support/everything/sdk/"

_EVERYTHING_REQUEST_FILE_NAME = 0x00000001
_EVERYTHING_REQUEST_PATH = 0x00000002
_EVERYTHING_ERROR_IPC = 2
_MAX_PATH_CHARS = 32768
_SDK_LOCK = threading.Lock()


@dataclass
class EverythingDiscovery:
    paths: list[str] = field(default_factory=list)
    source: str = "everything_sdk"
    unavailable_reason: str = ""
    hint: str = ""
    help_url: str = ""
    dll_path: str = ""
    queried_count: int = 0

    @property
    def available(self) -> bool:
        return not self.unavailable_reason


def is_windows() -> bool:
    return sys.platform == "win32"


def sdk_disabled() -> bool:
    raw = os.environ.get("OW_EVERYTHING_SDK", "").strip().casefold()
    return raw in {"0", "false", "no", "off", "disabled"}


def _dll_names() -> list[str]:
    machine = platform.machine().lower()
    is_64bit = sys.maxsize > 2**32 or "64" in machine
    if is_64bit:
        return ["Everything64.dll", "Everything.dll"]
    return ["Everything32.dll", "Everything.dll"]


def _existing_file(path: Path) -> str | None:
    try:
        if path.is_file():
            return str(path)
    except OSError:
        return None
    return None


def candidate_dll_paths() -> list[str]:
    names = _dll_names()
    seen: set[str] = set()
    candidates: list[str] = []

    def add(value: str | Path | None) -> None:
        if not value:
            return
        text = os.path.normpath(str(value))
        key = text.casefold()
        if key in seen:
            return
        seen.add(key)
        candidates.append(text)

    env_path = os.environ.get("OW_EVERYTHING_SDK_DLL", "").strip()
    if env_path:
        add(env_path)

    base_dirs: list[Path] = []
    try:
        base_dirs.append(Path(sys.executable).resolve().parent)
    except OSError:
        pass
    try:
        base_dirs.append(Path(__file__).resolve().parents[2])
    except OSError:
        pass
    base_dirs.append(Path.cwd())

    for base in base_dirs:
        for name in names:
            add(base / name)

    for env_name in ("ProgramFiles", "ProgramFiles(x86)"):
        program_files = os.environ.get(env_name)
        if not program_files:
            continue
        for name in names:
            add(Path(program_files) / "Everything" / name)

    return candidates


def _resolve_dll_path() -> str | None:
    for candidate in candidate_dll_paths():
        existing = _existing_file(Path(candidate))
        if existing:
            return existing
    return None


def _everything_process_running() -> bool:
    if not is_windows():
        return False
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        completed = subprocess.run(
            ["tasklist", "/FI", "IMAGENAME eq Everything.exe", "/NH"],
            capture_output=True,
            text=True,
            timeout=2,
            creationflags=creationflags,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    output = f"{completed.stdout}\n{completed.stderr}".casefold()
    return "everything.exe" in output


def _missing_dll_discovery() -> EverythingDiscovery:
    if _everything_process_running():
        hint = (
            "Everything은 실행 중이지만 OfficeWhere가 사용할 SDK DLL(Everything64.dll/Everything32.dll)을 "
            "찾지 못해 기본 폴더 스캔으로 진행했습니다. SDK는 Everything 프로세스에 설치하는 방식이 아니라 "
            "DLL을 OfficeWhere가 읽을 수 있게 두는 방식입니다. Everything SDK DLL을 앱 폴더에 두거나 "
            "OW_EVERYTHING_SDK_DLL로 지정하면 다음 새로고침부터 빠른 발견을 사용합니다."
        )
        return EverythingDiscovery(
            unavailable_reason="sdk_dll_missing",
            hint=hint,
            help_url=EVERYTHING_SDK_HELP_URL,
        )
    hint = (
        "Everything 빠른 발견을 쓰려면 Windows에 Everything을 설치·실행하고 SDK DLL"
        "(Everything64.dll/Everything32.dll)을 앱 폴더에 두거나 OW_EVERYTHING_SDK_DLL로 지정하세요. "
        "SDK는 실행 중인 Everything 프로세스에 설치하지 않습니다. 이번 새로고침은 기본 폴더 스캔으로 계속 진행합니다."
    )
    return EverythingDiscovery(
        unavailable_reason="sdk_dll_missing",
        hint=hint,
        help_url=EVERYTHING_HELP_URL,
    )


def _configure_dll(dll: ctypes.CDLL) -> None:
    wintypes = ctypes.wintypes
    dll.Everything_Reset.argtypes = []
    dll.Everything_SetSearchW.argtypes = [ctypes.c_wchar_p]
    dll.Everything_SetMatchPath.argtypes = [wintypes.BOOL]
    dll.Everything_SetRequestFlags.argtypes = [wintypes.DWORD]
    dll.Everything_QueryW.argtypes = [wintypes.BOOL]
    dll.Everything_QueryW.restype = wintypes.BOOL
    dll.Everything_GetLastError.argtypes = []
    dll.Everything_GetLastError.restype = wintypes.DWORD
    dll.Everything_GetNumResults.argtypes = []
    dll.Everything_GetNumResults.restype = wintypes.DWORD
    dll.Everything_IsFileResult.argtypes = [wintypes.DWORD]
    dll.Everything_IsFileResult.restype = wintypes.BOOL
    dll.Everything_GetResultFullPathNameW.argtypes = [wintypes.DWORD, wintypes.LPWSTR, wintypes.DWORD]
    dll.Everything_GetResultFullPathNameW.restype = wintypes.DWORD


def _load_dll(path: str) -> ctypes.CDLL:
    win_dll = getattr(ctypes, "WinDLL", ctypes.CDLL)
    dll = win_dll(path)
    _configure_dll(dll)
    return dll


def _quote_query_term(value: str) -> str:
    return '"' + value.replace('"', ' ') + '"'


def _build_query(folder_path: str, supported_extensions: Sequence[str]) -> str:
    extensions = ";".join(sorted(ext.lower().lstrip(".") for ext in supported_extensions))
    normalized_folder = os.path.normpath(folder_path)
    return f"ext:{extensions} {_quote_query_term(normalized_folder)}"


def _path_is_within(candidate: str, root: str, recursive: bool) -> bool:
    try:
        candidate_abs = os.path.normcase(os.path.abspath(candidate))
        root_abs = os.path.normcase(os.path.abspath(root))
        if recursive:
            return os.path.commonpath([candidate_abs, root_abs]) == root_abs
        return os.path.dirname(candidate_abs) == root_abs
    except (OSError, ValueError):
        return False


def _path_has_excluded_part(candidate: str, root: str, excluded_keys: set[str]) -> bool:
    if not excluded_keys:
        return False
    try:
        relative = os.path.relpath(candidate, root)
    except ValueError:
        return False
    parts = Path(relative).parts[:-1]
    return any(part.casefold() in excluded_keys for part in parts)


def _is_supported_candidate(
    candidate: str,
    *,
    root: str,
    recursive: bool,
    supported_extensions: set[str],
    excluded_keys: set[str],
) -> bool:
    name = os.path.basename(candidate)
    if not name or name.startswith("~$"):
        return False
    if os.path.splitext(name)[1].lower() not in supported_extensions:
        return False
    if not _path_is_within(candidate, root, recursive):
        return False
    if _path_has_excluded_part(candidate, root, excluded_keys):
        return False
    try:
        return os.path.isfile(candidate)
    except OSError:
        return False


def _query_everything(
    dll: ctypes.CDLL,
    *,
    folder_path: str,
    recursive: bool,
    supported_extensions: set[str],
    excluded_keys: set[str],
) -> tuple[list[str], int]:
    query = _build_query(folder_path, sorted(supported_extensions))
    buffer = ctypes.create_unicode_buffer(_MAX_PATH_CHARS)
    paths: list[str] = []
    seen: set[str] = set()

    dll.Everything_Reset()
    dll.Everything_SetSearchW(query)
    dll.Everything_SetMatchPath(True)
    dll.Everything_SetRequestFlags(_EVERYTHING_REQUEST_FILE_NAME | _EVERYTHING_REQUEST_PATH)
    if not dll.Everything_QueryW(True):
        error_code = int(dll.Everything_GetLastError())
        raise RuntimeError(f"Everything IPC query failed: {error_code}")

    total = int(dll.Everything_GetNumResults())
    for index in range(total):
        if not dll.Everything_IsFileResult(index):
            continue
        copied = int(dll.Everything_GetResultFullPathNameW(index, buffer, _MAX_PATH_CHARS))
        if copied <= 0:
            continue
        candidate = os.path.normpath(ctypes.wstring_at(buffer))
        if not _is_supported_candidate(
            candidate,
            root=folder_path,
            recursive=recursive,
            supported_extensions=supported_extensions,
            excluded_keys=excluded_keys,
        ):
            continue
        key = os.path.normcase(candidate)
        if key in seen:
            continue
        seen.add(key)
        paths.append(candidate)
    return sorted(paths), total


def discover_supported_paths(
    folder_path: str,
    recursive: bool,
    supported_extensions: Iterable[str],
    excluded_keys: Iterable[str],
) -> EverythingDiscovery:
    """Return supported document paths from Everything, or a structured fallback reason.

    Everything is an optional Windows-only discovery accelerator. Any unavailable
    state is intentionally non-fatal so the caller can fall back to filesystem
    discovery without losing the refresh operation.
    """

    if not is_windows():
        return EverythingDiscovery(unavailable_reason="non_windows")
    if sdk_disabled():
        return EverythingDiscovery(unavailable_reason="disabled")

    dll_path = _resolve_dll_path()
    if not dll_path:
        return _missing_dll_discovery()

    try:
        with _SDK_LOCK:
            dll = _load_dll(dll_path)
            paths, queried_count = _query_everything(
                dll,
                folder_path=os.path.normpath(folder_path),
                recursive=recursive,
                supported_extensions={ext.lower() for ext in supported_extensions},
                excluded_keys={key.casefold() for key in excluded_keys},
            )
    except RuntimeError as exc:
        text = str(exc)
        is_ipc_error = text.endswith(f": {_EVERYTHING_ERROR_IPC}")
        if is_ipc_error:
            return EverythingDiscovery(
                unavailable_reason="ipc_unavailable",
                hint=(
                    "Everything IPC를 사용할 수 없어 기본 폴더 스캔으로 진행했습니다. "
                    "Everything이 백그라운드에서 실행 중인지 확인해 주세요. Lite 버전은 IPC/SDK 연동을 지원하지 않습니다."
                ),
                help_url=EVERYTHING_HELP_URL,
                dll_path=dll_path,
            )
        return EverythingDiscovery(
            unavailable_reason="query_failed",
            hint="Everything 빠른 발견 중 오류가 발생해 기본 폴더 스캔으로 진행했습니다.",
            help_url=EVERYTHING_SDK_HELP_URL,
            dll_path=dll_path,
        )
    except Exception:
        return EverythingDiscovery(
            unavailable_reason="sdk_error",
            hint="Everything SDK를 불러오지 못해 기본 폴더 스캔으로 진행했습니다.",
            help_url=EVERYTHING_SDK_HELP_URL,
            dll_path=dll_path,
        )

    return EverythingDiscovery(paths=paths, dll_path=dll_path, queried_count=queried_count)
