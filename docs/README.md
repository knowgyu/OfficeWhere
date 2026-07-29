# OfficeWhere 문서

이 디렉터리는 새로 합류한 사람이 제품 구조와 검증 절차를 빠르게 이해하는 데 필요한 문서만 둡니다. 작업 중 생긴 세부 결정 기록과 과거 버전 설명은 저장소 문서가 아니라 OMX wiki / GitHub Releases에서 관리합니다.

## 현재 기준

- 앱 이름은 **OfficeWhere**입니다.
- 지원하는 등록/검색 대상은 Excel(`.xlsx`), Word(`.docx`), PowerPoint(`.pptx`), PDF(`.pdf`)입니다. PDF는 텍스트 검색 대상이며 변경 이력 비교 대상은 아닙니다.
- 원본 문서는 읽기 전용입니다. 앱은 경로, 메타데이터, 색인, 비교 캐시, 설정만 앱 데이터 영역에 저장합니다.
- Windows x64와 macOS arm64 배포를 만듭니다. Linux 패키지는 아직 제공하지 않습니다.
- 릴리스 이력은 저장소의 markdown 파일이 아니라 GitHub Releases를 기준으로 봅니다.

## 문서 목록

| 목적 | 문서 |
| --- | --- |
| 사용자/배포 개요 | [`../README.md`](../README.md) |
| 전체 구조와 주요 데이터 흐름 | [`architecture.md`](architecture.md) |
| 테스트를 어디에 추가할지 | [`test-guidelines.md`](test-guidelines.md) |
| 릴리스 전 자동/수동 확인 | [`release-test-checklist.md`](release-test-checklist.md) |
| 최근 릴리스 노트 | [`releases/v0.16.1.md`](releases/v0.16.1.md) |
| Electron 패키징/업데이트/bridge | [`electron-migration.md`](electron-migration.md) |

## 문서 관리 원칙

- 사람이 직접 읽을 문서는 한국어로 짧게 유지합니다.
- 추적할 장기 의사결정은 `omx_wiki/`에 보관합니다. `.omx/`는 로컬 실행 상태와 인계 자료이므로 제품 문서의 source of truth로 쓰지 않습니다.
- 새 기능을 추가해 API/DB/UI 계약이 바뀌면 `architecture.md`, `test-guidelines.md`, `release-test-checklist.md` 중 실제로 영향을 받는 문서만 갱신합니다.
