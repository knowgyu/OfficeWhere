from __future__ import annotations

from typing import Any, Dict, List

from .normalizer import normalize_value


_PARAGRAPH_CHAR_LIMIT = 2000


def _read_text(path: str) -> str:
    for encoding in ("utf-8-sig", "utf-8", "cp949", "euc-kr"):
        try:
            with open(path, "r", encoding=encoding) as fh:
                return fh.read()
        except UnicodeDecodeError:
            continue
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        return fh.read()


def _split_paragraph(paragraph: str) -> List[str]:
    if len(paragraph) <= _PARAGRAPH_CHAR_LIMIT:
        return [paragraph]
    pieces: List[str] = []
    remaining = paragraph
    while len(remaining) > _PARAGRAPH_CHAR_LIMIT:
        pieces.append(remaining[:_PARAGRAPH_CHAR_LIMIT])
        remaining = remaining[_PARAGRAPH_CHAR_LIMIT:]
    if remaining:
        pieces.append(remaining)
    return pieces


def extract_text_blocks(path: str) -> List[Dict[str, Any]]:
    text = _read_text(path)
    lines = text.splitlines()
    blocks: List[Dict[str, Any]] = []
    buffer: List[str] = []
    buffer_start_line = 1
    block_idx = 0

    def flush():
        nonlocal buffer, block_idx
        if not buffer:
            return
        paragraph = "\n".join(buffer).strip()
        buffer = []
        if not paragraph:
            return
        for chunk_text in _split_paragraph(paragraph):
            block_idx += 1
            blocks.append(
                {
                    "block_type": "paragraph",
                    "location": f"단락 {block_idx} (줄 {buffer_start_line})",
                    "text": chunk_text,
                    "normalized_text": normalize_value(chunk_text),
                }
            )

    for line_no, line in enumerate(lines, start=1):
        if line.strip():
            if not buffer:
                buffer_start_line = line_no
            buffer.append(line)
        else:
            flush()
    flush()

    if not blocks and text.strip():
        blocks.append(
            {
                "block_type": "paragraph",
                "location": "단락 1",
                "text": text.strip(),
                "normalized_text": normalize_value(text),
            }
        )
    return blocks


def inspect_text_file(path: str) -> Dict[str, Any]:
    blocks = extract_text_blocks(path)
    sample = [[block["location"], block["text"][:200]] for block in blocks[:5]]
    return {
        "parser_config": {},
        "table_candidates": [],
        "columns": ["location", "content"],
        "sample": sample,
        "block_count": len(blocks),
    }
