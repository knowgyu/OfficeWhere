# Office Data Joiner 아키텍처 재설계

## 배경

기존 구현은 모든 파일을 `key_column + 유사 컬럼명 + 값 비교` 모델로 처리한다. 이 방식은 초기 MVP로는 단순하고 빠르지만, 아래 요구사항과는 맞지 않는다.

- Excel JOIN은 Excel만 대상으로 해야 한다.
- Excel 정합성 검사는 상단 제목행, 중간 시작 열, 컬럼 추가/누락까지 고려해야 한다.
- Word 정합성 검사는 문서 개정본 간 본문/표 변경을 diff처럼 보여줘야 한다.
- PPT 정합성 검사는 슬라이드 추가/삭제와 슬라이드 내부 텍스트 변경을 보여줘야 한다.

따라서 "파일 등록", "JOIN", "정합성 검사"를 같은 데이터 모델로 억지로 처리하지 않고, 파일 타입별 처리 전략을 분리한다.

---

## 목표

1. Excel JOIN 전용 파이프라인과 비교 파이프라인을 분리한다.
2. Word/PPT 비교는 구조화 테이블이 아니라 문서 diff 엔진으로 처리한다.
3. 등록 메타데이터를 유연하게 만들어 파일 타입별 파서 설정을 저장한다.
4. UI는 파일 타입별 기능 차이를 자연스럽게 드러내고, 잘못된 조합은 사전에 막는다.
5. 비교 엔진은 테스트하기 쉬운 순수 함수 중심으로 분리한다.

---

## 최상위 구조

### 1. 등록 모델

`registered_files`

- `file_type`: Excel / Word / PowerPoint
- `key_column`: Excel만 실질적으로 사용, Word/PPT는 빈 문자열 허용
- `parser_config`: JSON 문자열
  - Excel: `sheet_name`, `header_row`, `start_col`, `end_col`, `end_row`
  - Word/PPT: 현재는 빈 객체

등록 시점에 파일 타입별 inspect 결과를 저장하고, 실행 시 동일 설정을 재사용한다.

### 2. 추출 계층

추출 계층은 "파일에서 비교 가능한 표준 모델을 얻는 것"만 담당한다.

- `excel_analysis.py`
  - 워크북에서 표 후보 영역 탐지
  - 선택된 표 영역을 `DataFrame`으로 추출
- `word_analysis.py`
  - 문단 + 표 행을 순서 보존 블록 목록으로 추출
- `ppt_analysis.py`
  - 슬라이드 목록과 슬라이드 내부 텍스트 아이템 목록을 추출

### 3. 비교 계층

비교 계층은 파일 타입별 알고리즘만 담당한다.

- `excel_compare.py`
  - key 기준 값 변경
  - key 누락
  - 컬럼 추가/누락
- `word_compare.py`
  - 블록 시퀀스 diff
- `ppt_compare.py`
  - 슬라이드 정렬
  - 추가/삭제 슬라이드 감지
  - 매칭된 슬라이드 내부 아이템 diff

### 4. 오케스트레이션 계층

- `checker.py`
  - 선택된 파일 집합을 보고 비교 모드 결정
  - Excel 다중 비교 / Word 2개 비교 / PPT 2개 비교를 분기

### 5. JOIN 계층

- `joiner.py`
  - Excel만 허용
  - 등록된 `parser_config` 기반으로 표 영역을 읽어 JOIN

---

## 파일 타입별 상세 설계

## Excel

### 문제

- 첫 행이 무조건 헤더가 아니다.
- 실제 표가 `C3` 같은 위치에서 시작할 수 있다.
- 같은 양식이지만 일부 컬럼이 추가될 수 있다.
- 대부분은 같은 key 기준으로 값 차이를 보고 싶다.

### 설계

#### 표 후보 탐지

순서:

1. Excel Table 객체가 있으면 최우선 사용
2. 없으면 시트별로 비어 있지 않은 셀 밴드를 찾음
3. 각 밴드에서 헤더 후보 행을 점수화
4. 최고 점수 영역을 기본 선택값으로 사용

점수 기준:

- 헤더 후보 행의 비어 있지 않은 셀 수
- 아래 행의 연속 데이터 밀도
- 헤더 이름의 고유성
- 제목행처럼 단일 셀만 있는 경우 패널티

#### parser_config

Excel 등록 시 다음 값을 저장한다.

```json
{
  "sheet_name": "사업현황",
  "header_row": 3,
  "start_col": 3,
  "end_col": 11,
  "end_row": 42
}
```

이 설정을 JOIN과 정합성 검사에서 재사용한다.

#### 비교 결과

Excel 정합성 검사는 아래 3종 이슈를 반환한다.

- `value_conflict`: 같은 key의 같은 컬럼 그룹 값이 다름
- `missing_key`: 특정 key가 일부 파일에 없음
- `missing_column`: 어떤 컬럼 그룹이 일부 파일에만 존재

Word/PPT와 달리 Excel은 멀티 파일 비교를 허용한다.

## Word

### 문제

- key 기반 표 비교가 아니라 문서 개정본 diff가 필요하다.
- 본문 문단과 표 내용을 모두 봐야 한다.

### 설계

Word 비교는 반드시 2개 파일 비교로 제한한다.

추출 모델:

- paragraph block
- table row block

각 블록은 순서를 유지한 채 다음 정보를 가진다.

- `block_type`
- `location`
- `text`
- `normalized_text`

비교는 `difflib.SequenceMatcher` 기반의 블록 단위 diff로 처리한다.

반환 이슈:

- `insert`
- `delete`
- `replace`

## PowerPoint

### 문제

- 수정본 비교가 목적이다.
- 슬라이드 추가/삭제와 기존 슬라이드 내부 변경을 알고 싶다.

### 설계

PPT 비교는 반드시 2개 파일 비교로 제한한다.

추출 모델:

- slide
  - `slide_number`
  - `title`
  - `signature`
  - `items`

slide item:

- text frame
- table row

아이템은 위치 기준으로 정렬한다.

슬라이드 매칭:

- 순서를 유지하는 동적 정렬
- 슬라이드 간 텍스트 유사도 기반 매칭
- 매칭 실패 시 inserted / removed slide 처리

매칭된 슬라이드의 내부 비교:

- 아이템 시퀀스 diff
- 변경된 텍스트 전/후를 함께 반환

---

## API 방향

## 파일 등록

### Inspect

- Excel: 표 후보 영역, 기본 선택 영역, 컬럼 미리보기, 추천 key 반환
- Word/PPT: 문서 요약 미리보기와 비교 모드 반환

### Register

- Excel: `key_column` 필수, `parser_config` 필수
- Word/PPT: `key_column` 비필수, `parser_config`는 빈 객체 허용

## 정합성 검사

`POST /api/check`

입력은 그대로 `file_ids`를 받되, 서버가 타입을 보고 아래처럼 분기한다.

- 전부 Excel: `mode=excel`
- Word 2개: `mode=word`
- PPT 2개: `mode=ppt`
- 그 외: 400 오류

응답은 `mode`와 해당 타입 전용 결과를 함께 반환한다.

## JOIN

`POST /api/query/join`

- Excel만 허용
- 등록된 `parser_config`로 읽은 `DataFrame`만 사용

---

## 프론트엔드 방향

## 파일 관리

- 파일 타입에 따라 등록 폼이 달라진다.
- Excel은 "탐지된 표 영역"과 `key_column`을 보여준다.
- Word/PPT는 key 입력 없이 등록 가능하다.

## JOIN 탭

- Excel 파일만 표시한다.

## 정합성 검사 탭

- Excel 다중 선택 허용
- Word/PPT는 2개 선택만 허용
- 선택 파일 타입이 섞이면 실행 전 차단
- 결과 화면은 `mode`별 렌더러로 분리

---

## 안정성/속도 원칙

- 비교 엔진은 파일 파싱과 비교 로직을 분리한다.
- Excel 파싱은 등록 시 선택된 영역만 읽어 반복 비용을 줄인다.
- Word/PPT는 pairwise 비교만 허용해 복잡도 폭증을 막는다.
- 비교 함수는 순수 함수로 유지해 테스트와 성능 측정을 쉽게 만든다.

---

## 검증 계획

1. 백엔드 단위 테스트
   - Excel 영역 탐지
   - Excel 컬럼 추가/누락 비교
   - Word 문단/표 diff
   - PPT 슬라이드 추가/텍스트 변경 diff
2. API 테스트
   - Excel만 JOIN 허용
   - 잘못된 조합 차단
3. 프론트 빌드
4. 성능 측정
   - Excel 1천 행 수준 비교
   - Word 수백 블록 diff
   - PPT 수십 슬라이드 diff
5. 실사용 예제 생성
   - Excel 수정본
   - Word 수정본
   - PPT 수정본

