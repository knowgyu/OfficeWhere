import asyncio


def test_startup_health_skips_expensive_index_status(monkeypatch, tmp_path):
    import backend.main as main
    from backend import database

    monkeypatch.setattr(database, "DB_DIR", tmp_path)
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "data.db")
    database.init_db()

    def fail_status():
        raise AssertionError("startup health should not read derived index status")

    monkeypatch.setattr(main, "get_search_index_status", fail_status)
    monkeypatch.setattr(main, "get_excel_index_status", fail_status)

    response = asyncio.run(main.health(startup=True))

    assert response["status"] == "ok"
    assert response["version"] == main.app.version
    assert response["db_path"] == str(tmp_path / "data.db")
    assert "search_index" not in response
    assert "excel_index" not in response


def test_full_health_keeps_index_status(monkeypatch, tmp_path):
    import backend.main as main
    from backend import database

    monkeypatch.setattr(database, "DB_DIR", tmp_path)
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "data.db")
    database.init_db()

    response = asyncio.run(main.health())

    assert response["status"] == "ok"
    assert response["search_index"]["state"] in {"ready", "repair_needed", "refreshing", "error"}
    assert response["excel_index"]["state"] in {"ready", "repair_needed", "refreshing", "error"}
