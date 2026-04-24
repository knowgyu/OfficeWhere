from __future__ import annotations

from pathlib import Path

from docx import Document
from openpyxl import Workbook
from pptx import Presentation
from pptx.util import Inches


ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = ROOT / "examples" / "demo_cases"


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


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    build_excel_cases()
    build_word_cases()
    build_ppt_cases()
    print(f"demo cases written to {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
