def test_parse_performance_log_uses_separate_default_file(tmp_path, monkeypatch):
    from backend.core import index_perf

    index_log = tmp_path / "index-performance.log"
    monkeypatch.setenv("OW_INDEX_PERF_LOG_PATH", str(index_log))
    monkeypatch.setenv("OW_PARSE_PERF_LOG", "1")
    monkeypatch.delenv("OW_PARSE_PERF_LOG_PATH", raising=False)
    monkeypatch.setattr(index_perf, "_LOG_PATH", None)
    monkeypatch.setattr(index_perf, "_ENABLED", None)
    monkeypatch.setattr(index_perf, "_PARSE_LOG_PATH", None)
    monkeypatch.setattr(index_perf, "_PARSE_ENABLED", None)

    index_perf.log_parse_perf("parse_probe", path="sample.xlsx", duration_ms=123)

    parse_log = tmp_path / "parsing-performance.log"
    assert parse_log.exists()
    assert "parse_probe" in parse_log.read_text(encoding="utf-8")
    assert not index_log.exists()
