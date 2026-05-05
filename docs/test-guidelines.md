# OfficeWhere 테스트 가이드

기능을 추가하거나 계약을 바꿀 때 어떤 테스트를 갱신할지 정리한 문서입니다. 기본 원칙은 “사용자가 보는 동작을 작은 테스트로 먼저 고정하고, 필요한 빌드/타입 검증을 마지막에 돌린다”입니다.

## 빠른 선택표

| 변경 영역 | 우선 추가/갱신할 테스트 |
| --- | --- |
| `backend/database.py`, `backend/core/*` | 관련 `tests/test_*.py` pytest |
| `backend/api/*` endpoint | router 함수 pytest + frontend API/MSW fixture |
| `backend/models/schemas.py` 응답 필드 | backend pytest + `frontend/src/api/*.ts` 타입 + MSW fixture + build |
| `frontend/src/api/*` | `frontend/src/api/*.test.ts` |
| React context | `frontend/src/contexts/*.test.tsx` |
| React component | 같은 폴더의 `*.test.tsx`, 필요하면 E2E |
| Electron main/preload IPC | `frontend/tests/e2e/ipc.*.spec.ts` + `npm run build:electron` |
| packaging/workflow | `tests/test_runtime_packaging.py` + workflow YAML 정적 검증 |
| copy/UI tone only | role/aria 기반 테스트가 깨지는지 확인하고 필요한 텍스트 테스트만 갱신 |

## 자주 쓰는 검증 명령

```bash
./venv/bin/python -m pytest -q
./venv/bin/python -m compileall backend backend_server.py -q
./venv/bin/python scripts/run_demo_checks.py
cd frontend && npm run build
cd frontend && npm run build:electron
cd frontend && npm run test:run
cd frontend && npx tsc -p tsconfig.e2e.json
git diff --check
```

변경 범위가 작으면 관련 테스트를 먼저 돌리고, 릴리스 전이나 넓은 리팩터링 뒤에는 전체 명령을 순서대로 실행합니다.

## Backend 테스트 패턴

- DB 테스트는 `tmp_path`로 `backend.database.DB_PATH`와 `DB_DIR`를 monkeypatch한 뒤 `init_db()`를 호출합니다.
- 원본 문서 안전성 테스트는 파일이 실제로 남아 있는지까지 확인합니다.
- 문서 새로고침 테스트는 `backend.core.library._collect_supported_paths_with_stats`와 `inspect_and_chunk`를 monkeypatch해 느린 Office parser 없이 상태 전이를 검증합니다.
- 검색/중복/버전 그룹은 app-owned DB 파생 데이터가 결과에서 빠지거나 포함되는 경계를 명확히 검증합니다.

## Frontend 테스트 패턴

- API client는 MSW로 URL, query string, request body를 확인합니다.
- 새 endpoint나 응답 타입을 추가하면 `frontend/src/test/msw/handlers.ts`의 기본 fixture도 갱신합니다. 이 fixture가 타입 import를 사용하므로 build가 계약 누락을 잡아줍니다.
- Component 테스트는 가능하면 role, label, aria, 사용자 행동 중심으로 작성합니다. 문구 자체가 요구사항일 때만 텍스트 전체를 고정합니다.
- `LibraryRescanProvider`처럼 polling/snackbar side effect가 있는 코드는 fake timer 또는 명시적 status fixture로 완료/실패/취소 분기를 따로 검증합니다.

## Electron / E2E 주의

- Electron E2E는 로컬 OS 라이브러리 영향을 많이 받습니다. Linux에서 `libasound`, GTK/GBM, Xvfb가 없어서 실행이 막히면 제품 회귀가 아니라 환경 미비로 기록합니다.
- IPC handler를 바꾸면 preload bridge와 renderer caller를 함께 확인합니다.
- 패키징 계약은 `tests/test_runtime_packaging.py`가 workflow, runtime 경로, 캐시 키, release asset 이름을 정적으로 고정합니다.

## 누락 원본 파일 관련 회귀 포인트

- 성공적으로 스캔한 root 아래에서만 `missing`으로 표시해야 합니다.
- 실패한 root, 접근 불명확한 subdir, 권한 문제는 누락으로 단정하지 않습니다.
- `missing` 파일은 파일 관리 목록에는 표시하되 검색/중복/버전 그룹/비교 선택에서는 제외합니다.
- 다시 보이면 `recovered`로 복구합니다.
- 7일 이상 계속 누락이면 app-owned DB/index/cache에서만 정리합니다.
