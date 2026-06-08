import importlib.util
import json
import subprocess
import sys
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "build_search_benchmark_dataset.py"


def _load_script_module():
    spec = importlib.util.spec_from_file_location("build_search_benchmark_dataset", SCRIPT_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_plan_documents_balances_office_types_and_large_small_mix():
    module = _load_script_module()

    docs = module.plan_documents(file_count=30, target_db_bytes=64 * 1024 * 1024, seed=20260608)

    assert {doc.file_type for doc in docs} == {"Word", "PowerPoint", "Excel"}
    assert min(doc.raw_utf8_bytes for doc in docs) < max(doc.raw_utf8_bytes for doc in docs)
    assert all(doc.path.startswith("C:/OfficeWhereBench/ai-systems/") for doc in docs)


def test_build_chunks_contains_ai_search_terms_and_hits_planned_size():
    module = _load_script_module()
    doc = module.plan_documents(file_count=1, target_db_bytes=4 * 1024 * 1024, seed=7)[0]

    chunks = module.build_chunks(doc, seed=7)
    content = "\n".join(chunk["content"] for chunk in chunks)

    assert chunks
    assert "AI 시스템 및 서비스 개발" in content
    assert "검색" in content
    assert "모델" in content
    assert sum(len(chunk["content"].encode("utf-8")) for chunk in chunks) == doc.raw_utf8_bytes


def test_script_smoke_generates_db_manifest_results_and_perf_log(tmp_path):
    output_dir = tmp_path / "search-bench"

    completed = subprocess.run(
        [
            sys.executable,
            str(SCRIPT_PATH),
            "--output-dir",
            str(output_dir),
            "--files",
            "6",
            "--target-mb",
            "1",
            "--batch-size",
            "3",
            "--queries",
            "검색",
            "--scopes",
            "content",
            "--cold-repeat",
            "1",
            "--warm-repeat",
            "0",
            "--force",
        ],
        check=True,
        cwd=SCRIPT_PATH.parents[1],
        text=True,
        capture_output=True,
    )

    manifest = json.loads((output_dir / "manifest.json").read_text(encoding="utf-8"))
    results = json.loads((output_dir / "search-benchmark-results.json").read_text(encoding="utf-8"))
    log_text = (output_dir / "logs" / "search-benchmark.ndjson").read_text(encoding="utf-8")

    assert "완료" in completed.stdout
    assert (output_dir / "backend-data" / "data.db").exists()
    assert manifest["file_count"] == 6
    assert manifest["chunk_count"] >= 6
    assert results
    assert any(row["query"] == "검색" and row["scope"] == "content" for row in results)
    assert '"event": "search_request_done"' in log_text
