from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any, Dict, Iterable, List, Optional, Tuple

from openpyxl import load_workbook
from openpyxl.utils import get_column_letter

if TYPE_CHECKING:
    import pandas as pd


ParserConfig = Dict[str, Any]
HEADER_SCAN_LIMIT = 30
HEADER_SCAN_ROW_BUDGET = 500


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


@contextmanager
def _open_xlsx_workbook(path: str):
    workbook = load_workbook(path, read_only=True, data_only=True)
    try:
        yield workbook
    finally:
        workbook.close()


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

    bounded_max_row = max_row
    if max_rows is not None:
        row_limit = min_row + max_rows - 1
        bounded_max_row = row_limit if bounded_max_row is None else min(bounded_max_row, row_limit)

    with _open_xlsx_workbook(path) as workbook:
        if sheet_name not in workbook.sheetnames:
            return pd.DataFrame()
        worksheet = workbook[sheet_name]
        rows = [
            list(row)
            for row in worksheet.iter_rows(
                min_row=min_row,
                max_row=bounded_max_row,
                min_col=min_col,
                max_col=max_col,
                values_only=True,
            )
        ]

    return _rows_to_dataframe(rows)


def list_sheet_names(path: str) -> List[str]:
    ext = Path(path).suffix.lower()
    if ext == ".xls":
        pd = _get_pandas()

        try:
            xl = pd.ExcelFile(path, engine="xlrd")
        except ValueError:
            xl = pd.ExcelFile(path)
        return list(xl.sheet_names)

    with _open_xlsx_workbook(path) as workbook:
        return list(workbook.sheetnames)


def _sheet_bounds(path: str, sheet_name: str) -> Tuple[int, int]:
    ext = Path(path).suffix.lower()
    if ext == ".xls":
        df = _read_excel_sheet(path, sheet_name)
        return max(len(df.index), 1), max(len(df.columns), 1)

    with _open_xlsx_workbook(path) as workbook:
        if sheet_name not in workbook.sheetnames:
            return 1, 1
        worksheet = workbook[sheet_name]
        return max(worksheet.max_row or 1, 1), max(worksheet.max_column or 1, 1)


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
