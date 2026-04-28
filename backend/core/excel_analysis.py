from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
import posixpath
import re
import zipfile
from typing import TYPE_CHECKING, Any, Dict, Iterable, List, Optional, Tuple
from xml.etree import ElementTree as ET

from openpyxl.utils import get_column_letter

if TYPE_CHECKING:
    import pandas as pd


ParserConfig = Dict[str, Any]
HEADER_SCAN_LIMIT = 30
HEADER_SCAN_ROW_BUDGET = 500
SHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
SHEET_TAG = f"{{{SHEET_NS}}}"
REL_ID = f"{{{REL_NS}}}id"
_CELL_REF_RE = re.compile(r"^([A-Z]+)([0-9]+)$")
_DIMENSION_RE = re.compile(r"^([A-Z]+)([0-9]+)(?::([A-Z]+)([0-9]+))?$")
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


@dataclass
class ExcelTableCandidate:
    sheet_name: str
    header_row: int
    start_col: int
    end_col: int
    end_row: int
    score: float

    def to_dict(self) -> Dict[str, Any]:
        return {
            "sheet_name": self.sheet_name,
            "header_row": self.header_row,
            "start_col": self.start_col,
            "end_col": self.end_col,
            "end_row": self.end_row,
            "score": round(self.score, 3),
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


def _make_unique_headers(values: Iterable[Any]) -> List[str]:
    headers: List[str] = []
    seen: Dict[str, int] = {}
    for idx, value in enumerate(values, start=1):
        header = _stringify(value) or f"column_{idx}"
        count = seen.get(header, 0)
        seen[header] = count + 1
        if count:
            header = f"{header}_{count + 1}"
        headers.append(header)
    return headers


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


def _dimension_to_bounds(ref: str) -> Optional[Tuple[int, int]]:
    match = _DIMENSION_RE.match(ref.upper())
    if not match:
        return None
    start_col, start_row, end_col, end_row = match.groups()
    max_row = int(end_row or start_row)
    max_col = _column_index_from_letters(end_col or start_col)
    return max(max_row, 1), max(max_col, 1)


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


def _xlsx_sheet_refs(path: str) -> List[Tuple[str, str]]:
    with zipfile.ZipFile(path) as archive:
        rel_targets = _xlsx_relationship_targets(archive)
        root = ET.fromstring(archive.read("xl/workbook.xml"))
        refs: List[Tuple[str, str]] = []
        for sheet in root.findall(f".//{SHEET_TAG}sheet"):
            name = sheet.get("name")
            rel_id = sheet.get(REL_ID)
            target = rel_targets.get(rel_id or "")
            if name and target:
                refs.append((name, target))
        return refs


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


def _xlsx_sheet_bounds(path: str, sheet_name: str) -> Tuple[int, int]:
    sheet_path = _xlsx_sheet_path(path, sheet_name)
    with zipfile.ZipFile(path) as archive:
        with archive.open(sheet_path) as source:
            max_row = 1
            max_col = 1
            for event, element in ET.iterparse(source, events=("start", "end")):
                if event == "start" and element.tag == f"{SHEET_TAG}dimension":
                    ref = element.get("ref")
                    if ref:
                        bounds = _dimension_to_bounds(ref)
                        if bounds:
                            return bounds
                if event == "end" and element.tag == f"{SHEET_TAG}c":
                    ref = element.get("r", "")
                    if ref:
                        row_index, col_index = _cell_ref_to_indices(ref)
                        max_row = max(max_row, row_index)
                        max_col = max(max_col, col_index)
                    element.clear()
            return max_row, max_col


def _xlsx_read_sheet(
    path: str,
    sheet_name: str,
    max_rows: Optional[int] = None,
    min_row: int = 1,
    max_row: Optional[int] = None,
    min_col: int = 1,
    max_col: Optional[int] = None,
) -> "pd.DataFrame":
    pd = _get_pandas()
    try:
        sheet_path = _xlsx_sheet_path(path, sheet_name)
    except ValueError:
        return pd.DataFrame()

    bounded_max_row = max_row
    if max_rows is not None:
        row_limit = min_row + max_rows - 1
        bounded_max_row = row_limit if bounded_max_row is None else min(bounded_max_row, row_limit)

    rows_by_number: Dict[int, Dict[int, Any]] = {}
    max_seen_row = min_row - 1
    max_seen_col = min_col - 1

    with zipfile.ZipFile(path) as archive:
        shared_strings = _xlsx_shared_strings(archive)
        date_style_ids = _xlsx_date_style_ids(archive)
        date_system = _xlsx_date_system(archive)
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


def _sheet_bounds(path: str, sheet_name: str) -> Tuple[int, int]:
    ext = Path(path).suffix.lower()
    if ext == ".xls":
        df = _read_excel_sheet(path, sheet_name)
        return max(len(df.index), 1), max(len(df.columns), 1)
    return _xlsx_sheet_bounds(path, sheet_name)


def _table_candidates_from_defined_tables(path: str) -> List[ExcelTableCandidate]:
    # Keep workbook access read-only for startup/indexing performance.  Header
    # discovery below scans only the first HEADER_SCAN_LIMIT rows, which matches
    # OfficeWhere's supported Excel template shape.
    return []


def _find_band_end(df: "pd.DataFrame", header_idx: int, start_col_idx: int, end_col_idx: int) -> int:
    data_started = False
    last_data_idx = header_idx
    for row_idx in range(header_idx + 1, len(df.index)):
        row_values = df.iloc[row_idx, start_col_idx : end_col_idx + 1].tolist()
        row_non_empty = sum(1 for value in row_values if _is_non_empty(value))
        if row_non_empty:
            data_started = True
            last_data_idx = row_idx
            continue
        if data_started:
            break
    return last_data_idx


def _score_candidate(df: "pd.DataFrame", header_idx: int, start_col_idx: int, end_col_idx: int) -> float:
    row_values = df.iloc[header_idx, start_col_idx : end_col_idx + 1].tolist()
    header_values = [_stringify(value) for value in row_values if _is_non_empty(value)]
    if len(header_values) < 2:
        return -1.0

    end_idx = _find_band_end(df, header_idx, start_col_idx, end_col_idx)
    data_row_count = max(end_idx - header_idx, 0)
    span = end_col_idx - start_col_idx + 1
    filled_cells = 0
    if data_row_count:
        data_slice = df.iloc[header_idx + 1 : end_idx + 1, start_col_idx : end_col_idx + 1]
        filled_cells = int(data_slice.map(_is_non_empty).sum().sum())
    density = filled_cells / max(data_row_count * span, 1)
    unique_headers = len(set(header_values))
    title_penalty = 2.5 if len(header_values) <= 1 else 0.0
    return (
        len(header_values) * 2.0
        + unique_headers * 1.5
        + data_row_count * 3.0
        + density * 10.0
        - title_penalty
    )


def _discover_sheet_candidates(path: str, sheet_name: str) -> List[ExcelTableCandidate]:
    sheet_row_count, _ = _sheet_bounds(path, sheet_name)
    df = _read_excel_sheet(path, sheet_name, max_rows=HEADER_SCAN_ROW_BUDGET)
    if df.empty:
        return []

    candidates: List[ExcelTableCandidate] = []
    for header_idx in range(min(len(df.index), HEADER_SCAN_LIMIT)):
        row = df.iloc[header_idx].tolist()
        non_empty_cols = [idx for idx, value in enumerate(row) if _is_non_empty(value)]
        if len(non_empty_cols) < 2:
            continue

        start_col_idx = min(non_empty_cols)
        end_col_idx = max(non_empty_cols)
        score = _score_candidate(df, header_idx, start_col_idx, end_col_idx)
        if score < 0:
            continue

        end_idx = _find_band_end(df, header_idx, start_col_idx, end_col_idx)
        end_row = end_idx + 1
        if end_idx == len(df.index) - 1 and len(df.index) < sheet_row_count:
            end_row = sheet_row_count
        candidates.append(
            ExcelTableCandidate(
                sheet_name=sheet_name,
                header_row=header_idx + 1,
                start_col=start_col_idx + 1,
                end_col=end_col_idx + 1,
                end_row=end_row,
                score=score,
            )
        )

    return candidates


def detect_excel_table_candidates(path: str, limit: int = 5) -> List[Dict[str, Any]]:
    candidates = _table_candidates_from_defined_tables(path)
    if not candidates:
        for sheet_name in list_sheet_names(path):
            candidates.extend(_discover_sheet_candidates(path, sheet_name))

    candidates.sort(key=lambda item: item.score, reverse=True)
    return [candidate.to_dict() for candidate in candidates[:limit]]


def _default_parser_config(path: str) -> ParserConfig:
    candidates = detect_excel_table_candidates(path, limit=1)
    if candidates:
        return candidates[0]

    sheet_names = list_sheet_names(path)
    if not sheet_names:
        raise ValueError("Excel 파일에 시트가 없습니다.")

    row_count, col_count = _sheet_bounds(path, sheet_names[0])
    return {
        "sheet_name": sheet_names[0],
        "header_row": 1,
        "start_col": 1,
        "end_col": col_count,
        "end_row": row_count,
        "score": 0.0,
    }


def _coerce_config_index(value: Any) -> int:
    if isinstance(value, bool):
        raise ValueError("boolean is not a valid parser_config index")
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if value.is_integer():
            return int(value)
        raise ValueError(f"non-integer parser_config index: {value}")

    text = str(value).strip()
    try:
        return int(text)
    except ValueError:
        numeric = float(text)
        if numeric.is_integer():
            return int(numeric)
        raise ValueError(f"non-integer parser_config index: {value}")


def normalize_excel_parser_config(path: str, parser_config: Optional[ParserConfig]) -> ParserConfig:
    config = dict(parser_config or {})
    if not config:
        config = _default_parser_config(path)

    sheet_name = config.get("sheet_name")
    if not sheet_name:
        raise ValueError("parser_config.sheet_name 이 필요합니다.")

    sheet_names = list_sheet_names(path)
    if sheet_name not in sheet_names:
        raise ValueError(f"시트를 찾을 수 없습니다: {sheet_name}")

    row_count, col_count = _sheet_bounds(path, sheet_name)

    try:
        header_row = _coerce_config_index(config["header_row"])
        start_col = _coerce_config_index(config["start_col"])
        end_col = _coerce_config_index(config["end_col"])
        end_row = _coerce_config_index(config["end_row"])
    except KeyError as exc:
        raise ValueError(f"parser_config.{exc.args[0]} 이 필요합니다.") from exc
    except (TypeError, ValueError) as exc:
        raise ValueError("parser_config 숫자 필드는 정수여야 합니다.") from exc

    if header_row < 1 or start_col < 1:
        raise ValueError("parser_config 행/열 인덱스는 1 이상이어야 합니다.")
    if end_col < start_col:
        raise ValueError("parser_config.end_col 은 start_col 이상이어야 합니다.")
    if end_row < header_row:
        raise ValueError("parser_config.end_row 는 header_row 이상이어야 합니다.")
    if header_row > row_count or end_row > row_count:
        raise ValueError("parser_config row 범위가 시트 크기를 벗어났습니다.")
    if start_col > col_count or end_col > col_count:
        raise ValueError("parser_config column 범위가 시트 크기를 벗어났습니다.")

    return {
        "sheet_name": sheet_name,
        "header_row": header_row,
        "start_col": start_col,
        "end_col": end_col,
        "end_row": end_row,
    }


def extract_excel_table(path: str, parser_config: Optional[ParserConfig]) -> "pd.DataFrame":
    import pandas as pd

    config = normalize_excel_parser_config(path, parser_config)
    table_slice = _read_excel_sheet(
        path,
        config["sheet_name"],
        min_row=config["header_row"],
        max_row=config["end_row"],
        min_col=config["start_col"],
        max_col=config["end_col"],
    ).copy()
    if table_slice.empty:
        return pd.DataFrame()

    headers = _make_unique_headers(table_slice.iloc[0].tolist())
    data = table_slice.iloc[1:].copy()
    data.columns = headers
    data = data.reset_index(drop=True)
    data = data.loc[
        data.apply(lambda row: any(_is_non_empty(value) for value in row.tolist()), axis=1)
    ]
    data = data.fillna("")
    return data


def extract_excel_used_range(path: str, sheet_name: Optional[str] = None) -> Tuple["pd.DataFrame", ParserConfig]:
    """Return the actual visible sheet area as an Excel-coordinate table.

    This intentionally ignores the saved parser_config used by Excel integration.
    Version Management needs a read-only, source-coordinate view of the sheet so
    stale registration-time table ranges do not block comparison.
    """
    import pandas as pd

    sheet_names = list_sheet_names(path)
    if not sheet_names:
        raise ValueError("Excel 파일에 시트가 없습니다.")

    selected_sheet = sheet_name if sheet_name in sheet_names else sheet_names[0]
    raw = _read_excel_sheet(path, selected_sheet).copy()
    if raw.empty:
        return pd.DataFrame(), {
            "sheet_name": selected_sheet,
            "header_row": 0,
            "start_col": 1,
            "end_col": 1,
            "end_row": 0,
        }

    raw = raw.fillna("")
    non_empty = raw.map(_is_non_empty)
    non_empty_rows = non_empty.any(axis=1)
    non_empty_cols = non_empty.any(axis=0)

    if not bool(non_empty_rows.any()) or not bool(non_empty_cols.any()):
        return pd.DataFrame(), {
            "sheet_name": selected_sheet,
            "header_row": 0,
            "start_col": 1,
            "end_col": 1,
            "end_row": 0,
        }

    last_row_position = int(non_empty_rows[non_empty_rows].index[-1])
    last_col_position = int(non_empty_cols[non_empty_cols].index[-1])
    used = raw.iloc[: last_row_position + 1, : last_col_position + 1].copy()
    used.columns = [get_column_letter(index) for index in range(1, len(used.columns) + 1)]

    return used, {
        "sheet_name": selected_sheet,
        "header_row": 0,
        "start_col": 1,
        "end_col": len(used.columns),
        "end_row": len(used.index),
    }


def inspect_excel_file(path: str, parser_config: Optional[ParserConfig] = None) -> Dict[str, Any]:
    candidates = detect_excel_table_candidates(path)
    config = normalize_excel_parser_config(path, parser_config or (candidates[0] if candidates else None))
    df = extract_excel_table(path, config)
    sample: List[List[str]] = []
    for _, row in df.head(5).iterrows():
        sample.append([_stringify(value) for value in row.tolist()])

    columns = [str(column) for column in df.columns.tolist()]
    return {
        "parser_config": config,
        "table_candidates": candidates,
        "columns": columns,
        "sample": sample,
    }


def _is_parser_config_validation_error(exc: Exception) -> bool:
    message = str(exc)
    if "parser_config" not in message:
        return False
    return any(
        marker in message
        for marker in (
            "범위",
            "정수",
            "필요",
            "시트를 찾을 수 없습니다",
            "non-integer",
            "invalid",
        )
    )


def inspect_excel_file_with_recovery(
    path: str,
    parser_config: Optional[ParserConfig] = None,
) -> Dict[str, Any]:
    """Inspect Excel integration metadata, recovering stale saved ranges.

    `parser_config` is integration metadata, not a requirement for search or
    version review.  When a saved config points outside the current sheet (or is
    otherwise invalid), fall back to fresh table detection so rescans/previews do
    not fail just because the old integration range became stale.
    """
    try:
        return inspect_excel_file(path, parser_config=parser_config)
    except ValueError as exc:
        if parser_config and _is_parser_config_validation_error(exc):
            return inspect_excel_file(path, parser_config=None)
        raise


def recover_excel_parser_config(
    path: str,
    parser_config: Optional[ParserConfig] = None,
) -> ParserConfig:
    """Return a usable parser config, falling back from stale saved ranges."""
    return inspect_excel_file_with_recovery(path, parser_config=parser_config)["parser_config"]


def extract_excel_table_with_recovery(
    path: str,
    parser_config: Optional[ParserConfig] = None,
) -> "pd.DataFrame":
    config = recover_excel_parser_config(path, parser_config)
    return extract_excel_table(path, config)
