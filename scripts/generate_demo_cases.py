from __future__ import annotations

import shutil
from pathlib import Path

from docx import Document
from openpyxl import Workbook
from pptx import Presentation
from pptx.util import Inches


ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = ROOT / "examples" / "demo_cases"
MANUAL_LIBRARY_DIR = ROOT / "examples" / "officewhere_test_library"


def build_excel_cases() -> None:
    base_path = OUTPUT_DIR / "excel_budget_v1.xlsx"
    rev_path = OUTPUT_DIR / "excel_budget_v2.xlsx"

    for path, revision in ((base_path, 1), (rev_path, 2)):
        wb = Workbook()
        ws = wb.active
        ws.title = "사업현황"

        ws["A1"] = "2026 상반기 사업 현황"
        ws["A2"] = "실제 표는 C3부터 시작한다."

        headers = ["과제명", "담당자", "예산", "상태"]
        if revision == 2:
            headers.append("리스크")

        for offset, header in enumerate(headers, start=3):
            ws.cell(row=3, column=offset, value=header)

        rows = [
            ["AI 플랫폼 구축", "김철수", 320000000, "진행중"],
            ["데이터 허브 고도화", "이영희", 180000000, "완료"],
            ["보안 체계 개편", "박민수", 95000000, "검토중"],
        ]

        if revision == 2:
            rows = [
                ["AI 플랫폼 구축", "김철수", 300000000, "진행중", "예산 조정"],
                ["데이터 허브 고도화", "이영희", 180000000, "완료", ""],
                ["차세대 포털 전환", "최은지", 210000000, "신규", "일정 확인 필요"],
            ]

        for row_index, row in enumerate(rows, start=4):
            for col_index, value in enumerate(row, start=3):
                ws.cell(row=row_index, column=col_index, value=value)

        ws.column_dimensions["A"].width = 24
        ws.column_dimensions["C"].width = 18
        ws.column_dimensions["D"].width = 14
        ws.column_dimensions["E"].width = 14
        ws.column_dimensions["F"].width = 18
        wb.save(path)


def build_word_cases() -> None:
    base_path = OUTPUT_DIR / "proposal_note_v1.docx"
    rev_path = OUTPUT_DIR / "proposal_note_v2.docx"

    doc = Document()
    doc.add_heading("클라우드 전환 검토", level=1)
    doc.add_paragraph("본 문서는 1차 초안이다.")
    doc.add_paragraph("예산 검토는 5월 말까지 완료한다.")
    table = doc.add_table(rows=3, cols=2)
    table.cell(0, 0).text = "항목"
    table.cell(0, 1).text = "내용"
    table.cell(1, 0).text = "담당"
    table.cell(1, 1).text = "플랫폼팀"
    table.cell(2, 0).text = "승인"
    table.cell(2, 1).text = "대기"
    doc.save(base_path)

    doc = Document()
    doc.add_heading("클라우드 전환 검토", level=1)
    doc.add_paragraph("본 문서는 2차 수정본이다.")
    doc.add_paragraph("예산 검토는 6월 첫째 주까지 완료한다.")
    doc.add_paragraph("보안 검토 항목이 추가되었다.")
    table = doc.add_table(rows=4, cols=2)
    table.cell(0, 0).text = "항목"
    table.cell(0, 1).text = "내용"
    table.cell(1, 0).text = "담당"
    table.cell(1, 1).text = "플랫폼팀"
    table.cell(2, 0).text = "승인"
    table.cell(2, 1).text = "완료"
    table.cell(3, 0).text = "보안"
    table.cell(3, 1).text = "추가 검토 필요"
    doc.save(rev_path)


def _add_slide(prs: Presentation, title: str, body_lines: list[str]) -> None:
    layout = prs.slide_layouts[1]
    slide = prs.slides.add_slide(layout)
    slide.shapes.title.text = title
    text_frame = slide.placeholders[1].text_frame
    text_frame.clear()
    for index, line in enumerate(body_lines):
        paragraph = text_frame.paragraphs[0] if index == 0 else text_frame.add_paragraph()
        paragraph.text = line


def build_ppt_cases() -> None:
    base_path = OUTPUT_DIR / "status_review_v1.pptx"
    rev_path = OUTPUT_DIR / "status_review_v2.pptx"

    prs = Presentation()
    _add_slide(prs, "프로젝트 개요", ["범위 정의 완료", "예산 검토 진행중"])
    _add_slide(prs, "주요 일정", ["5월: 요구사항 확정", "6월: 구현 시작"])
    prs.save(base_path)

    prs = Presentation()
    _add_slide(prs, "프로젝트 개요", ["범위 정의 완료", "예산 검토 완료"])
    _add_slide(prs, "위험 요소", ["인력 확보 지연", "외부 연동 일정 미정"])
    _add_slide(prs, "주요 일정", ["5월: 요구사항 확정", "6월: 구현 시작", "7월: 사용자 테스트"])
    prs.save(rev_path)


def _save_word_document(
    path: Path,
    heading: str,
    paragraphs: list[str],
    table_rows: list[tuple[str, str]] | None = None,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    doc = Document()
    doc.add_heading(heading, level=1)
    for paragraph in paragraphs:
        doc.add_paragraph(paragraph)
    if table_rows:
        table = doc.add_table(rows=len(table_rows), cols=2)
        for row_index, (label, value) in enumerate(table_rows):
            table.cell(row_index, 0).text = label
            table.cell(row_index, 1).text = value
    doc.save(path)


def _save_budget_workbook(path: Path, revision: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    wb = Workbook()
    ws = wb.active
    ws.title = "예산현황"

    ws["A1"] = "2026 문서 검색/정합성 고도화 예산"
    ws["A2"] = "앱의 엑셀 표 위치 자동 감지를 확인하기 위해 표는 C4부터 시작한다."

    headers = ["과제명", "담당자", "예산", "상태"]
    if revision == 2:
        headers.append("변경사유")

    for offset, header in enumerate(headers, start=3):
        ws.cell(row=4, column=offset, value=header)

    rows: list[list[str | int]] = [
        ["DFBA 검색 고도화", "김철수", 120000000, "진행중"],
        ["Office 정합성 검사", "이영희", 85000000, "검토중"],
        ["배포 자동화", "박민수", 45000000, "예정"],
    ]
    if revision == 2:
        rows = [
            ["DFBA 검색 고도화", "김철수", 135000000, "진행중", "예산 조정"],
            ["Office 정합성 검사", "이영희", 85000000, "완료", "검증 완료"],
            ["사용자 교육 자료", "최은지", 30000000, "신규", "현장 요청 추가"],
        ]

    for row_index, row in enumerate(rows, start=5):
        for col_index, value in enumerate(row, start=3):
            ws.cell(row=row_index, column=col_index, value=value)

    for column in ("A", "C", "D", "E", "F", "G"):
        ws.column_dimensions[column].width = 18
    wb.save(path)


def _save_common_form(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    wb = Workbook()
    ws = wb.active
    ws.title = "공통양식"
    ws.append(["문서ID", "제목", "담당자", "확인상태"])
    ws.append(["FORM-001", "공통양식 배포 확인", "총무팀", "동일본 확인용"])
    ws.append(["FORM-002", "DFBA 교육 참석자", "교육팀", "확인 완료"])
    for column in ("A", "B", "C", "D"):
        ws.column_dimensions[column].width = 20
    wb.save(path)


def _save_project_status_deck(path: Path, revision: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    prs = Presentation()
    if revision == 1:
        _add_slide(prs, "DFBA 프로젝트 상태", ["검색 범위 옵션 설계", "정합성 그룹 기준 검토"])
        _add_slide(prs, "다음 일정", ["260419 기준: 내부 테스트 준비", "위험: 엑셀 예산 확정 전"])
    else:
        _add_slide(prs, "DFBA 프로젝트 상태", ["본문만 검색 배포 완료", "Office 정합성 그룹 기준 적용"])
        _add_slide(prs, "위험 요소", ["일정 지연 가능성 감소", "현장 사용자 교육 필요"])
        _add_slide(prs, "다음 일정", ["260426 기준: 사용자 검증", "릴리즈 체크리스트 완료"])
    prs.save(path)


def build_manual_test_library() -> None:
    """Build a realistic folder tree that can be registered in the app."""
    if MANUAL_LIBRARY_DIR.exists():
        shutil.rmtree(MANUAL_LIBRARY_DIR)
    MANUAL_LIBRARY_DIR.mkdir(parents=True)

    _save_word_document(
        MANUAL_LIBRARY_DIR / "01_보고서" / "주간보고_v1.0_260419.docx",
        "주간보고",
        [
            "260419 기준 DFBA 검색 고도화는 설계 단계이다.",
            "본문만 검색과 파일명 검색을 분리하는 방안을 검토한다.",
            "보안 검토는 다음 주에 시작한다.",
        ],
        [("작성자", "운영팀"), ("상태", "초안")],
    )
    _save_word_document(
        MANUAL_LIBRARY_DIR / "01_보고서" / "주간보고_v1.1_260426.docx",
        "주간보고",
        [
            "260426 기준 DFBA 검색 고도화는 구현 완료 상태이다.",
            "본문만 검색으로 예산 조정, 보안 검토 같은 본문 키워드를 찾을 수 있다.",
            "보안 검토 항목이 추가되었고 사용자 테스트를 시작한다.",
        ],
        [("작성자", "운영팀"), ("상태", "검토 완료"), ("추가", "보안 검토 포함")],
    )

    _save_project_status_deck(
        MANUAL_LIBRARY_DIR / "01_보고서" / "프로젝트상태_v1.0.pptx",
        revision=1,
    )
    _save_project_status_deck(
        MANUAL_LIBRARY_DIR / "01_보고서" / "프로젝트상태_v1.1_260426.pptx",
        revision=2,
    )

    _save_budget_workbook(
        MANUAL_LIBRARY_DIR / "02_예산" / "사업예산_v1.0_260419.xlsx",
        revision=1,
    )
    _save_budget_workbook(
        MANUAL_LIBRARY_DIR / "02_예산" / "사업예산_v1.1_260426.xlsx",
        revision=2,
    )

    _save_word_document(
        MANUAL_LIBRARY_DIR / "03_부서A" / "회의록.docx",
        "회의록",
        [
            "부서A 회의록: 영업 자료 검토와 DFBA 데모 준비가 주요 안건이다.",
            "다음 주까지 고객 안내 문구를 확정한다.",
        ],
        [("부서", "A"), ("결론", "데모 준비")],
    )
    _save_word_document(
        MANUAL_LIBRARY_DIR / "04_부서B" / "회의록.docx",
        "회의록",
        [
            "부서B 회의록: 개발 일정 지연과 예산 조정 요청이 주요 안건이다.",
            "260426 기준으로 리스크 보고서를 갱신한다.",
        ],
        [("부서", "B"), ("결론", "예산 조정")],
    )
    _save_common_form(MANUAL_LIBRARY_DIR / "03_부서A" / "공통양식.xlsx")
    _save_common_form(MANUAL_LIBRARY_DIR / "04_부서B" / "공통양식.xlsx")

    search_dir = MANUAL_LIBRARY_DIR / "05_검색샘플"
    search_dir.mkdir(parents=True, exist_ok=True)
    (search_dir / "운영메모.txt").write_text(
        "DFBA 현장 테스트 메모\n"
        "- 본문만 검색에서 이 문장이 검색되어야 한다.\n"
        "- 파일명에는 DFBA가 없으므로 파일명만 검색에서는 잡히지 않는 것이 정상이다.\n",
        encoding="utf-8",
    )
    (search_dir / "릴리즈체크리스트.md").write_text(
        "# 릴리즈 체크리스트\n\n"
        "- 본문만 검색: `보안 검토`, `예산 조정`, `DFBA` 확인\n"
        "- 정합성 검사: 같은 파일명/다른 내용, 버전 이력 그룹 확인\n",
        encoding="utf-8",
    )
    (MANUAL_LIBRARY_DIR / "README_테스트방법.md").write_text(
        "# OfficeWhere 실제 사례 테스트 라이브러리\n\n"
        "앱에서 이 폴더를 문서 폴더로 추가한 뒤 재스캔하세요.\n\n"
        "## 검색 확인 키워드\n"
        "- `DFBA`: Word/PPT/TXT/MD 본문 검색 확인\n"
        "- `예산 조정`: Excel v1.1과 부서B 회의록 본문 검색 확인\n"
        "- `회의록`: 파일명 검색 확인\n\n"
        "## 정합성 확인 시나리오\n"
        "- `회의록.docx`: 부서A/부서B에 같은 파일명이지만 내용이 다른 문서\n"
        "- `공통양식.xlsx`: 부서A/부서B에 같은 파일명이고 내용도 같은 문서\n"
        "- `주간보고`, `프로젝트상태`, `사업예산`: v1.0/v1.1 또는 날짜가 붙은 버전 이력 문서\n",
        encoding="utf-8",
    )


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    build_excel_cases()
    build_word_cases()
    build_ppt_cases()
    build_manual_test_library()
    print(f"demo cases written to {OUTPUT_DIR}")
    print(f"manual test library written to {MANUAL_LIBRARY_DIR}")


if __name__ == "__main__":
    main()
