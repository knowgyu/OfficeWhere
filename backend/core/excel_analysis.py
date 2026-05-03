from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
import hashlib
from pathlib import Path
import posixpath
import re
import zipfile
from typing import Any, Dict, Iterator, List, Optional, Tuple
from xml.etree import ElementTree as ET


RangeConfig = Dict[str, Any]
SHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
SHEET_TAG = f"{{{SHEET_NS}}}"
REL_ID = f"{{{REL_NS}}}id"
_CELL_REF_RE = re.compile(r"^([A-Z]+)([0-9]+)$")
BUILTIN_DATE_NUM_FMT_IDS = {
    14,
    15,
    16,
    17,
    22,
    27,
    30,
    36,
    50,
    57,
}


@dataclass(frozen=True)
class ExcelUsedRange:
    """A lightweight source-coordinate view of one visible XLSX sheet."""

    sheet_name: str
    sheet_index: int
    rows: List[List[Any]]
    range_config: RangeConfig
    row_count: int
    column_count: int
    non_empty_cell_count: int
    content_hash: str

    @property
    def is_empty(self) -> bool:
        return self.row_count == 0 or self.column_count == 0

    def value_at(self, row_index: int, column_index: int) -> Any:
        """Return a zero-based cell value, or an empty string outside the used range."""
        if row_index < 0 or column_index < 0:
            return ""
        if row_index >= self.row_count or column_index >= self.column_count:
            return ""
        row = self.rows[row_index]
        if column_index >= len(row):
            return ""
        return row[column_index]

    def iter_non_empty_cells(self) -> Iterator[Dict[str, Any]]:
        for row_index, row in enumerate(self.rows, start=1):
            for column_index in range(1, self.column_count + 1):
                value = row[column_index - 1] if column_index - 1 < len(row) else ""
                text = _stringify(value)
                if not text:
                    continue
                yield {
                    "row_number": row_index,
                    "column_index": column_index,
                    "column_letter": _column_letter(column_index),
                    "value": value,
                    "text": text,
                }

    def preview_columns(self) -> List[str]:
        if self.is_empty:
            return []
        header_values = [_stringify(value) for value in self.rows[0]]
        return [
            header if header else _column_letter(fallback)
            for fallback, header in enumerate(header_values, start=1)
        ]

    def preview_sample(self, limit: int = 5) -> List[List[str]]:
        if self.is_empty:
            return []
        sample: List[List[str]] = []
        for row in self.rows[1 : limit + 1]:
            padded = [row[index] if index < len(row) else "" for index in range(self.column_count)]
            sample.append([_stringify(value) for value in padded])
        return sample

    def sheet_summary(self) -> Dict[str, Any]:
        return {
            "sheet_name": self.sheet_name,
            "sheet_index": self.sheet_index,
            "row_count": self.row_count,
            "column_count": self.column_count,
            "non_empty_cell_count": self.non_empty_cell_count,
            "content_hash": self.content_hash,
        }


def _is_non_empty(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, float) and value != value:
        return False
    return str(value).strip() != ""


def _stringify(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value != value:
        return ""
    return str(value).strip()


def _column_letter(index: int) -> str:
    if index < 1:
        return ""
    letters = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        letters = chr(65 + remainder) + letters
    return letters


def _column_index_from_letters(letters: str) -> int:
    index = 0
    for char in letters.upper():
        if not ("A" <= char <= "Z"):
            continue
        index = index * 26 + (ord(char) - ord("A") + 1)
    return max(index, 1)


def _cell_ref_to_indices(ref: str) -> Tuple[int, int]:
    match = _CELL_REF_RE.match(ref.upper())
    if not match:
        return 1, 1
    column_letters, row_text = match.groups()
    return int(row_text), _column_index_from_letters(column_letters)


def _ensure_supported_xlsx(path: str) -> None:
    ext = Path(path).suffix.lower()
    if ext != ".xlsx":
        raise ValueError(f"지원하지 않는 Excel 형식입니다: {ext}. 지원 형식: .xlsx")


def _xlsx_relationship_targets(archive: zipfile.ZipFile) -> Dict[str, str]:
    try:
        rels_xml = archive.read("xl/_rels/workbook.xml.rels")
    except KeyError:
        return {}
    root = ET.fromstring(rels_xml)
    targets: Dict[str, str] = {}
    for rel in root.findall(f"{{{PKG_REL_NS}}}Relationship"):
        rel_id = rel.get("Id")
        target = rel.get("Target")
        if not rel_id or not target:
            continue
        if target.startswith("/"):
            normalized = target.lstrip("/")
        else:
            normalized = posixpath.normpath(posixpath.join("xl", target))
        targets[rel_id] = normalized
    return targets


def _xlsx_sheet_refs_from_archive(
    archive: zipfile.ZipFile,
    *,
    visible_only: bool = True,
) -> List[Tuple[str, str]]:
    rel_targets = _xlsx_relationship_targets(archive)
    root = ET.fromstring(archive.read("xl/workbook.xml"))
    refs: List[Tuple[str, str]] = []
    for sheet in root.findall(f".//{SHEET_TAG}sheet"):
        state = sheet.get("state", "visible")
        if visible_only and state not in ("", "visible"):
            continue
        name = sheet.get("name")
        rel_id = sheet.get(REL_ID)
        target = rel_targets.get(rel_id or "")
        if name and target:
            refs.append((name, target))
    return refs


def _xlsx_sheet_refs(path: str, *, visible_only: bool = True) -> List[Tuple[str, str]]:
    _ensure_supported_xlsx(path)
    with zipfile.ZipFile(path) as archive:
        return _xlsx_sheet_refs_from_archive(archive, visible_only=visible_only)


def _xlsx_shared_strings(archive: zipfile.ZipFile) -> List[str]:
    try:
        source = archive.open("xl/sharedStrings.xml")
    except KeyError:
        return []

    strings: List[str] = []
    with source:
        for _event, element in ET.iterparse(source, events=("end",)):
            if element.tag != f"{SHEET_TAG}si":
                continue
            text = "".join(node.text or "" for node in element.iter(f"{SHEET_TAG}t"))
            strings.append(text)
            element.clear()
    return strings


def _xlsx_date_system(archive: zipfile.ZipFile) -> str:
    try:
        root = ET.fromstring(archive.read("xl/workbook.xml"))
    except (KeyError, ET.ParseError):
        return "1900"
    workbook_pr = root.find(f"{SHEET_TAG}workbookPr")
    return "1904" if workbook_pr is not None and workbook_pr.get("date1904") in {"1", "true", "True"} else "1900"


def _xlsx_date_style_ids(archive: zipfile.ZipFile) -> set[int]:
    try:
        root = ET.fromstring(archive.read("xl/styles.xml"))
    except (KeyError, ET.ParseError):
        return set()

    custom_formats: Dict[int, str] = {}
    for item in root.findall(f".//{SHEET_TAG}numFmt"):
        num_fmt_id = item.get("numFmtId")
        format_code = item.get("formatCode", "")
        if num_fmt_id:
            try:
                custom_formats[int(num_fmt_id)] = format_code
            except ValueError:
                continue

    date_style_ids: set[int] = set()
    cell_xfs = root.find(f"{SHEET_TAG}cellXfs")
    if cell_xfs is None:
        return date_style_ids
    for style_index, xf in enumerate(cell_xfs.findall(f"{SHEET_TAG}xf")):
        try:
            num_fmt_id = int(xf.get("numFmtId", "0"))
        except ValueError:
            continue
        format_code = custom_formats.get(num_fmt_id, "")
        if num_fmt_id in BUILTIN_DATE_NUM_FMT_IDS or _is_date_format_code(format_code):
            date_style_ids.add(style_index)
    return date_style_ids


def _is_date_format_code(format_code: str) -> bool:
    cleaned = re.sub(r'"[^"]*"', "", format_code)
    cleaned = re.sub(r"\[[^\]]+\]", "", cleaned)
    cleaned = cleaned.replace("\\", "").lower()
    if "y" in cleaned or "d" in cleaned:
        return True
    return ("h" in cleaned and "m" in cleaned) or ("m" in cleaned and "s" in cleaned)


def _excel_serial_to_datetime(value: float, date_system: str) -> datetime:
    base = datetime(1904, 1, 1) if date_system == "1904" else datetime(1899, 12, 30)
    return base + timedelta(days=value)


def _format_excel_date(value: str, date_system: str) -> str:
    numeric = float(value)
    converted = _excel_serial_to_datetime(numeric, date_system)
    if 0 <= numeric < 1:
        return converted.time().replace(microsecond=0).isoformat()
    if abs(numeric - int(numeric)) < 1e-9:
        return converted.date().isoformat()
    return converted.replace(microsecond=0).isoformat(sep=" ")


def _xlsx_cell_text(
    cell: ET.Element,
    shared_strings: List[str],
    date_style_ids: set[int],
    date_system: str,
) -> Any:
    cell_type = cell.get("t")
    if cell_type == "inlineStr":
        return "".join(node.text or "" for node in cell.iter(f"{SHEET_TAG}t"))

    value_node = cell.find(f"{SHEET_TAG}v")
    value = value_node.text if value_node is not None else ""
    if value is None:
        return ""

    if cell_type == "s":
        try:
            index = int(value)
        except ValueError:
            try:
                index = int(float(value))
            except ValueError:
                return value
        return shared_strings[index] if 0 <= index < len(shared_strings) else ""
    if cell_type == "b":
        return "TRUE" if value == "1" else "FALSE"
    style_id_text = cell.get("s")
    if style_id_text:
        try:
            style_id = int(style_id_text)
        except ValueError:
            style_id = -1
        if style_id in date_style_ids:
            try:
                return _format_excel_date(value, date_system)
            except (TypeError, ValueError, OverflowError):
                return value
    return value


def _empty_used_range(sheet_name: str, sheet_index: int) -> ExcelUsedRange:
    empty_config = {
        "sheet_name": sheet_name,
        "header_row": 0,
        "start_col": 1,
        "end_col": 1,
        "end_row": 0,
    }
    return ExcelUsedRange(
        sheet_name=sheet_name,
        sheet_index=sheet_index,
        rows=[],
        range_config=empty_config,
        row_count=0,
        column_count=0,
        non_empty_cell_count=0,
        content_hash=hashlib.sha256().hexdigest(),
    )


def _used_range_content_fingerprint(rows: List[List[Any]]) -> Tuple[int, str]:
    digest = hashlib.sha256()
    non_empty_cell_count = 0
    for row_index, row in enumerate(rows, start=1):
        for column_index, value in enumerate(row, start=1):
            text = _stringify(value)
            if not text:
                continue
            non_empty_cell_count += 1
            digest.update(f"{row_index}\t{column_index}\t{text}\n".encode("utf-8"))
    return non_empty_cell_count, digest.hexdigest()


def _build_used_range(
    sheet_name: str,
    sheet_index: int,
    rows_by_number: Dict[int, Dict[int, Any]],
    last_non_empty_row: int,
    last_non_empty_col: int,
) -> ExcelUsedRange:
    if last_non_empty_row <= 0 or last_non_empty_col <= 0:
        return _empty_used_range(sheet_name, sheet_index)

    rows: List[List[Any]] = []
    for row_index in range(1, last_non_empty_row + 1):
        row_values = rows_by_number.get(row_index, {})
        rows.append([row_values.get(column_index, "") for column_index in range(1, last_non_empty_col + 1)])

    non_empty_cell_count, content_hash = _used_range_content_fingerprint(rows)
    if non_empty_cell_count <= 0:
        return _empty_used_range(sheet_name, sheet_index)

    config = {
        "sheet_name": sheet_name,
        "header_row": 0,
        "start_col": 1,
        "end_col": last_non_empty_col,
        "end_row": last_non_empty_row,
    }
    return ExcelUsedRange(
        sheet_name=sheet_name,
        sheet_index=sheet_index,
        rows=rows,
        range_config=config,
        row_count=last_non_empty_row,
        column_count=last_non_empty_col,
        non_empty_cell_count=non_empty_cell_count,
        content_hash=content_hash,
    )


def _xlsx_read_used_range_from_archive(
    archive: zipfile.ZipFile,
    sheet_name: str,
    sheet_index: int,
    sheet_path: str,
    shared_strings: List[str],
    date_style_ids: set[int],
    date_system: str,
) -> ExcelUsedRange:
    rows_by_number: Dict[int, Dict[int, Any]] = {}
    last_non_empty_row = 0
    last_non_empty_col = 0

    with archive.open(sheet_path) as source:
        for _event, element in ET.iterparse(source, events=("end",)):
            if element.tag != f"{SHEET_TAG}c":
                continue
            ref = element.get("r", "")
            row_index, col_index = _cell_ref_to_indices(ref)
            value = _xlsx_cell_text(
                element,
                shared_strings,
                date_style_ids,
                date_system,
            )
            rows_by_number.setdefault(row_index, {})[col_index] = value
            if _is_non_empty(value):
                last_non_empty_row = max(last_non_empty_row, row_index)
                last_non_empty_col = max(last_non_empty_col, col_index)
            element.clear()

    return _build_used_range(sheet_name, sheet_index, rows_by_number, last_non_empty_row, last_non_empty_col)


def list_sheet_names(path: str) -> List[str]:
    return [name for name, _target in _xlsx_sheet_refs(path)]


def extract_excel_used_ranges(path: str) -> List[ExcelUsedRange]:
    """Return all visible `.xlsx` sheets as source-coordinate used ranges."""
    _ensure_supported_xlsx(path)
    with zipfile.ZipFile(path) as archive:
        refs = _xlsx_sheet_refs_from_archive(archive)
        if not refs:
            raise ValueError("Excel 파일에 시트가 없습니다.")
        shared_strings = _xlsx_shared_strings(archive)
        date_style_ids = _xlsx_date_style_ids(archive)
        date_system = _xlsx_date_system(archive)
        ranges: List[ExcelUsedRange] = []
        for sheet_index, (current_sheet_name, sheet_path) in enumerate(refs, start=1):
            ranges.append(
                _xlsx_read_used_range_from_archive(
                    archive,
                    current_sheet_name,
                    sheet_index,
                    sheet_path,
                    shared_strings,
                    date_style_ids,
                    date_system,
                )
            )
        return ranges


def extract_excel_used_range(path: str, sheet_name: Optional[str] = None) -> Tuple[ExcelUsedRange, RangeConfig]:
    """Return one visible `.xlsx` sheet's source-coordinate used range."""
    used_ranges = extract_excel_used_ranges(path)
    selected = next((item for item in used_ranges if item.sheet_name == sheet_name), None) if sheet_name else None
    if selected is None:
        selected = next((item for item in used_ranges if item.non_empty_cell_count > 0), used_ranges[0])
    return selected, selected.range_config


def inspect_excel_file(path: str) -> Dict[str, Any]:
    used_range, _config = extract_excel_used_range(path)
    return {
        "columns": used_range.preview_columns(),
        "sample": used_range.preview_sample(),
    }
