import os
import subprocess
import sys

from openpyxl import Workbook

from backend.core import excel_analysis
from backend.core.file_access import inspect_file_path


def test_backend_startup_import_does_not_load_pandas():
    env = os.environ.copy()
    env["PYTHONPATH"] = os.getcwd()
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import sys; import backend.main; print('pandas' in sys.modules)",
        ],
        cwd=os.getcwd(),
        env=env,
        text=True,
        capture_output=True,
        check=True,
    )

    assert result.stdout.strip() == "False"


def test_excel_inspect_opens_xlsx_as_read_only(monkeypatch, tmp_path):
    path = tmp_path / "sample.xlsx"
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.append(["과제명", "담당자"])
    worksheet.append(["A", "Kim"])
    workbook.save(path)

    calls = []
    real_load_workbook = excel_analysis.load_workbook

    def spy_load_workbook(*args, **kwargs):
        calls.append(kwargs)
        return real_load_workbook(*args, **kwargs)

    monkeypatch.setattr(excel_analysis, "load_workbook", spy_load_workbook)

    result = inspect_file_path(str(path))

    assert result["columns"] == ["과제명", "담당자"]
    assert calls
    assert all(call.get("read_only") is True for call in calls)


def test_excel_discovery_keeps_full_end_row_when_scan_is_bounded(tmp_path):
    path = tmp_path / "large.xlsx"
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.append(["과제명", "담당자"])
    for idx in range(excel_analysis.HEADER_SCAN_ROW_BUDGET + 20):
        worksheet.append([f"A{idx}", "Kim"])
    workbook.save(path)

    result = inspect_file_path(str(path))

    assert result["parser_config"]["end_row"] == excel_analysis.HEADER_SCAN_ROW_BUDGET + 21
    assert result["sample"][0] == ["A0", "Kim"]
