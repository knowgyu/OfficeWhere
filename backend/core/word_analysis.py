from __future__ import annotations

from typing import Any, Dict, List

from .normalizer import normalize_value


def _count_page_breaks(element) -> int:
    """Count explicit/rendered Word page-break markers inside an XML element.

    DOCX files do not store stable page numbers as document data; Word and
    compatible editors paginate dynamically based on printer, font, and layout.
    The best source available without rendering the document is explicit
    `<w:br w:type="page">` markers plus Word's optional
    `<w:lastRenderedPageBreak>` markers when the file has been saved by Word.
    """

    page_breaks = 0
    for child in element.iter():
        tag = str(child.tag)
        if tag.endswith("}lastRenderedPageBreak"):
            page_breaks += 1
            continue
        if tag.endswith("}br"):
            break_type = child.get("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}type")
            if break_type == "page":
                page_breaks += 1
    return page_breaks


def _iter_document_blocks(document):
    from docx.oxml.table import CT_Tbl
    from docx.oxml.text.paragraph import CT_P
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    for child in document.element.body.iterchildren():
        if isinstance(child, CT_P):
            yield Paragraph(child, document)
        elif isinstance(child, CT_Tbl):
            yield Table(child, document)


def extract_word_blocks(path: str) -> List[Dict[str, Any]]:
    from docx import Document
    from docx.text.paragraph import Paragraph

    document = Document(path)
    blocks: List[Dict[str, Any]] = []
    paragraph_idx = 0
    table_idx = 0
    page_number = 1

    for block in _iter_document_blocks(document):
        if isinstance(block, Paragraph):
            text = block.text.strip()
            block_page_number = page_number
            page_number += _count_page_breaks(block._p)
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
        for row_idx, row in enumerate(block.rows, start=1):
            row_page_number = page_number
            cell_texts = [cell.text.strip() for cell in row.cells]
            row_text = " | ".join(text for text in cell_texts if text)
            page_number += _count_page_breaks(row._tr)
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


def inspect_word_file(path: str) -> Dict[str, Any]:
    blocks = extract_word_blocks(path)
    sample = [[block["block_type"], block["text"]] for block in blocks[:5]]
    return {
        "parser_config": {},
        "table_candidates": [],
        "columns": ["block_type", "text"],
        "sample": sample,
        "block_count": len(blocks),
    }
