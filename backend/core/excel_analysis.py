from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
import hashlib
from pathlib import Path
import posixpath
import re
import zipfile
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Tuple
from xml.etree import ElementTree as ET

from openpyxl.utils import get_column_letter

if TYPE_CHECKING:
    import pandas as pd


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
    sheet_name: str
    sheet_index: int
    dataframe: Any
    range_config: RangeConfig
    row_count: int
    column_count: int
    non_empty_cell_count: int
    content_hash: str

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


def _get_pandas():
    import pandas as pd

    return pd


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
    with zipfile.ZipFile(path) as archive:
        return _xlsx_sheet_refs_from_archive(archive, visible_only=visible_only)


def _xlsx_sheet_path(path: str, sheet_name: str) -> str:
    for name, target in _xlsx_sheet_refs(path):
        if name == sheet_name:
            return target
    raise ValueError(f"시트를 찾을 수 없습니다: {sheet_name}")


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


def _xlsx_read_sheet_from_archive(
    archive: zipfile.ZipFile,
    sheet_path: str,
    shared_strings: List[str],
    date_style_ids: set[int],
    date_system: str,
    max_rows: Optional[int] = None,
    min_row: int = 1,
    max_row: Optional[int] = None,
    min_col: int = 1,
    max_col: Optional[int] = None,
) -> "pd.DataFrame":
    pd = _get_pandas()

    bounded_max_row = max_row
    if max_rows is not None:
        row_limit = min_row + max_rows - 1
        bounded_max_row = row_limit if bounded_max_row is None else min(bounded_max_row, row_limit)

    rows_by_number: Dict[int, Dict[int, Any]] = {}
    max_seen_row = min_row - 1
    max_seen_col = min_col - 1

    with archive.open(sheet_path) as source:
        for _event, element in ET.iterparse(source, events=("end",)):
            if element.tag != f"{SHEET_TAG}c":
                continue
            ref = element.get("r", "")
            row_index, col_index = _cell_ref_to_indices(ref)
            if row_index < min_row:
                element.clear()
                continue
            if bounded_max_row is not None and row_index > bounded_max_row:
                element.clear()
                break
            if col_index < min_col or (max_col is not None and col_index > max_col):
                element.clear()
                continue
            rows_by_number.setdefault(row_index, {})[col_index] = _xlsx_cell_text(
                element,
                shared_strings,
                date_style_ids,
                date_system,
            )
            max_seen_row = max(max_seen_row, row_index)
            max_seen_col = max(max_seen_col, col_index)
            element.clear()

    if bounded_max_row is not None:
        output_max_row = bounded_max_row
    else:
        output_max_row = max_seen_row
    output_max_col = max_col if max_col is not None else max_seen_col
    if output_max_row < min_row or output_max_col < min_col:
        return pd.DataFrame()

    rows: List[List[Any]] = []
    for row_index in range(min_row, output_max_row + 1):
        row_values = rows_by_number.get(row_index, {})
        rows.append([row_values.get(col_index, "") for col_index in range(min_col, output_max_col + 1)])
    return _rows_to_dataframe(rows)


def _xlsx_read_sheet(
    path: str,
    sheet_name: str,
    max_rows: Optional[int] = None,
    min_row: int = 1,
    max_row: Optional[int] = None,
    min_col: int = 1,
    max_col: Optional[int] = None,
) -> "pd.DataFrame":
    with zipfile.ZipFile(path) as archive:
        refs = dict(_xlsx_sheet_refs_from_archive(archive))
        sheet_path = refs.get(sheet_name)
        if not sheet_path:
            pd = _get_pandas()
            return pd.DataFrame()
        return _xlsx_read_sheet_from_archive(
            archive,
            sheet_path,
            _xlsx_shared_strings(archive),
            _xlsx_date_style_ids(archive),
            _xlsx_date_system(archive),
            max_rows=max_rows,
            min_row=min_row,
            max_row=max_row,
            min_col=min_col,
            max_col=max_col,
        )


def _rows_to_dataframe(rows: List[List[Any]]) -> "pd.DataFrame":
    pd = _get_pandas()
    if not rows:
        return pd.DataFrame()
    return pd.DataFrame(rows)


def _read_excel_sheet(
    path: str,
    sheet_name: str,
    max_rows: Optional[int] = None,
    min_row: int = 1,
    max_row: Optional[int] = None,
    min_col: int = 1,
    max_col: Optional[int] = None,
) -> "pd.DataFrame":
    """Read an Excel sheet slice.

    `.xlsx`/`.xlsm` files are streamed through openpyxl read-only workbooks so
    header discovery does not materialize the whole workbook.  Pandas is imported
    lazily only when we need to return a DataFrame.
    """
    pd = _get_pandas()
    ext = Path(path).suffix.lower()
    if ext == ".xls":
        kwargs: Dict[str, Any] = dict(
            sheet_name=sheet_name,
            header=None,
            dtype=object,
            keep_default_na=False,
        )
        if max_rows is not None:
            kwargs["nrows"] = max_rows
        if min_row > 1:
            kwargs["skiprows"] = min_row - 1
        try:
            df = pd.read_excel(path, engine="xlrd", **kwargs)
        except ValueError:
            df = pd.read_excel(path, **kwargs)
        if max_row is not None and max_rows is None:
            df = df.iloc[: max_row - min_row + 1]
        return df.iloc[:, min_col - 1 : max_col] if max_col is not None else df.iloc[:, min_col - 1 :]
    return _xlsx_read_sheet(
        path,
        sheet_name,
        max_rows=max_rows,
        min_row=min_row,
        max_row=max_row,
        min_col=min_col,
        max_col=max_col,
    )


def list_sheet_names(path: str) -> List[str]:
    ext = Path(path).suffix.lower()
    if ext == ".xls":
        pd = _get_pandas()

        try:
            xl = pd.ExcelFile(path, engine="xlrd")
        except ValueError:
            xl = pd.ExcelFile(path)
        return list(xl.sheet_names)
    return [name for name, _target in _xlsx_sheet_refs(path)]


def _used_range_content_fingerprint(dataframe: "pd.DataFrame") -> Tuple[int, str]:
    digest = hashlib.sha256()
    non_empty_cell_count = 0
    for dataframe_index, row in dataframe.iterrows():
        excel_row = int(dataframe_index) + 1
        for column_index, column in enumerate(dataframe.columns, start=1):
            text = _stringify(row[column])
            if not text:
                continue
            non_empty_cell_count += 1
            digest.update(f"{excel_row}\t{column_index}\t{text}\n".encode("utf-8"))
    return non_empty_cell_count, digest.hexdigest()


def _build_used_range(sheet_name: str, sheet_index: int, raw: "pd.DataFrame") -> ExcelUsedRange:
    """Return one sheet's actual used range while preserving Excel coordinates."""
    import pandas as pd

    if raw.empty:
        empty_config = {
            "sheet_name": sheet_name,
            "header_row": 0,
            "start_col": 1,
            "end_col": 1,
            "end_row": 0,
        }
        non_empty_cell_count, content_hash = _used_range_content_fingerprint(pd.DataFrame())
        return ExcelUsedRange(
            sheet_name=sheet_name,
            sheet_index=sheet_index,
            dataframe=pd.DataFrame(),
            range_config=empty_config,
            row_count=0,
            column_count=0,
            non_empty_cell_count=non_empty_cell_count,
            content_hash=content_hash,
        )

    raw = raw.fillna("")
    non_empty = raw.map(_is_non_empty)
    non_empty_rows = non_empty.any(axis=1)
    non_empty_cols = non_empty.any(axis=0)

    if not bool(non_empty_rows.any()) or not bool(non_empty_cols.any()):
        empty_config = {
            "sheet_name": sheet_name,
            "header_row": 0,
            "start_col": 1,
            "end_col": 1,
            "end_row": 0,
        }
        non_empty_cell_count, content_hash = _used_range_content_fingerprint(pd.DataFrame())
        return ExcelUsedRange(
            sheet_name=sheet_name,
            sheet_index=sheet_index,
            dataframe=pd.DataFrame(),
            range_config=empty_config,
            row_count=0,
            column_count=0,
            non_empty_cell_count=non_empty_cell_count,
            content_hash=content_hash,
        )

    last_row_position = int(non_empty_rows[non_empty_rows].index[-1])
    last_col_position = int(non_empty_cols[non_empty_cols].index[-1])
    used = raw.iloc[: last_row_position + 1, : last_col_position + 1].copy()
    used.columns = [get_column_letter(index) for index in range(1, len(used.columns) + 1)]
    non_empty_cell_count, content_hash = _used_range_content_fingerprint(used)

    config = {
        "sheet_name": sheet_name,
        "header_row": 0,
        "start_col": 1,
        "end_col": len(used.columns),
        "end_row": len(used.index),
    }
    return ExcelUsedRange(
        sheet_name=sheet_name,
        sheet_index=sheet_index,
        dataframe=used,
        range_config=config,
        row_count=len(used.index),
        column_count=len(used.columns),
        non_empty_cell_count=non_empty_cell_count,
        content_hash=content_hash,
    )


def extract_excel_used_ranges(path: str) -> List[ExcelUsedRange]:
    """Return all visible Excel sheets as source-coordinate used ranges.

    `.xlsx`/`.xlsm` hidden and veryHidden sheets are intentionally skipped so
    normal search/version review follows what users see in Excel.  Legacy `.xls`
    files use the available pandas/xlrd sheet list and may include hidden sheets
    because that metadata is not exposed by the current lightweight path.
    """
    ext = Path(path).suffix.lower()
    if ext == ".xls":
        sheet_names = list_sheet_names(path)
        if not sheet_names:
            raise ValueError("Excel 파일에 시트가 없습니다.")
        return [
            _build_used_range(sheet_name, sheet_index, _read_excel_sheet(path, sheet_name).copy())
            for sheet_index, sheet_name in enumerate(sheet_names, start=1)
        ]

    with zipfile.ZipFile(path) as archive:
        refs = _xlsx_sheet_refs_from_archive(archive)
        if not refs:
            raise ValueError("Excel 파일에 시트가 없습니다.")
        shared_strings = _xlsx_shared_strings(archive)
        date_style_ids = _xlsx_date_style_ids(archive)
        date_system = _xlsx_date_system(archive)
        ranges: List[ExcelUsedRange] = []
        for sheet_index, (current_sheet_name, sheet_path) in enumerate(refs, start=1):
            raw = _xlsx_read_sheet_from_archive(
                archive,
                sheet_path,
                shared_strings,
                date_style_ids,
                date_system,
            ).copy()
            ranges.append(_build_used_range(current_sheet_name, sheet_index, raw))
        return ranges


def extract_excel_used_range(path: str, sheet_name: Optional[str] = None) -> Tuple["pd.DataFrame", RangeConfig]:
    """Return one visible sheet's source-coordinate used range."""
    used_ranges = extract_excel_used_ranges(path)
    selected = next((item for item in used_ranges if item.sheet_name == sheet_name), None) if sheet_name else None
    if selected is None:
        selected = next((item for item in used_ranges if item.non_empty_cell_count > 0), used_ranges[0])
    return selected.dataframe, selected.range_config


def inspect_excel_file(path: str) -> Dict[str, Any]:
    df, _config = extract_excel_used_range(path)
    if df.empty:
        return {
            "columns": [],
            "sample": [],
        }

    header_values = [_stringify(value) for value in df.iloc[0].tolist()]
    columns = [
        header if header else str(fallback)
        for header, fallback in zip(header_values, df.columns.tolist())
    ]
    sample: List[List[str]] = []
    for _, row in df.iloc[1:].head(5).iterrows():
        sample.append([_stringify(value) for value in row.tolist()])
    return {
        "columns": columns,
        "sample": sample,
    }
