from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from ..models.schemas import FileInfo


def _normalize_name_part(value: str) -> str:
    normalized = value.lower()
    normalized = re.sub(r"[\[\]\(\)\{\}]", " ", normalized)
    normalized = re.sub(r"[_\-.]+", " ", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized


def _parse_date_token(raw: str) -> Optional[Tuple[str, int]]:
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 6:
        year = 2000 + int(digits[:2])
        month = int(digits[2:4])
        day = int(digits[4:6])
    elif len(digits) == 8:
        year = int(digits[:4])
        month = int(digits[4:6])
        day = int(digits[6:8])
    else:
        return None

    if year < 1900 or not 1 <= month <= 12 or not 1 <= day <= 31:
        return None
    return f"{year:04d}-{month:02d}-{day:02d}", year * 10000 + month * 100 + day


def _version_sort_value(value: str) -> Tuple[int, ...]:
    return tuple(int(part) for part in value.split(".") if part.isdigit())


def _token_display(token: Dict[str, Any]) -> str:
    if token["kind"] == "version":
        return f"v{token['value']}"
    return str(token["value"])


def parse_document_identity(name: str) -> Dict[str, Any]:
    """Parse conservative document identity tokens from an Office filename.

    The parser intentionally returns explainable tokens only. It is used for
    grouping candidates, not for deleting/merging files or claiming content
    differences.
    """

    original_stem = Path(name).stem
    working = original_stem
    tokens: List[Dict[str, Any]] = []

    def replace_with_token(pattern: str, value_fn: Callable[[re.Match[str]], Optional[Dict[str, Any]]]):
        nonlocal working

        def repl(match: re.Match[str]) -> str:
            token = value_fn(match)
            if token:
                token.setdefault("raw", match.group(0))
                tokens.append(token)
            return " "

        working = re.sub(pattern, repl, working, flags=re.IGNORECASE)

    replace_with_token(
        r"(?<!\d)(20\d{2})[._-](0[1-9]|1[0-2])[._-]([0-2]\d|3[01])(?!\d)",
        lambda match: (
            {"kind": "date", "value": parsed[0], "sort_value": parsed[1]}
            if (parsed := _parse_date_token(match.group(0)))
            else None
        ),
    )
    replace_with_token(
        r"(?<!\d)(?:20\d{2}(?:0[1-9]|1[0-2])(?:[0-2]\d|3[01])|\d{2}(?:0[1-9]|1[0-2])(?:[0-2]\d|3[01]))(?!\d)",
        lambda match: (
            {"kind": "date", "value": parsed[0], "sort_value": parsed[1]}
            if (parsed := _parse_date_token(match.group(0)))
            else None
        ),
    )
    replace_with_token(
        r"(?<![A-Za-z0-9가-힣])(?:v|ver|version|rev|revision)\s*\.?\s*(\d+(?:\.\d+)*)(?![A-Za-z0-9가-힣])",
        lambda match: {
            "kind": "version",
            "value": match.group(1),
            "sort_value": _version_sort_value(match.group(1)),
        },
    )
    replace_with_token(
        r"(최종본?|수정본|개정본|복사본|초안|구버전|신버전)|(?<![A-Za-z0-9가-힣])(final|draft|copy|new|old)(?![A-Za-z0-9가-힣])",
        lambda match: {
            "kind": "status",
            "value": (match.group(1) or match.group(2) or "").lower(),
            "sort_value": {
                "old": 10,
                "구버전": 10,
                "draft": 20,
                "초안": 20,
                "copy": 30,
                "복사본": 30,
                "수정본": 40,
                "개정본": 45,
                "new": 50,
                "신버전": 50,
                "final": 60,
                "최종": 60,
                "최종본": 60,
            }.get((match.group(1) or match.group(2) or "").lower(), 0),
        },
    )

    base_name = _normalize_name_part(working) or _normalize_name_part(original_stem)
    latest_date = max((token.get("sort_value", 0) for token in tokens if token["kind"] == "date"), default=0)
    latest_version = max((token.get("sort_value", ()) for token in tokens if token["kind"] == "version"), default=())
    latest_status = max((token.get("sort_value", 0) for token in tokens if token["kind"] == "status"), default=0)
    token_kinds = sorted({token["kind"] for token in tokens})
    reason = "파일명에서 " + ", ".join(token_kinds) + " 표시를 감지했습니다." if token_kinds else "파일명 기준"
    return {
        "base_name": base_name,
        "tokens": tokens,
        "sort_key": (latest_date, latest_version, latest_status),
        "confidence_reason": reason,
    }


def canonical_name(name: str) -> str:
    return parse_document_identity(name)["base_name"]


def file_sort_key(file_info: FileInfo) -> Tuple[float, str]:
    if file_info.file_mtime is not None:
        return (file_info.file_mtime, file_info.name)
    if file_info.created_at:
        try:
            return (datetime.fromisoformat(file_info.created_at).timestamp(), file_info.name)
        except ValueError:
            pass
    return (0, file_info.name)
