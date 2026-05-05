# 보호 문서 Python 읽기 테스트베드

이 문서는 보호 정책이 적용된 Office 문서를 OfficeWhere의 Python backend 프로세스가 정상적인 OOXML 파일로 읽을 수 있는지 수동으로 확인하는 절차입니다. 핵심은 parser 품질이 아니라 해당 Python 프로세스가 복호화된 `.docx`, `.xlsx`, `.pptx` zip 바이트를 받을 수 있는지입니다.

`scripts/drm_probe.py`는 기본적으로 Python 표준 라이브러리만 사용해 Office 문서 내부 XML 파트를 엽니다. 필요할 때만 `--library-check`로 parser 패키지까지 확인합니다.

## 준비물

- 실제 업무 환경에서 보호 정책이 적용된 `.docx`, `.xlsx`, `.pptx` 샘플 각 1개 이상
- 해당 정책이 적용된 Windows PC
- OfficeWhere 저장소 또는 `scripts/drm_probe.py` 단일 파일

## 1. 설치된 Python 기준선 확인

```powershell
cd C:\path\to\OfficeWhere
py -3 scripts\drm_probe.py `
  "C:\Protected-Samples\sample.docx" `
  "C:\Protected-Samples\sample.xlsx" `
  "C:\Protected-Samples\sample.pptx" `
  --json-out "$env:TEMP\officewhere-protected-system-python.json"
```

성공 조건:

- 각 파일의 `status`가 `ok`
- `zipfile_is_zipfile`가 `true`
- `stdlib_ooxml.zip_opened`가 `true`
- DOCX는 `word/document.xml`, XLSX는 `xl/workbook.xml`, PPTX는 `ppt/presentation.xml` 관련 결과가 나온다.

## 2. OfficeWhere app-local Python runtime 확인

Windows 배포는 `python-runtime/win-x64/python.exe`를 앱 리소스에 포함합니다. 같은 probe를 bundled runtime으로 실행합니다.

```powershell
C:\path\to\OfficeWhere\python-runtime\win-x64\python.exe C:\path\to\OfficeWhere\scripts\drm_probe.py `
  "C:\Protected-Samples\sample.docx" `
  "C:\Protected-Samples\sample.xlsx" `
  "C:\Protected-Samples\sample.pptx" `
  --json-out "$env:TEMP\officewhere-protected-bundled-python.json"
```

이 단계는 표준 라이브러리만 쓰므로 `pip install`, `python-docx`, `openpyxl`, `python-pptx`가 필요 없습니다.

## 3. 선택: 실제 parser 라이브러리까지 확인

bundled runtime에서 2번이 성공하면 핵심 가설은 통과입니다. 패키징된 parser 의존성까지 보려면 `--library-check`를 추가합니다.

```powershell
C:\path\to\OfficeWhere\python-runtime\win-x64\python.exe C:\path\to\OfficeWhere\scripts\drm_probe.py `
  "C:\Protected-Samples\sample.docx" `
  "C:\Protected-Samples\sample.xlsx" `
  "C:\Protected-Samples\sample.pptx" `
  --library-check `
  --json-out "$env:TEMP\officewhere-protected-bundled-python-library.json"
```

## 판정

| 결과 | 해석 | 다음 결정 |
| --- | --- | --- |
| 설치 Python 성공 + bundled Python 성공 | OfficeWhere app-local backend runtime이 해당 문서 정책과 호환될 가능성이 높다. | 패키징된 앱에서 같은 샘플 색인 확인 |
| 설치 Python 성공 + bundled Python 실패 | 정책이 특정 Python 설치 경로/등록/서명만 신뢰할 수 있다. | 사용자 지정 Python 또는 다른 읽기 전략 검토 |
| 설치 Python 실패 + Office 앱은 열림 | Python 프로세스가 보호 문서 바이트를 받지 못하는 정책일 수 있다. | Office 자동화 계열 reader 가능성은 별도 판단 |
| 일부 확장자만 실패 | 정책 또는 파일 형식별 parser 문제가 섞여 있다. | 확장자별 원인 분리 |
