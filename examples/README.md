# Demo Cases

`examples/demo_cases/` 는 수동 검증용 샘플 입력 문서가 생성되는 위치입니다.

생성:

```bash
source venv/bin/activate
python scripts/generate_demo_cases.py
```

한 번에 비교 동작 확인:

```bash
python scripts/run_demo_checks.py
```

생성되는 예제:

- `excel_budget_v1.xlsx`, `excel_budget_v2.xlsx`
  - 실제 표 시작 위치가 `C3`
  - 값 변경, key 추가/삭제, 컬럼 추가 포함
- `proposal_note_v1.docx`, `proposal_note_v2.docx`
  - 문단 수정 + 표 행 변경
- `status_review_v1.pptx`, `status_review_v2.pptx`
  - 슬라이드 추가 + 슬라이드 내부 텍스트 변경
