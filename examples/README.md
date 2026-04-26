# Demo Cases

`examples/demo_cases/` 는 비교 엔진 검증용 샘플 입력 문서가 생성되는 위치입니다.
`examples/officewhere_test_library/` 는 앱 화면에서 검색/정합성을 실제 사례처럼 확인하기 위한
폴더형 테스트 라이브러리입니다.
바이너리 자체는 리포지토리에 포함하지 않으며, 필요할 때 아래 명령으로 새로 만듭니다.

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

- `excel_budget_v1.xlsx` ~ `excel_budget_v4.xlsx`
  - 실제 표 시작 위치가 `C3`
  - 값 변경, key 추가/삭제, 컬럼 추가 포함
- `proposal_note_v1.docx` ~ `proposal_note_v4.docx`
  - 문단 수정 + 표 행 변경
- `status_review_v1.pptx` ~ `status_review_v4.pptx`
  - 슬라이드 추가 + 슬라이드 내부 텍스트 변경

앱에서 직접 확인할 때:

1. 앱 실행
2. 문서 폴더에 `examples/officewhere_test_library/` 추가
3. 재스캔 후 아래를 확인

검색 확인:

- `DFBA`: Word/PPT/TXT/MD 본문 검색
- `예산 조정`: Excel v1.1 + 부서B 회의록 본문 검색
- `회의록`: 파일명 검색

정합성 확인:

- `03_부서A/회의록.docx`, `04_부서B/회의록.docx`
  - 파일명은 같지만 내용은 다른 문서
- `03_부서A/공통양식.xlsx`, `04_부서B/공통양식.xlsx`
  - 파일명도 같고 내용도 같은 문서
- `주간보고_v1.0_260419.docx` ~ `주간보고_v4.0_260517.docx`
- `프로젝트상태_v1.0.pptx` ~ `프로젝트상태_v4.0_260517.pptx`
- `사업예산_v1.0_260419.xlsx` ~ `사업예산_v4.0_260517.xlsx`
  - 버전/날짜가 붙은 같은 문서 계열
