from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

import pandas as pd
from openpyxl import load_workbook
from openpyxl.utils.cell import range_boundaries


ParserConfig = Dict[str, Any]
HEADER_SCAN_LIMIT = 25


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
    if isinstance(value, float) and pd.isna(value):
        return False
    return str(value).strip() != ""


def _stringify(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and pd.isna(value):
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


def _read_excel_sheet(path: str, sheet_name: str) -> pd.DataFrame:
    ext = Path(path).suffix.lower()
    engine = "xlrd" if ext == ".xls" else "openpyxl"
    try:
        return pd.read_excel(
            path,
            sheet_name=sheet_name,
            header=None,
            dtype=object,
            keep_default_na=False,
            engine=engine,
        )
    except ValueError:
        return pd.read_excel(
            path,
            sheet_name=sheet_name,
            header=None,
            dtype=object,
            keep_default_na=False,
        )


def list_sheet_names(path: str) -> List[str]:
    ext = Path(path).suffix.lower()
    engine = "xlrd" if ext == ".xls" else "openpyxl"
    try:
        xl = pd.ExcelFile(path, engine=engine)
    except ValueError:
        xl = pd.ExcelFile(path)
    return list(xl.sheet_names)


def _table_candidates_from_defined_tables(path: str) -> List[ExcelTableCandidate]:
    if Path(path).suffix.lower() == ".xls":
        return []

    workbook = load_workbook(path, read_only=False, data_only=True)
    candidates: List[ExcelTableCandidate] = []
    for worksheet in workbook.worksheets:
        for table in worksheet.tables.values():
            start_col, header_row, end_col, end_row = range_boundaries(table.ref)
            width = end_col - start_col + 1
            height = max(end_row - header_row, 1)
            score = 10_000 + (width * 10) + height
            candidates.append(
                ExcelTableCandidate(
                    sheet_name=worksheet.title,
                    header_row=header_row,
                    start_col=start_col,
                    end_col=end_col,
                    end_row=end_row,
                    score=score,
                )
            )
    workbook.close()
    return candidates


def _find_band_end(df: pd.DataFrame, header_idx: int, start_col_idx: int, end_col_idx: int) -> int:
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


def _score_candidate(df: pd.DataFrame, header_idx: int, start_col_idx: int, end_col_idx: int) -> float:
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
    df = _read_excel_sheet(path, sheet_name)
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
        candidates.append(
            ExcelTableCandidate(
                sheet_name=sheet_name,
                header_row=header_idx + 1,
                start_col=start_col_idx + 1,
                end_col=end_col_idx + 1,
                end_row=end_idx + 1,
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

    df = _read_excel_sheet(path, sheet_names[0])
    row_count = max(len(df.index), 1)
    col_count = max(len(df.columns), 1)
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

    df = _read_excel_sheet(path, sheet_name)
    row_count = max(len(df.index), 1)
    col_count = max(len(df.columns), 1)

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


def extract_excel_table(path: str, parser_config: Optional[ParserConfig]) -> pd.DataFrame:
    config = normalize_excel_parser_config(path, parser_config)
    df = _read_excel_sheet(path, config["sheet_name"])

    row_start = config["header_row"] - 1
    row_end = config["end_row"]
    col_start = config["start_col"] - 1
    col_end = config["end_col"]

    table_slice = df.iloc[row_start:row_end, col_start:col_end].copy()
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
