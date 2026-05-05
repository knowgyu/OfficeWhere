# OfficeWhere 문서 목차

이 디렉터리는 현재 제품 설명, 개발 의사결정, 테스트/릴리스 절차를 분리해 보관합니다. 최신 사용자용 요약은 루트 [`README.md`](../README.md)를 기준으로 하고, 이 파일은 개발자가 어떤 문서를 먼저 볼지 정하는 색인입니다.

## 현재 제품 기준

- 앱 이름과 패키지 이름은 **OfficeWhere**입니다.
- 현재 등록/검색 대상은 `.xlsx`, `.docx`, `.pptx`입니다. Text/Markdown 과거 색인은 새로고침 시 app-owned DB에서 정리되며 원본 파일은 건드리지 않습니다.
- 원본 문서는 읽기 전용입니다. 앱 데이터 초기화는 DB·검색 데이터·캐시만 대상으로 해야 합니다.
- Windows x64와 macOS arm64 배포를 만들며, Linux 패키지는 아직 제공하지 않습니다.
- macOS arm64 배포는 빌드 시 `python-runtime/mac-arm64`를 준비하지만, 생성된 runtime 바이너리는 git에 vendoring하지 않습니다.
- 기본 프론트엔드 CI는 `.github/workflows/frontend-tests.yml`에서 renderer build, Electron main build, E2E TypeScript check, Vitest를 실행합니다.

## 먼저 볼 문서

| 목적 | 문서 |
| --- | --- |
| 사용자/배포 개요 | [`../README.md`](../README.md) |
| 릴리스 전 확인 | [`release-test-checklist.md`](release-test-checklist.md) |
| 테스트를 어디에 추가할지 | [`test-guidelines.md`](test-guidelines.md) |
| 시스템/테스트 구조 한눈에 보기 | [`test-architecture-guide.md`](test-architecture-guide.md) |
| Electron 패키징/업데이트/bridge | [`electron-migration.md`](electron-migration.md) |
| macOS/Linux E2E CI 후속 청사진 | [`ci-workflows-todo.md`](ci-workflows-todo.md) |
| 현재 backlog | [`TODO.md`](TODO.md) |

## 의사결정 기록

| 영역 | 문서 | 상태 |
| --- | --- | --- |
| 검색/색인 성능 | [`indexing-performance-fast-mode.md`](indexing-performance-fast-mode.md), [`performance-experiment-log.md`](performance-experiment-log.md) | 현재 구조의 배경 기록 |
| 검색/버전 hot path | [`search-version-performance-roadmap.md`](search-version-performance-roadmap.md) | 후속 작업용 결정 기록 |
| 검색/버전 UX | [`search-version-ux-notes.md`](search-version-ux-notes.md) | UI 용어/노출 원칙 |
| backend 책임 분리 | [`backend-python-boundary-refactor-plan.md`](backend-python-boundary-refactor-plan.md), [`architecture-review-roadmap.md`](architecture-review-roadmap.md) | facade-first refactor 방향 |
| 중복/본문 서명 | [`content-fingerprint-roadmap.md`](content-fingerprint-roadmap.md) | file-level fingerprint 결정 기록 |
| Word 페이지 표시 | [`word-page-comparison-notes.md`](word-page-comparison-notes.md) | best-effort 페이지 라벨 한계 |
| 버전 첫 로드 | [`version-management-first-load-plan.md`](version-management-first-load-plan.md) | DB-backed derived index 구현 기록 |

## 릴리스 노트

버전별 사용자-facing 변경 사항은 [`releases/`](releases/)에 보관합니다. 이미 태그가 찍힌 버전 문서는 역사 기록으로 보고, 현재 main의 후속 변경은 [`releases/unreleased.md`](releases/unreleased.md)에 임시로 모은 뒤 다음 릴리스 문서로 옮깁니다.
