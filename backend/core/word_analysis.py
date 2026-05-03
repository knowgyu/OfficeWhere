from __future__ import annotations

import zipfile
from xml.etree import ElementTree as ET
from typing import Any, Dict, Iterable, List

from .normalizer import normalize_value

WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
WORD_TAG = f"{{{WORD_NS}}}"


def _text_from_word_element(element: ET.Element) -> str:
    parts: List[str] = []
    for child in element.iter():
        if child.tag == f"{WORD_TAG}t" and child.text:
            parts.append(child.text)
        elif child.tag == f"{WORD_TAG}tab":
            parts.append("\t")
        elif child.tag == f"{WORD_TAG}br":
            parts.append("\n")
    return "".join(parts).strip()


def _count_page_breaks_xml(element: ET.Element) -> int:
    page_breaks = 0
    for child in element.iter():
        if child.tag == f"{WORD_TAG}lastRenderedPageBreak":
            page_breaks += 1
            continue
        if child.tag == f"{WORD_TAG}br" and child.get(f"{WORD_TAG}type") == "page":
            page_breaks += 1
    return page_breaks


def _iter_body_blocks(body: ET.Element) -> Iterable[ET.Element]:
    for child in list(body):
        if child.tag in {f"{WORD_TAG}p", f"{WORD_TAG}tbl"}:
            yield child


def extract_word_blocks(path: str) -> List[Dict[str, Any]]:
    """Extract searchable/comparable Word text without loading embedded media.

    DOCX files are ZIP packages.  Reading only `word/document.xml` avoids
    touching images, videos, or other binary parts whose CRC errors should not
    block text indexing/version comparison.
    """
    with zipfile.ZipFile(path) as archive:
        try:
            document_xml = archive.read("word/document.xml")
        except KeyError as exc:
            raise ValueError("Word 본문 XML을 찾을 수 없습니다.") from exc

    root = ET.fromstring(document_xml)
    body = root.find(f"{WORD_TAG}body")
    if body is None:
        return []

    blocks: List[Dict[str, Any]] = []
    paragraph_idx = 0
    table_idx = 0
    page_number = 1

    for block in _iter_body_blocks(body):
        if block.tag == f"{WORD_TAG}p":
            text = _text_from_word_element(block)
            block_page_number = page_number
            page_number += _count_page_breaks_xml(block)
            if not text:
                continue
            paragraph_idx += 1
            blocks.append(
                {
                    "block_type": "paragraph",
                    "location": f"paragraph:{paragraph_idx}",
                    "page_number": block_page_number,
                    "text": text,
                    "normalized_text": normalize_value(text),
                }
            )
            continue

        table_idx += 1
        for row_idx, row in enumerate(block.findall(f".//{WORD_TAG}tr"), start=1):
            row_page_number = page_number
            cell_texts = [_text_from_word_element(cell) for cell in row.findall(f"{WORD_TAG}tc")]
            row_text = " | ".join(text for text in cell_texts if text)
            page_number += _count_page_breaks_xml(row)
            if not row_text:
                continue
            blocks.append(
                {
                    "block_type": "table_row",
                    "location": f"table:{table_idx}/row:{row_idx}",
                    "page_number": row_page_number,
                    "text": row_text,
                    "normalized_text": normalize_value(row_text),
                }
            )

    return blocks


def inspect_word_blocks(blocks: List[Dict[str, Any]]) -> Dict[str, Any]:
    sample = [[block["block_type"], block["text"]] for block in blocks[:5]]
    return {
        "columns": ["block_type", "text"],
        "sample": sample,
        "block_count": len(blocks),
    }


def inspect_word_file(path: str) -> Dict[str, Any]:
    return inspect_word_blocks(extract_word_blocks(path))
