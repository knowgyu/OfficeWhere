# OfficeWhere 릴리스 체크리스트

릴리스 태그를 올리기 전 확인할 항목입니다. 릴리스 설명은 저장소 markdown이 아니라 GitHub Release 본문에 작성합니다.

## 자동 검증

- [ ] `./venv/bin/python -m pytest -q`
- [ ] `./venv/bin/python -m compileall backend backend_server.py -q`
- [ ] `./venv/bin/python scripts/run_demo_checks.py`
- [ ] `cd frontend && npm run build`
- [ ] `cd frontend && npm run build:electron`
- [ ] `cd frontend && npm run test:run`
- [ ] `cd frontend && npm run package:win` (Linux/local smoke only when `python-runtime/win-x64` is present; official Windows asset is built on Windows/GitHub Actions)
- [ ] `cd frontend && npx tsc -p tsconfig.e2e.json`
- [ ] `git diff --check`
- [ ] GitHub `Frontend tests` workflow 통과
- [ ] Windows/macOS 런타임에서 `pypdfium2`와 bundled PDFium(`pypdfium2_raw`) import가 성공하는지 확인한다.

## 문서 등록/검색

- [ ] Excel, Word, PowerPoint, PDF가 섞인 폴더를 등록한다.
- [ ] 파일명 검색, 본문 검색, 파일명+본문 검색이 모두 동작한다.
- [ ] 파일 형식 필터가 검색 결과를 좁힌다.
- [ ] PDF 텍스트가 검색되고, PDF는 버전 비교 후보로 선택되지 않는다.
- [ ] 실제 PDF 샘플에서 텍스트 검색 결과와 페이지 표시가 기대대로 나오는지 확인한다.
- [ ] 검색 결과에서 “이 폴더 숨기기”를 누르면 이번 검색에서만 해당 폴더가 빠진다.
- [ ] 공백 포함 검색어(예: `데이터 연계`)는 같은 순서의 문구를 우선 정확히 찾는다.
- [ ] 문서 새로고침 중 진행률과 완료 요약이 자연스럽게 보인다.
- [ ] 원본이 사라진 등록 파일은 “원본 없음” 상태로 보이고, 검색/중복/버전 비교 후보에서는 빠진다.
- [ ] 원본을 다시 같은 위치에 두고 새로고침하면 사용 가능 상태로 복구된다.

## 버전/중복/비교

- [ ] 같은 파일명이 여러 폴더에 있을 때 “같은 파일명” 그룹이 나온다.
- [ ] `v1.0`, `v1.1`, 날짜/수정본 표기가 있는 파일명이 버전 후보로 묶인다.
- [ ] Word 비교는 페이지 라벨과 기존/변경 후 내용을 표시한다.
- [ ] Excel 비교는 시트/셀 좌표와 표 보기 모달을 표시한다.
- [ ] PowerPoint 비교는 슬라이드 번호/제목 기준 변경을 표시한다.
- [ ] 중복 문서 화면은 같은 본문이지만 다른 파일명인 후보만 보여준다.

## 데이터 안전

- [ ] 검색, 색인, 비교가 원본 문서를 삭제/이동/이름변경/저장하지 않는다.
- [ ] 앱 데이터 초기화 문구가 원본 문서를 삭제하지 않는다고 명확히 설명한다.
- [ ] 앱 데이터 초기화는 앱 DB, 캐시, 로그, 설정 위치만 대상으로 한다.
- [ ] 네트워크/공유 폴더가 일시적으로 끊긴 경우 등록 파일을 즉시 삭제하지 않는다.

## Provider runtime discovery

- [ ] Electron 실행 후 `<userData>/provider-discovery.json`이 생성된다.
- [ ] discovery JSON의 `base_url`은 실제 동적 loopback backend URL을 가리킨다.
- [ ] `health_url`과 `manifest_url`이 `/api/provider/v1/health`, `/api/provider/v1/manifest`를 가리키며 응답 metadata와 일치한다.
- [ ] 종료 후 discovery 파일은 best-effort로 삭제되거나, 남아 있더라도 `pid` + provider health/manifest 검증으로 stale 판정할 수 있다.
- [ ] provider 경로는 source 문서를 삭제/이동/이름변경/저장하지 않고, 새 state-changing endpoint를 추가하지 않는다.

## 데스크톱/업데이트

- [ ] 첫 창 닫기에서 백그라운드 실행/종료/취소 선택이 동작한다.
- [ ] 트레이 메뉴로 다시 열기와 종료가 가능하다.
- [ ] Windows zip에는 `resources/python-runtime/python.exe`와 `resources/backend-source/backend_server.py`가 있다.
- [ ] macOS dmg/zip app bundle에는 `Contents/Resources/python-runtime/bin/python3`와 backend source가 있다.
- [ ] GitHub Release에는 Windows x64 zip, macOS arm64 dmg/zip, 각 SHA256 파일이 있다.
- [ ] Windows 업데이트 다운로드는 SHA256 검증 실패 시 기존 앱을 건드리지 않고 명확한 오류를 보여준다.

## Startup derived-index regression

- 기존 app DB의 `search_index_version` 또는 `excel_index_version`이 오래된 값이어도 앱 창과 backend health가 먼저 열리는지 확인합니다.
- 검색 화면에서 본문 검색 인덱스 업데이트 안내가 표시되고 파일명 검색이 계속 가능한지 확인합니다.
- `index-performance.log`에 `search_index_repair_start` / `search_index_repair_done` 또는 `db_excel_index_repair_*` 이벤트가 남는지 확인합니다.
- 원본 Office 문서가 삭제/수정되지 않았는지 확인합니다.
