from __future__ import annotations

import shutil
import uuid
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any, List, Optional, Sequence
from xml.sax.saxutils import escape

from ..database import delete_files_under_paths, get_db_path
from ..models.schemas import LibrarySettings
from .library_settings import load_library_settings, save_library_settings

TUTORIAL_LIBRARY_ROOT_NAME = "tutorial-examples"
TUTORIAL_LIBRARY_PREFIX = "officewhere_tutorial_"
VERSION_LABELS = ["v1.0", "v1.1", "v2.0", "v3.0", "v4.0"]
VERSION_DATES = ["260419", "260426", "260503", "260510", "260517"]

WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"
A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
SHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"


def tutorial_library_root() -> Path:
    """Return the app-owned root used only for temporary tutorial documents."""
    return Path(get_db_path()).resolve().parent / TUTORIAL_LIBRARY_ROOT_NAME


def _xml_text(value: Any) -> str:
    return escape(str(value), {'"': '&quot;'})


def _write_zip(path: Path, files: dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in files.items():
            archive.writestr(name, content.encode("utf-8"))


def _word_paragraph(text: str) -> str:
    return f'<w:p><w:r><w:t>{_xml_text(text)}</w:t></w:r></w:p>'


def _word_table(rows: Sequence[Sequence[str]]) -> str:
    row_xml: List[str] = []
    for row in rows:
        cells = "".join(
            f'<w:tc><w:p><w:r><w:t>{_xml_text(cell)}</w:t></w:r></w:p></w:tc>'
            for cell in row
        )
        row_xml.append(f"<w:tr>{cells}</w:tr>")
    return f"<w:tbl>{''.join(row_xml)}</w:tbl>"


def _save_word_document(
    path: Path,
    heading: str,
    paragraphs: Sequence[str],
    table_rows: Optional[Sequence[Sequence[str]]] = None,
) -> None:
    body_parts = [_word_paragraph(heading), *(_word_paragraph(paragraph) for paragraph in paragraphs)]
    if table_rows:
        body_parts.append(_word_table(table_rows))
    document_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<w:document xmlns:w="{WORD_NS}"><w:body>'
        f'{"".join(body_parts)}'
        '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" '
        'w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>'
        '</w:body></w:document>'
    )
    _write_zip(
        path,
        {
            "[Content_Types].xml": (
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                '<Default Extension="xml" ContentType="application/xml"/>'
                '<Override PartName="/word/document.xml" '
                'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
                '</Types>'
            ),
            "_rels/.rels": (
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                f'<Relationships xmlns="{PKG_REL_NS}">'
                '<Relationship Id="rId1" '
                'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
                'Target="word/document.xml"/>'
                '</Relationships>'
            ),
            "word/document.xml": document_xml,
        },
    )


def _shape(shape_id: int, name: str, text: str, *, top: int, left: int, title: bool = False) -> str:
    ph = '<p:ph type="title"/>' if title else '<p:ph/>'
    paragraphs = "".join(
        f'<a:p><a:r><a:t>{_xml_text(line)}</a:t></a:r></a:p>'
        for line in text.split("\n")
        if line.strip()
    )
    return (
        '<p:sp>'
        f'<p:nvSpPr><p:cNvPr id="{shape_id}" name="{_xml_text(name)}"/><p:cNvSpPr/><p:nvPr>{ph}</p:nvPr></p:nvSpPr>'
        f'<p:spPr><a:xfrm><a:off x="{left}" y="{top}"/><a:ext cx="7600000" cy="1200000"/></a:xfrm></p:spPr>'
        f'<p:txBody><a:bodyPr/><a:lstStyle/>{paragraphs}</p:txBody>'
        '</p:sp>'
    )


def _slide_xml(title: str, lines: Sequence[str]) -> str:
    body_text = "\n".join(lines)
    shapes = [
        _shape(2, "Title 1", title, top=350000, left=650000, title=True),
        _shape(3, "Content 2", body_text, top=1650000, left=650000),
    ]
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<p:sld xmlns:p="{P_NS}" xmlns:a="{A_NS}" xmlns:r="{R_NS}">'
        '<p:cSld><p:spTree>'
        '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>'
        f'{"".join(shapes)}'
        '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>'
    )


def _save_presentation(path: Path, slides: Sequence[tuple[str, Sequence[str]]]) -> None:
    slide_ids = "".join(
        f'<p:sldId id="{256 + index}" r:id="rId{index}"/>'
        for index in range(1, len(slides) + 1)
    )
    rels = "".join(
        '<Relationship '
        f'Id="rId{index}" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" '
        f'Target="slides/slide{index}.xml"/>'
        for index in range(1, len(slides) + 1)
    )
    files = {
        "[Content_Types].xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/ppt/presentation.xml" '
            'ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>'
            + "".join(
                f'<Override PartName="/ppt/slides/slide{index}.xml" '
                'ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'
                for index in range(1, len(slides) + 1)
            )
            + '</Types>'
        ),
        "_rels/.rels": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            f'<Relationships xmlns="{PKG_REL_NS}">'
            '<Relationship Id="rId1" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
            'Target="ppt/presentation.xml"/>'
            '</Relationships>'
        ),
        "ppt/presentation.xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            f'<p:presentation xmlns:p="{P_NS}" xmlns:r="{R_NS}">'
            f'<p:sldIdLst>{slide_ids}</p:sldIdLst>'
            '<p:sldSz cx="9144000" cy="5143500" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/>'
            '</p:presentation>'
        ),
        "ppt/_rels/presentation.xml.rels": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            f'<Relationships xmlns="{PKG_REL_NS}">{rels}</Relationships>'
        ),
    }
    for index, (title, lines) in enumerate(slides, start=1):
        files[f"ppt/slides/slide{index}.xml"] = _slide_xml(title, lines)
    _write_zip(path, files)


def _column_letter(index: int) -> str:
    letters = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        letters = chr(65 + remainder) + letters
    return letters


def _worksheet_xml(rows: Sequence[Sequence[Any]], sheet_name: str) -> str:
    row_xml: List[str] = []
    for row_index, row in enumerate(rows, start=1):
        cells: List[str] = []
        for col_index, value in enumerate(row, start=1):
            text = str(value).strip() if value is not None else ""
            if not text:
                continue
            ref = f"{_column_letter(col_index)}{row_index}"
            cells.append(
                f'<c r="{ref}" t="inlineStr"><is><t>{_xml_text(text)}</t></is></c>'
            )
        row_xml.append(f'<row r="{row_index}">{"".join(cells)}</row>')
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<worksheet xmlns="{SHEET_NS}" xmlns:r="{R_NS}">'
        f'<sheetPr><outlinePr summaryBelow="1" summaryRight="1"/></sheetPr><sheetData>{"".join(row_xml)}</sheetData>'
        '</worksheet>'
    )


def _save_workbook(path: Path, sheet_name: str, rows: Sequence[Sequence[Any]]) -> None:
    _write_zip(
        path,
        {
            "[Content_Types].xml": (
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                '<Default Extension="xml" ContentType="application/xml"/>'
                '<Override PartName="/xl/workbook.xml" '
                'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
                '<Override PartName="/xl/worksheets/sheet1.xml" '
                'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
                '<Override PartName="/xl/styles.xml" '
                'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
                '</Types>'
            ),
            "_rels/.rels": (
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                f'<Relationships xmlns="{PKG_REL_NS}">'
                '<Relationship Id="rId1" '
                'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
                'Target="xl/workbook.xml"/>'
                '</Relationships>'
            ),
            "xl/workbook.xml": (
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                f'<workbook xmlns="{SHEET_NS}" xmlns:r="{R_NS}">'
                f'<sheets><sheet name="{_xml_text(sheet_name)}" sheetId="1" r:id="rId1"/></sheets>'
                '</workbook>'
            ),
            "xl/_rels/workbook.xml.rels": (
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                f'<Relationships xmlns="{PKG_REL_NS}">'
                '<Relationship Id="rId1" '
                'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
                'Target="worksheets/sheet1.xml"/>'
                '</Relationships>'
            ),
            "xl/styles.xml": (
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                f'<styleSheet xmlns="{SHEET_NS}"><fonts count="1"><font/></fonts><fills count="1"><fill/></fills>'
                '<borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
                '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>'
            ),
            "xl/worksheets/sheet1.xml": _worksheet_xml(rows, sheet_name),
        },
    )


def _budget_rows(revision: int) -> list[list[Any]]:
    versions: dict[int, dict[str, Any]] = {
        1: {
            "rows": [
                ["A 프로젝트 검색 개선", "김철수", "120000000", "진행중"],
                ["Office 정합성 검사", "이영희", "85000000", "검토중"],
                ["배포 자동화", "박민수", "45000000", "예정"],
            ],
        },
        2: {
            "rows": [
                ["A 프로젝트 검색 개선", "김철수", "135000000", "진행중", "예산 조정"],
                ["Office 정합성 검사", "이영희", "85000000", "완료", "검증 완료"],
                ["사용자 교육 자료", "최은지", "30000000", "신규", "사용자 요청 추가"],
            ],
        },
        3: {
            "rows": [
                ["A 프로젝트 검색 개선", "김철수", "145000000", "진행중", "검색 범위 확대", "260503"],
                ["Office 정합성 검사", "이영희", "90000000", "완료", "사용자 피드백 반영", "260503"],
                ["사용자 교육 자료", "최은지", "35000000", "진행중", "사용자 요청 추가", "260510"],
                ["배포 자동화", "박민수", "50000000", "재개", "릴리즈 준비", "260517"],
            ],
        },
        4: {
            "rows": [
                ["A 프로젝트 검색 개선", "김철수", "150000000", "검수중", "성능 검증 추가", "260510"],
                ["Office 정합성 검사", "이영희", "92000000", "개선중", "버전관리 표 보기 개선", "260517"],
                ["사용자 교육 자료", "최은지", "42000000", "진행중", "교육 범위 확대", "260524"],
                ["네트워크 드라이브 검증", "한지민", "28000000", "신규", "사내 공유 드라이브 확인", "260531"],
            ],
        },
        5: {
            "rows": [
                ["A 프로젝트 검색 개선", "김철수", "155000000", "완료", "릴리즈 후보 반영", "260517"],
                ["Office 정합성 검사", "이영희", "98000000", "검수중", "Excel 표로 보기 개선", "260524"],
                ["네트워크 드라이브 검증", "한지민", "32000000", "진행중", "읽기 전용 안전성 확인", "260607"],
                ["운영 이관 준비", "오세훈", "60000000", "신규", "사용자 배포 준비", "260614"],
            ],
        },
    }
    headers = ["과제명", "담당자", "예산", "상태", "변경사유", "완료예정"]
    rows: list[list[Any]] = [
        ["2026 문서 검색/정합성 고도화 예산"],
        ["튜토리얼용 임시 Excel 파일입니다. 표는 C4부터 시작합니다."],
        [],
        ["", "", *headers],
    ]
    rows.extend([["", "", *row] for row in versions[revision]["rows"]])
    if revision == 5:
        while len(rows) < 12:
            rows.append([])
        rows.append(["", "", "", "", "", "", "", "", "", "v4 확인용 원거리 셀"])
    return rows


def build_tutorial_library(target_dir: Path) -> int:
    """Create the temporary Office files used by the guided tutorial."""
    if target_dir.exists():
        shutil.rmtree(target_dir)
    target_dir.mkdir(parents=True, exist_ok=True)

    file_count = 0
    report_dir = target_dir / "01_보고서"
    budget_dir = target_dir / "02_예산"
    search_dir = target_dir / "03_검색샘플"

    word_versions = {
        1: [
            "260419 기준 A 프로젝트 검색 개선은 설계 단계입니다.",
            "본문 검색과 파일명 검색을 함께 확인합니다.",
            "보안 검토는 다음 주에 시작합니다.",
        ],
        2: [
            "260426 기준 A 프로젝트 검색 개선은 구현 완료 상태입니다.",
            "본문 검색으로 예산 조정, 보안 검토 같은 키워드를 찾을 수 있습니다.",
            "사용자 테스트를 시작합니다.",
        ],
        3: [
            "260503 기준 사용자 테스트 피드백을 반영했습니다.",
            "Excel 표로 보기와 공유 드라이브 읽기 정책을 검토합니다.",
            "버전관리 화면의 보기 크기 설정을 추가했습니다.",
        ],
        4: [
            "260510 기준 Excel 표로 보기 개선을 완료했습니다.",
            "삭제/추가 셀 표시와 가로 스크롤 동작을 확인합니다.",
            "사용자 검수에서 버전 이력 설명을 단순화합니다.",
        ],
        5: [
            "260517 기준 릴리즈 후보를 준비합니다.",
            "검색과 정합성 검사의 주요 시나리오를 다시 점검합니다.",
            "사용자 배포 전 체크리스트를 확정합니다.",
        ],
    }
    for revision, paragraphs in word_versions.items():
        date = VERSION_DATES[revision - 1]
        version = VERSION_LABELS[revision - 1]
        _save_word_document(
            report_dir / f"주간보고_{version}_{date}.docx",
            "주간보고",
            paragraphs,
            [["작성자", "운영팀"], ["상태", f"{version} 검토"]],
        )
        file_count += 1

    ppt_versions = {
        1: [
            ("A 프로젝트 상태", ["검색 범위 옵션 설계", "정합성 그룹 기준 검토"]),
            ("다음 일정", ["260419 기준: 내부 테스트 준비", "위험: 엑셀 예산 확정 전"]),
        ],
        2: [
            ("A 프로젝트 상태", ["본문 검색 배포 완료", "Office 정합성 그룹 기준 적용"]),
            ("위험 요소", ["일정 지연 가능성 감소", "사용자 교육 필요"]),
            ("다음 일정", ["260426 기준: 사용자 검증", "릴리즈 체크리스트 완료"]),
        ],
        3: [
            ("A 프로젝트 상태", ["검색/정합성 1차 사용자 피드백 반영", "Excel 표 보기 개선 진행"]),
            ("위험 요소", ["공유 드라이브 접근성 확인", "대용량 Excel 표시 정책 검토"]),
            ("다음 일정", ["260503 기준: v2 내부 검수", "260510 기준: 사용자 피드백 수집"]),
        ],
        4: [
            ("A 프로젝트 상태", ["Excel 표로 보기 변경 이력 개선", "창 닫기/트레이 동작 안정화"]),
            ("주요 변경점", ["추가/삭제 셀 색상 표시", "상세 이력 수정 전/후 박스 표시"]),
            ("다음 일정", ["260510 기준: v3 검수", "260517 기준: 릴리즈 후보 준비"]),
        ],
        5: [
            ("A 프로젝트 상태", ["버전관리 표 보기 개선 완료", "릴리즈 후보 준비"]),
            ("주요 변경점", ["Excel v4 표 보기 추가 검증", "설정 화면 문구 정리 예정"]),
            ("위험 요소", ["대용량 Excel 렌더링 성능 모니터링"]),
            ("다음 일정", ["260517 기준: v4 검수", "260524 기준: 사용자 배포 준비"]),
        ],
    }
    for revision, slides in ppt_versions.items():
        version = VERSION_LABELS[revision - 1]
        date_suffix = "" if revision == 1 else f"_{VERSION_DATES[revision - 1]}"
        _save_presentation(report_dir / f"프로젝트상태_{version}{date_suffix}.pptx", slides)
        file_count += 1

    for revision in range(1, 6):
        date = VERSION_DATES[revision - 1]
        version = VERSION_LABELS[revision - 1]
        _save_workbook(
            budget_dir / f"사업예산_{version}_{date}.xlsx",
            "예산현황",
            _budget_rows(revision),
        )
        file_count += 1

    _save_word_document(
        search_dir / "운영메모.docx",
        "A 프로젝트 체험 메모",
        [
            "본문 검색에서 이 프로젝트 문장이 검색되어야 합니다.",
            "파일명에는 프로젝트가 없으므로 본문 매칭 확인에 사용합니다.",
        ],
    )
    file_count += 1

    return file_count


def _is_relative_to(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False


def _resolve_for_compare(path: Path) -> Path:
    return path.expanduser().resolve(strict=False)


def _cleanup_targets(root: Path, requested_path: Optional[str]) -> list[Path]:
    root_resolved = _resolve_for_compare(root)
    if requested_path:
        target = _resolve_for_compare(Path(requested_path))
        if not _is_relative_to(target, root_resolved):
            raise ValueError("튜토리얼 임시 폴더 밖의 경로는 정리할 수 없습니다.")
        return [target]

    if not root.exists():
        return [root_resolved]
    return [
        _resolve_for_compare(child)
        for child in root.iterdir()
        if child.is_dir() and child.name.startswith(TUTORIAL_LIBRARY_PREFIX)
    ] or [root_resolved]


def _folder_under_targets(folder_path: str, targets: Sequence[Path]) -> bool:
    folder = _resolve_for_compare(Path(folder_path))
    return any(folder == target or _is_relative_to(folder, target) for target in targets)


def _remove_watched_tutorial_folders(targets: Sequence[Path]) -> int:
    settings = load_library_settings()
    kept = [
        folder
        for folder in settings.watched_folders
        if not _folder_under_targets(folder.path, targets)
    ]
    removed_count = len(settings.watched_folders) - len(kept)
    if removed_count:
        save_library_settings(
            LibrarySettings(
                watched_folders=kept,
                excluded_folder_names=settings.excluded_folder_names,
                auto_rescan_mode=settings.auto_rescan_mode,
                auto_rescan_interval_hours=settings.auto_rescan_interval_hours,
                auto_rescan_daily_time=settings.auto_rescan_daily_time,
                fast_worker_count=settings.fast_worker_count,
                last_rescan_at=settings.last_rescan_at,
            )
        )
    return removed_count


def cleanup_tutorial_library(path: Optional[str] = None) -> dict[str, Any]:
    """Remove only app-owned temporary tutorial files plus their app-owned DB rows."""
    root = tutorial_library_root()
    targets = _cleanup_targets(root, path)
    removed_watched = _remove_watched_tutorial_folders(targets)
    deleted_records = delete_files_under_paths([str(target) for target in targets])

    removed: list[str] = []
    failed: list[dict[str, str]] = []
    root_resolved = _resolve_for_compare(root)
    for target in targets:
        try:
            if not _is_relative_to(target, root_resolved):
                raise ValueError("튜토리얼 임시 폴더 밖의 경로는 정리할 수 없습니다.")
            if target.exists():
                shutil.rmtree(target)
                removed.append(str(target))
        except Exception as exc:  # pragma: no cover - platform/filesystem race safety
            failed.append({"path": str(target), "error": str(exc)})

    if root.exists():
        try:
            if not any(root.iterdir()):
                root.rmdir()
        except OSError:
            pass

    return {
        "success": not failed,
        "removed": removed,
        "deletedFileRecords": deleted_records,
        "removedWatchedFolders": removed_watched,
        "failed": failed,
    }


def create_tutorial_library() -> dict[str, Any]:
    """Generate a fresh temporary tutorial library inside the app-owned data dir."""
    cleanup_tutorial_library()
    root = tutorial_library_root()
    root.mkdir(parents=True, exist_ok=True)
    suffix = datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:8]
    target_dir = root / f"{TUTORIAL_LIBRARY_PREFIX}{suffix}"
    file_count = build_tutorial_library(target_dir)
    return {
        "available": True,
        "path": str(target_dir),
        "temporary": True,
        "fileCount": file_count,
    }
