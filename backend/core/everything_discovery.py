from __future__ import annotations

import ctypes
import os
import struct
import sys
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Sequence


TRUE_ENV_VALUES = {"1", "true", "yes", "on"}
FALSE_ENV_VALUES = {"0", "false", "no", "off"}
DEFAULT_EVERYTHING_TIMEOUT_SECONDS = 3.0
DEFAULT_EVERYTHING_MAX_RESULTS = 100_000

EVERYTHING_ERROR_IPC = 2
EVERYTHING_REQUEST_FULL_PATH_AND_FILE_NAME = 0x00000004


@dataclass(frozen=True)
class EverythingAvailability:
    status: str
    reason: str
    dll_path: str | None = None


@dataclass(frozen=True)
class EverythingDiscoveryResult:
    paths: list[str] = field(default_factory=list)
    status: str = "unavailable"
    fallback_reason: str = ""
    raw_total: int = 0
    returned_count: int = 0
    timed_out: bool = False
    dll_path: str | None = None
    query: str = ""


class EverythingDiscoveryError(RuntimeError):
    def __init__(self, fallback_reason: str, message: str, *, error_code: int | None = None):
        super().__init__(message)
        self.fallback_reason = fallback_reason
        self.error_code = error_code


def _enabled_override() -> bool | None:
    raw = os.environ.get("OW_EVERYTHING_ENABLED", "").strip().lower()
    if not raw or raw == "auto":
        return None
    if raw in TRUE_ENV_VALUES:
        return True
    if raw in FALSE_ENV_VALUES:
        return False
    return None


def is_everything_enabled() -> bool:
    override = _enabled_override()
    if override is not None:
        return override
    return _is_windows() and _auto_discover_sdk_dll_path() is not None


def everything_timeout_seconds() -> float:
    raw = os.environ.get("OW_EVERYTHING_TIMEOUT_SECONDS", "").strip()
    if not raw:
        return DEFAULT_EVERYTHING_TIMEOUT_SECONDS
    try:
        return max(0.1, float(raw))
    except ValueError:
        return DEFAULT_EVERYTHING_TIMEOUT_SECONDS


def everything_max_results() -> int:
    raw = os.environ.get("OW_EVERYTHING_MAX_RESULTS", "").strip()
    if not raw:
        return DEFAULT_EVERYTHING_MAX_RESULTS
    try:
        return max(1, int(raw))
    except ValueError:
        return DEFAULT_EVERYTHING_MAX_RESULTS


def _is_windows() -> bool:
    return sys.platform.startswith("win")


def _sdk_dll_name() -> str:
    return "Everything64.dll" if struct.calcsize("P") * 8 == 64 else "Everything32.dll"


def _candidate_sdk_names() -> list[str]:
    primary = _sdk_dll_name()
    secondary = "Everything32.dll" if primary == "Everything64.dll" else "Everything64.dll"
    return [primary, secondary]


def _configured_sdk_dll_path() -> str | None:
    configured = os.environ.get("OW_EVERYTHING_SDK_DLL", "").strip()
    if configured:
        return os.path.normpath(configured)
    return None


def _candidate_resource_dirs() -> list[Path]:
    dirs: list[Path] = []

    for env_name in ("OW_EVERYTHING_RESOURCES_DIR", "OW_EVERYTHING_SDK_DIR"):
        configured = os.environ.get(env_name, "").strip()
        if configured:
            dirs.append(Path(configured).expanduser())

    executable_dir = Path(sys.executable).resolve().parent
    module_root = Path(__file__).resolve().parents[2]
    cwd = Path.cwd()
    dirs.extend(
        [
            executable_dir / "everything-sdk",
            executable_dir.parent / "everything-sdk",
            module_root / "resources" / "everything-sdk",
            module_root.parent / "resources" / "everything-sdk",
            cwd / "resources" / "everything-sdk",
            cwd / "everything-sdk",
        ]
    )

    seen: set[str] = set()
    unique_dirs: list[Path] = []
    for directory in dirs:
        normalized = os.path.normcase(os.path.normpath(str(directory)))
        if normalized in seen:
            continue
        seen.add(normalized)
        unique_dirs.append(directory)
    return unique_dirs


def _auto_discover_sdk_dll_path() -> str | None:
    for directory in _candidate_resource_dirs():
        for filename in _candidate_sdk_names():
            candidate = directory / filename
            if candidate.is_file():
                return os.path.normpath(str(candidate))
    return None


def check_availability() -> EverythingAvailability:
    override = _enabled_override()
    if override is False:
        return EverythingAvailability(status="disabled", reason="everything_disabled")
    if not _is_windows():
        reason = "everything_non_windows" if override is True else "everything_disabled"
        return EverythingAvailability(status="unavailable", reason=reason)

    dll_path = _configured_sdk_dll_path() or _auto_discover_sdk_dll_path()
    if not dll_path:
        reason = "everything_sdk_missing" if override is True else "everything_disabled"
        return EverythingAvailability(status="unavailable", reason=reason)
    if not os.path.isfile(dll_path):
        return EverythingAvailability(
            status="unavailable",
            reason="everything_sdk_missing",
            dll_path=dll_path,
        )

    return EverythingAvailability(status="configured", reason="", dll_path=dll_path)


def _escape_everything_phrase(value: str) -> str:
    # Windows paths cannot contain double quotes. Keep the builder defensive for
    # tests and future callers by replacing a quote with a literal space rather
    # than producing a malformed Everything query.
    return value.replace('"', " ")


def _root_search_term(root_path: str) -> str:
    normalized = os.path.normpath(root_path)
    if not normalized.endswith((os.sep, "/", "\\")):
        normalized = os.path.join(normalized, "")
    return f'"{_escape_everything_phrase(normalized)}"'


def build_search_query(root_path: str, supported_extensions: Sequence[str]) -> str:
    extensions = sorted(
        {
            extension.lower().lstrip(".")
            for extension in supported_extensions
            if extension and extension.startswith(".")
        }
    )
    extension_filter = ";".join(extensions)
    return f"file: ext:{extension_filter} {_root_search_term(root_path)}"


class _EverythingSdkAdapter:
    def __init__(self, dll_path: str):
        self.dll_path = dll_path
        try:
            self._dll = ctypes.WinDLL(dll_path)
        except Exception as exc:  # pragma: no cover - exercised through monkeypatched tests.
            raise EverythingDiscoveryError(
                "everything_sdk_unloadable",
                f"Everything SDK DLL could not be loaded: {exc.__class__.__name__}: {exc}",
            ) from exc
        self._configure_functions()

    def _func(self, name: str):
        try:
            return getattr(self._dll, name)
        except AttributeError as exc:
            raise EverythingDiscoveryError(
                "everything_sdk_unloadable",
                f"Everything SDK DLL is missing required API: {name}",
            ) from exc

    def _configure_functions(self) -> None:
        from ctypes import wintypes

        self._reset = self._func("Everything_Reset")
        self._reset.argtypes = []
        self._reset.restype = None

        self._set_search = self._func("Everything_SetSearchW")
        self._set_search.argtypes = [wintypes.LPCWSTR]
        self._set_search.restype = None

        self._set_match_path = self._func("Everything_SetMatchPath")
        self._set_match_path.argtypes = [wintypes.BOOL]
        self._set_match_path.restype = None

        self._set_regex = self._func("Everything_SetRegex")
        self._set_regex.argtypes = [wintypes.BOOL]
        self._set_regex.restype = None

        self._set_max = self._func("Everything_SetMax")
        self._set_max.argtypes = [wintypes.DWORD]
        self._set_max.restype = None

        self._set_offset = self._func("Everything_SetOffset")
        self._set_offset.argtypes = [wintypes.DWORD]
        self._set_offset.restype = None

        self._set_request_flags = self._func("Everything_SetRequestFlags")
        self._set_request_flags.argtypes = [wintypes.DWORD]
        self._set_request_flags.restype = None

        self._query = self._func("Everything_QueryW")
        self._query.argtypes = [wintypes.BOOL]
        self._query.restype = wintypes.BOOL

        self._last_error = self._func("Everything_GetLastError")
        self._last_error.argtypes = []
        self._last_error.restype = wintypes.DWORD

        self._num_file_results = self._func("Everything_GetNumFileResults")
        self._num_file_results.argtypes = []
        self._num_file_results.restype = wintypes.DWORD

        self._total_file_results = self._func("Everything_GetTotFileResults")
        self._total_file_results.argtypes = []
        self._total_file_results.restype = wintypes.DWORD

        self._result_full_path = self._func("Everything_GetResultFullPathNameW")
        self._result_full_path.argtypes = [wintypes.DWORD, wintypes.LPWSTR, wintypes.DWORD]
        self._result_full_path.restype = wintypes.DWORD

    def query_paths(self, query: str, max_results: int) -> EverythingDiscoveryResult:
        self._reset()
        self._set_search(query)
        self._set_match_path(True)
        self._set_regex(False)
        self._set_max(max_results + 1)
        self._set_offset(0)
        self._set_request_flags(EVERYTHING_REQUEST_FULL_PATH_AND_FILE_NAME)

        if not self._query(True):
            error_code = int(self._last_error())
            reason = "everything_ipc_unavailable" if error_code == EVERYTHING_ERROR_IPC else "everything_query_failed"
            raise EverythingDiscoveryError(
                reason,
                f"Everything SDK query failed with error code {error_code}",
                error_code=error_code,
            )

        raw_total = int(self._total_file_results())
        returned_count = int(self._num_file_results())
        paths: list[str] = []
        for index in range(returned_count):
            required = int(self._result_full_path(index, None, 0))
            if required <= 0:
                error_code = int(self._last_error())
                raise EverythingDiscoveryError(
                    "everything_query_failed",
                    f"Everything SDK result path read failed at index {index} with error code {error_code}",
                    error_code=error_code,
                )
            buffer = ctypes.create_unicode_buffer(required + 1)
            copied = int(self._result_full_path(index, buffer, required + 1))
            if copied <= 0:
                error_code = int(self._last_error())
                raise EverythingDiscoveryError(
                    "everything_query_failed",
                    f"Everything SDK result path copy failed at index {index} with error code {error_code}",
                    error_code=error_code,
                )
            paths.append(os.path.normpath(buffer.value))

        return EverythingDiscoveryResult(
            paths=paths,
            status="ok",
            raw_total=raw_total,
            returned_count=returned_count,
            dll_path=self.dll_path,
            query=query,
        )


def _query_with_timeout(
    adapter: _EverythingSdkAdapter,
    query: str,
    max_results: int,
    timeout_seconds: float,
) -> EverythingDiscoveryResult:
    result_holder: dict[str, EverythingDiscoveryResult] = {}
    error_holder: dict[str, BaseException] = {}

    def run() -> None:
        try:
            result_holder["result"] = adapter.query_paths(query, max_results)
        except BaseException as exc:  # noqa: BLE001 - transported to caller.
            error_holder["error"] = exc

    thread = threading.Thread(target=run, name="everything-sdk-query", daemon=True)
    thread.start()
    thread.join(timeout_seconds)
    if thread.is_alive():
        return EverythingDiscoveryResult(
            status="timeout",
            fallback_reason="everything_timeout",
            timed_out=True,
            dll_path=adapter.dll_path,
            query=query,
        )
    if error_holder:
        error = error_holder["error"]
        if isinstance(error, EverythingDiscoveryError):
            return EverythingDiscoveryResult(
                status="unavailable",
                fallback_reason=error.fallback_reason,
                dll_path=adapter.dll_path,
                query=query,
            )
        return EverythingDiscoveryResult(
            status="failed",
            fallback_reason="everything_query_failed",
            dll_path=adapter.dll_path,
            query=query,
        )
    return result_holder["result"]


def discover_paths(
    root_path: str,
    recursive: bool,
    excluded_folder_names: Sequence[str],
    supported_extensions: Sequence[str],
    *,
    timeout_seconds: float | None = None,
    max_results: int | None = None,
) -> EverythingDiscoveryResult:
    del recursive, excluded_folder_names  # OfficeWhere revalidates these after discovery.

    availability = check_availability()
    if availability.reason:
        return EverythingDiscoveryResult(
            status=availability.status,
            fallback_reason=availability.reason,
            dll_path=availability.dll_path,
        )

    query = build_search_query(root_path, supported_extensions)
    if "content:" in query.casefold():
        return EverythingDiscoveryResult(
            status="failed",
            fallback_reason="everything_query_failed",
            dll_path=availability.dll_path,
            query=query,
        )

    try:
        adapter = _EverythingSdkAdapter(availability.dll_path or "")
    except EverythingDiscoveryError as exc:
        return EverythingDiscoveryResult(
            status="unavailable",
            fallback_reason=exc.fallback_reason,
            dll_path=availability.dll_path,
            query=query,
        )

    effective_max = max_results if max_results is not None else everything_max_results()
    effective_timeout = timeout_seconds if timeout_seconds is not None else everything_timeout_seconds()
    result = _query_with_timeout(adapter, query, effective_max, effective_timeout)

    if result.fallback_reason:
        return result
    if result.returned_count > effective_max or result.raw_total > effective_max:
        return EverythingDiscoveryResult(
            status="limit",
            fallback_reason="everything_result_limit",
            raw_total=result.raw_total,
            returned_count=result.returned_count,
            dll_path=result.dll_path,
            query=result.query,
        )
    if not result.paths:
        return EverythingDiscoveryResult(
            status="empty",
            fallback_reason="everything_empty_uncertain",
            raw_total=result.raw_total,
            returned_count=result.returned_count,
            dll_path=result.dll_path,
            query=result.query,
        )

    return result
