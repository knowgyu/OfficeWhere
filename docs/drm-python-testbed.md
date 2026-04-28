# DRM Python Reader Testbed

목적: 회사 DRM 문서를 OfficeWhere가 `python.exe` 기반 보호 문서 엔진으로 읽을 수 있는지, 구현 전에 빠르게 검증한다.

핵심 판정은 `python-docx`/`openpyxl` 설치 여부가 아니라 **해당 `python.exe` 프로세스가 DRM 문서를 정상 OOXML zip으로 열 수 있는지**다. `scripts/drm_probe.py`는 기본적으로 Python 표준 라이브러리만 사용해 `.docx`, `.xlsx`/`.xlsm`, `.pptx` 내부 XML 파트를 연다.

## 준비물

- DRM이 실제로 걸린 `.docx`, `.xlsx`/`.xlsm`, `.pptx` 샘플 각 1개 이상
- Windows DRM 적용 PC
- OfficeWhere 저장소 또는 `scripts/drm_probe.py` 단일 파일

## 1. 이미 성공한다고 알려진 설치 Python 기준선

```powershell
cd C:\path\to\OfficeWhere
py -3 scripts\drm_probe.py `
  "C:\DRM-Samples\sample.docx" `
  "C:\DRM-Samples\sample.xlsx" `
  "C:\DRM-Samples\sample.pptx" `
  --json-out "$env:TEMP\officewhere-drm-system-python.json"
```

성공 조건:

- 각 파일의 `status`가 `ok`
- `zipfile_is_zipfile`가 `true`
- `stdlib_ooxml.zip_opened`가 `true`
- DOCX는 `word/document.xml`, XLSX는 `xl/workbook.xml`, PPTX는 `ppt/presentation.xml` 관련 결과가 나온다.

이 기준선이 실패하면 OfficeWhere 문제가 아니라 Python 프로세스 자체도 해당 DRM 파일을 못 받는 상태다.

## 2. OfficeWhere에 포함할 수 있는 portable/bundled python.exe 검증

이 단계가 가장 중요하다. 여기서 성공하면 “사용자가 Python 패키지를 설치하지 않아도 OfficeWhere가 포함한 진짜 `python.exe`로 DRM 문서를 읽는 구조”가 가능하다.

1. python.org에서 Windows embeddable package x86-64 ZIP을 받는다. 예: Python 3.13.x Windows embeddable package 64-bit.
2. 임시 폴더에 푼다.

```powershell
mkdir C:\OfficeWhereDrmProbe
# 다운로드한 ZIP을 C:\OfficeWhereDrmProbe\python-embed 에 압축 해제
C:\OfficeWhereDrmProbe\python-embed\python.exe C:\path\to\OfficeWhere\scripts\drm_probe.py `
  "C:\DRM-Samples\sample.docx" `
  "C:\DRM-Samples\sample.xlsx" `
  "C:\DRM-Samples\sample.pptx" `
  --json-out "$env:TEMP\officewhere-drm-embedded-python.json"
```

주의: 이 검증은 표준 라이브러리만 쓰므로 `pip install`, `python-docx`, `openpyxl`, `python-pptx`가 필요 없다.

## 3. 선택: 실제 parser 라이브러리까지 검증

portable/bundled `python.exe`에서 2번이 성공하면 DRM 관점의 핵심 가설은 통과다. 이후 패키징 안정성까지 보려면 같은 Python 런타임에 parser 패키지를 붙이고 `--library-check`를 실행한다.

```powershell
# 같은 minor 버전의 설치 Python이 있을 때만 간단히 가능하다.
py -3.13 -m pip install --target C:\OfficeWhereDrmProbe\site-packages `
  openpyxl python-docx python-pptx

# embeddable python의 python313._pth 파일에 아래 줄을 추가하고 import site 주석을 해제한다.
# ..\site-packages
# import site

C:\OfficeWhereDrmProbe\python-embed\python.exe C:\path\to\OfficeWhere\scripts\drm_probe.py `
  "C:\DRM-Samples\sample.docx" `
  "C:\DRM-Samples\sample.xlsx" `
  "C:\DRM-Samples\sample.pptx" `
  --library-check `
  --json-out "$env:TEMP\officewhere-drm-embedded-python-library.json"
```

## 판정표

| 결과 | 해석 | 다음 결정 |
| --- | --- | --- |
| 설치 Python 성공 + portable Python 성공 | OfficeWhere bundled `python.exe` reader host 가능성이 높다. | 앱 리소스에 CPython runtime + parser packages 포함 구조로 진행 |
| 설치 Python 성공 + portable Python 실패 | DRM이 특정 설치 Python 경로/등록/서명만 신뢰할 수 있다. | 사용자가 선택한 설치 Python 사용 모드 또는 Office COM 모드 필요 |
| 설치 Python 실패 + Office 앱은 열림 | Python 프로세스는 DRM 복호화 대상이 아니다. | COM 기반 reader가 주 경로 |
| 일부 확장자만 실패 | DRM 정책 또는 파일 형식별 parser 문제가 섞여 있다. | 실패 확장자별 COM reader 또는 정책 확인 |

## 개발 판단 기준

`portable python.exe + scripts/drm_probe.py`가 DRM DOCX/XLSX/PPTX에서 모두 `ok`면, OfficeWhere packaged backend를 “진짜 python.exe로 실행되는 문서 읽기 호스트”로 구성해도 된다. 이 테스트는 패키지 설치 문제가 아니라 DRM 복호화 바이트 전달 여부를 직접 확인한다.
