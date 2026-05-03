from __future__ import annotations

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.core.checker import run_consistency_check
from scripts.generate_demo_cases import OUTPUT_DIR, build_excel_cases, build_ppt_cases, build_word_cases


def ensure_demo_cases() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    build_excel_cases()
    build_word_cases()
    build_ppt_cases()


def run_excel_demo() -> None:
    file_v1 = OUTPUT_DIR / "excel_budget_v1.xlsx"
    file_v2 = OUTPUT_DIR / "excel_budget_v2.xlsx"
    compare_result = run_consistency_check(
        [
            {'id': 1, 'path': str(file_v1), 'name': file_v1.name, 'file_type': 'Excel'},
            {'id': 2, 'path': str(file_v2), 'name': file_v2.name, 'file_type': 'Excel'},
        ]
    )
    print("[excel] compare issues:", len(compare_result["excel"]["issues"]))


def run_word_demo() -> None:
    file_v1 = OUTPUT_DIR / "proposal_note_v1.docx"
    file_v2 = OUTPUT_DIR / "proposal_note_v2.docx"
    result = run_consistency_check(
        [
            {'id': 1, 'path': str(file_v1), 'name': file_v1.name, 'file_type': 'Word'},
            {'id': 2, 'path': str(file_v2), 'name': file_v2.name, 'file_type': 'Word'},
        ]
    )
    print("[word] diff changes:", len(result["word"]["changes"]))


def run_ppt_demo() -> None:
    file_v1 = OUTPUT_DIR / "status_review_v1.pptx"
    file_v2 = OUTPUT_DIR / "status_review_v2.pptx"
    result = run_consistency_check(
        [
            {'id': 1, 'path': str(file_v1), 'name': file_v1.name, 'file_type': 'PowerPoint'},
            {'id': 2, 'path': str(file_v2), 'name': file_v2.name, 'file_type': 'PowerPoint'},
        ]
    )
    print("[ppt] slide changes:", len(result["ppt"]["changes"]))


def main() -> None:
    ensure_demo_cases()
    run_excel_demo()
    run_word_demo()
    run_ppt_demo()
    print(f"demo cases ready at {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
