from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import Any, Dict, List

from .normalizer import normalize_value

logger = logging.getLogger(__name__)

PDF_PREVIEW_PAGE_LIMIT = 8
PDF_PREVIEW_CHARS = 260
_PDFIUM_LOCK = threading.Lock()


def _load_pdfium():
    try:
        import pypdfium2 as pdfium  # type: ignore
    except ImportError as exc:  # pragma: no cover - exercised by packaging smoke, not unit env
        raise RuntimeError("pypdfium2가 설치되어 있지 않아 PDF를 읽을 수 없습니다.") from exc
    return pdfium


def _clean_text(value: str) -> str:
    lines = [line.strip() for line in str(value or "").replace("\x00", " ").splitlines()]
    return "\n".join(line for line in lines if line)


def extract_pdf_pages(path: str) -> List[Dict[str, Any]]:
    """Extract searchable PDF text page-by-page without modifying the source file."""

    pdfium = _load_pdfium()
    with _PDFIUM_LOCK:
        try:
            document = pdfium.PdfDocument(path, password="")
        except getattr(pdfium, "PdfiumError", Exception) as exc:
            if getattr(exc, "err_code", None) in {4, 5}:
                raise ValueError("암호로 보호되었거나 열 수 없는 PDF는 검색할 수 없습니다.") from exc
            raise ValueError(f"PDF 파일을 열 수 없습니다: {Path(path).name}") from exc
        except FileNotFoundError as exc:
            raise ValueError(f"PDF 파일을 찾을 수 없습니다: {Path(path).name}") from exc
        except Exception as exc:  # noqa: BLE001 - library-specific exceptions vary by version
            raise ValueError(f"PDF 파일을 열 수 없습니다: {Path(path).name}") from exc

        with document:
            pages: List[Dict[str, Any]] = []
            for index in range(len(document)):
                page_number = index + 1
                page = None
                textpage = None
                try:
                    page = document[index]
                    textpage = page.get_textpage()
                    text = _clean_text(textpage.get_text_bounded(errors="replace") or "")
                except Exception as exc:  # noqa: BLE001
                    logger.warning(
                        "pdf page text extraction failed; aborting pdf indexing",
                        extra={"path": path, "page_number": page_number, "error": str(exc)},
                        exc_info=True,
                    )
                    raise ValueError(f"PDF {page_number}쪽 텍스트를 읽을 수 없습니다: {Path(path).name}") from exc
                finally:
                    if textpage is not None:
                        textpage.close()
                    if page is not None:
                        page.close()
                if not text:
                    continue
                pages.append(
                    {
                        "page_number": page_number,
                        "location": f"쪽 {page_number}",
                        "text": text,
                        "normalized_text": normalize_value(text),
                    }
                )
            return pages


def inspect_pdf_pages(pages: List[Dict[str, Any]]) -> Dict[str, Any]:
    sample = [
        [page["location"], page["text"][:PDF_PREVIEW_CHARS]]
        for page in pages[:PDF_PREVIEW_PAGE_LIMIT]
    ]
    return {
        "columns": ["페이지", "내용"],
        "sample": sample,
        "page_count_with_text": len(pages),
    }


def inspect_pdf_file(path: str) -> Dict[str, Any]:
    return inspect_pdf_pages(extract_pdf_pages(path))
