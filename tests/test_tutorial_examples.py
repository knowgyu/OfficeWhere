from pathlib import Path

from backend import database
from backend.core.excel_analysis import extract_excel_used_range
from backend.core.library_settings import load_library_settings, save_library_settings
from backend.core.ppt_analysis import extract_ppt_slides
from backend.core.tutorial_examples import cleanup_tutorial_library, create_tutorial_library
from backend.core.word_analysis import extract_word_blocks
from backend.database import get_file_by_id, init_db, register_file
from backend.models.schemas import LibrarySettings


def _setup_db(tmp_path, monkeypatch):
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "data.db")
    monkeypatch.setattr(database, "DB_DIR", tmp_path)
    init_db()


def test_tutorial_library_generates_parseable_temporary_office_files(tmp_path, monkeypatch):
    _setup_db(tmp_path, monkeypatch)

    response = create_tutorial_library()
    library_path = Path(response["path"])

    assert response["available"] is True
    assert response["temporary"] is True
    assert library_path.exists()
    assert library_path.parent.name == "tutorial-examples"
    assert response["fileCount"] == len([path for path in library_path.rglob("*") if path.is_file()])

    word_path = next(library_path.rglob("주간보고_v1.0_260419.docx"))
    ppt_path = next(library_path.rglob("프로젝트상태_v4.0_260517.pptx"))
    excel_path = next(library_path.rglob("사업예산_v4.0_260517.xlsx"))

    assert any("프로젝트" in block["text"] for block in extract_word_blocks(str(word_path)))
    assert extract_ppt_slides(str(ppt_path))[0]["title"] == "A 프로젝트 상태"

    used_range, _config = extract_excel_used_range(str(excel_path))
    assert used_range.value_at(6, 3) == "한지민"  # D7; tutorial asks the user to click this changed cell.


def test_tutorial_cleanup_removes_only_app_owned_temp_files_and_indexes(tmp_path, monkeypatch):
    _setup_db(tmp_path, monkeypatch)
    response = create_tutorial_library()
    library_path = Path(response["path"])
    outside_dir = tmp_path / "real-documents"
    outside_dir.mkdir()
    outside_file = outside_dir / "업무문서.docx"
    outside_file.write_text("keep", encoding="utf-8")

    tutorial_file = next(library_path.rglob("운영메모.docx"))
    tutorial_id = register_file(
        path=str(tutorial_file),
        name=tutorial_file.name,
        file_type="Word",
        column_count=1,
    )
    outside_id = register_file(
        path=str(outside_file),
        name=outside_file.name,
        file_type="Word",
        column_count=1,
    )
    save_library_settings(
        LibrarySettings(
            watched_folders=[
                {"path": str(library_path), "recursive": True},
                {"path": str(outside_dir), "recursive": True},
            ]
        )
    )

    result = cleanup_tutorial_library(str(library_path))

    assert result["success"] is True
    assert result["deletedFileRecords"] == 1
    assert result["removedWatchedFolders"] == 1
    assert not library_path.exists()
    assert get_file_by_id(tutorial_id) is None
    assert get_file_by_id(outside_id) is not None
    assert outside_file.exists()
    assert [folder.path for folder in load_library_settings().watched_folders] == [str(outside_dir)]
