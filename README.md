# OfficeWhere

<p align="center">
  <img src="frontend/public/officewhere-logo.png" alt="OfficeWhere" width="140" />
</p>

<p align="center">
  흩어진 Excel, Word, PowerPoint 문서를 <b>찾고</b>, 수정본의 <b>바뀐 내용</b>을 보고, 이름만 다른 <b>같은 내용 문서</b>를 확인하는 데스크톱 앱입니다.
</p>

<p align="center">
  <a href="../../releases">다운로드</a> · <a href="docs/README.md">문서</a> · <a href="docs/release-test-checklist.md">릴리스 체크리스트</a>
</p>

![OfficeWhere overview](docs/assets/readme-overview.svg)

## 한눈에 보기

| 기능 | 할 수 있는 일 |
| --- | --- |
| 문서 검색 | 파일명뿐 아니라 Excel 셀, Word 문단/표, PowerPoint 슬라이드 안의 단어까지 검색합니다. |
| 변경 이력 | 비슷한 이름의 수정본을 묶고 PPT 슬라이드, Word 문단, Excel 셀에서 바뀐 내용을 보여줍니다. |
| 같은 내용 문서 | 파일명은 달라도 본문이 같은 문서를 전용 페이지에서 묶음으로 확인합니다. |
| 원본 보호 | 원본 문서를 복사·수정·삭제하지 않고, 앱 데이터만 별도로 저장합니다. |

## 지원 파일

| 형식 | 검색 | 변경 이력 |
| --- | --- | --- |
| `.xlsx` | 셀 내용 | 셀 값 추가·삭제·수정 |
| `.docx` | 문단·표 | 문단·표 변경 |
| `.pptx` | 슬라이드·표 | 슬라이드·항목 변경 |

## 다운로드해서 실행

- Windows: `officewhere-vX.Y.Z-windows-x64.zip` 압축 해제 후 `OfficeWhere.exe` 실행
- macOS Apple Silicon: `officewhere-vX.Y.Z-mac-arm64.dmg` 또는 `.zip` 실행
- Linux 패키지는 아직 제공하지 않습니다.

> macOS에서 “앱이 손상되어 열 수 없습니다”가 뜨면 아직 서명/공증되지 않은 앱이라서 그렇습니다. 자세한 우회 방법은 [릴리스 체크리스트](docs/release-test-checklist.md)와 릴리스 노트를 참고하세요.

## 직접 실행 / 빌드

```bash
# 웹 개발 모드
./setup.sh
./dev-web.sh

# 데스크톱 패키지
./build.sh
```

Windows에서는 같은 순서로 `setup.bat`, `dev-web.bat`, `build.bat`을 사용합니다.

## 개발 참고

- 문서 목차: [`docs/README.md`](docs/README.md)
- 테스트 기준: [`docs/test-guidelines.md`](docs/test-guidelines.md)
- 릴리스 검증: [`docs/release-test-checklist.md`](docs/release-test-checklist.md)

## 라이선스

GPL-3.0-only. 자세한 내용은 [LICENSE](LICENSE)를 참고하세요.
