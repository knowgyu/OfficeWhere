#!/usr/bin/env python3
"""Build a reproducible large OfficeWhere search benchmark database.

The generator creates synthetic index rows directly through OfficeWhere's
normal indexing persistence helpers.  It does not create or mutate real Office
documents; the paths are intentionally fake so the dataset is app-owned and
safe to delete.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import random
import shutil
import sqlite3
import sys
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from time import perf_counter
from typing import Any, Iterable


REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
DEFAULT_OUTPUT_DIR = REPO_ROOT / ".omx" / "benchmarks" / "search-ai-1330"
DEFAULT_FILE_COUNT = 1330
DEFAULT_TARGET_GB = 1.5

# Empirical defaults for this repo's current schema and this synthetic Korean /
# English token mix.  DB byte size alone is a poor proxy for search cost: large
# 16-24 KiB chunks make a big DB but few MATCH rows, while Excel-cell/paragraph
# style chunks create many MATCH rows and reproduce common-term slowness better.
RAW_UTF8_TO_SQLITE_BYTES_MULTIPLIERS = {
    "balanced": 4.2,
    "row-heavy": 7.5,
}

COMMON_TERMS = [
    "AI",
    "시스템",
    "서비스",
    "개발",
    "검색",
    "모델",
    "데이터",
    "운영",
    "성능",
    "품질",
]

AI_TERMS = [
    "LLM",
    "RAG",
    "임베딩",
    "벡터 검색",
    "하이브리드 검색",
    "리랭커",
    "프롬프트 엔지니어링",
    "에이전트",
    "오케스트레이션",
    "모델 서빙",
    "모델 배포",
    "추론 파이프라인",
    "컨텍스트 윈도우",
    "토큰 예산",
    "지식베이스",
    "FastAPI",
    "Electron",
    "SQLite",
    "API 게이트웨이",
    "배치 처리",
    "실시간 스트리밍",
    "관측성",
    "모니터링",
    "알림",
    "SLO",
    "p95 latency",
    "회귀 테스트",
    "평가 데이터셋",
    "A/B 테스트",
    "feature flag",
    "멀티모달",
    "데이터 거버넌스",
    "권한 관리",
    "보안 검토",
    "장애 대응",
    "캐시",
    "인덱싱",
    "검색 품질",
    "서비스 안정화",
    "AI 시스템 및 서비스 개발",
]

RARE_TERMS = [
    "제로트러스트",
    "레드팀",
    "모델카드",
    "데이터계보",
    "샌드박스격리",
]

DEFAULT_QUERIES = [
    "검색",
    "모델",
    "개발",
    "서비스",
    "임베딩",
    "오케스트레이션",
    "하이브리드 검색",
    "멀티모달",
    "RAG",
    "LLM",
    "FastAPI",
    "제로트러스트",
]

TYPE_SPECS = [
    ("Word", ".docx", "word"),
    ("PowerPoint", ".pptx", "ppt"),
    ("Excel", ".xlsx", "excel"),
]


@dataclass(frozen=True)
class PlannedDocument:
    index: int
    file_type: str
    extension: str
    folder: str
    raw_utf8_bytes: int
    chunk_utf8_bytes: int
    topic: str
    name: str
    path: str


def _bytes_from_args(args: argparse.Namespace) -> int:
    if args.target_mb is not None:
        return int(args.target_mb * 1024 * 1024)
    return int(args.target_gb * 1024 * 1024 * 1024)


def _trim_utf8(text: str, byte_limit: int) -> str:
    if byte_limit <= 0:
        return ""
    encoded = text.encode("utf-8")
    if len(encoded) <= byte_limit:
        return text
    trimmed = encoded[:byte_limit].decode("utf-8", errors="ignore")
    # If the cut point landed inside a multibyte Korean character, decoding with
    # ``ignore`` may undershoot by 1-2 bytes.  Pad with ASCII so chunk-size plans
    # remain exact and reproducible.
    deficit = byte_limit - len(trimmed.encode("utf-8"))
    if deficit > 0:
        trimmed += "x" * deficit
    return trimmed


def _utf8_len(text: str) -> int:
    return len(text.encode("utf-8"))


def _normalize_query_list(values: Iterable[str] | None) -> list[str]:
    queries = [value.strip() for value in (values or []) if value.strip()]
    return queries or list(DEFAULT_QUERIES)


def _safe_stem(value: str) -> str:
    return (
        value.replace("/", "_")
        .replace("\\", "_")
        .replace(" ", "_")
        .replace(":", "_")
        .strip("_")
    )


def _make_filename(index: int, file_type: str, extension: str, topic: str) -> str:
    kind = {
        "Word": "요구사항명세서",
        "PowerPoint": "서비스전략발표",
        "Excel": "평가매트릭스",
    }[file_type]
    return f"{kind}_{_safe_stem(topic)}_{index:04d}{extension}"


def plan_documents(
    *,
    file_count: int,
    target_db_bytes: int,
    seed: int,
    chunk_profile: str = "row-heavy",
    chunk_bytes: int | None = None,
) -> list[PlannedDocument]:
    """Create a deterministic big/small mixed document plan.

    The size distribution intentionally mirrors a real shared-folder corpus:
    many small docs, a medium middle, and a few large files that dominate DB
    size.  ``target_db_bytes`` is converted to raw text using the calibrated
    multiplier above.
    """

    if file_count <= 0:
        raise ValueError("--files must be greater than zero")
    if target_db_bytes <= 0:
        raise ValueError("target size must be greater than zero")

    rng = random.Random(seed)
    multiplier = RAW_UTF8_TO_SQLITE_BYTES_MULTIPLIERS.get(
        chunk_profile,
        RAW_UTF8_TO_SQLITE_BYTES_MULTIPLIERS["row-heavy"],
    )
    raw_target = max(
        file_count * 2048,
        int(target_db_bytes / multiplier),
    )
    weighted: list[tuple[str, float]] = []
    for _ in range(file_count):
        bucket = rng.choices(["small", "medium", "large"], weights=[70, 25, 5], k=1)[0]
        if bucket == "small":
            weight = rng.uniform(0.25, 1.0)
        elif bucket == "medium":
            weight = rng.uniform(2.0, 5.5)
        else:
            weight = rng.uniform(10.0, 28.0)
        weighted.append((bucket, weight))

    total_weight = sum(weight for _, weight in weighted)
    docs: list[PlannedDocument] = []
    topics = AI_TERMS + RARE_TERMS
    for idx, (bucket, weight) in enumerate(weighted, start=1):
        file_type, ext, folder = TYPE_SPECS[(idx - 1) % len(TYPE_SPECS)]
        raw_utf8_bytes = max(2048, int(raw_target * (weight / total_weight)))
        if chunk_bytes is not None:
            chunk_utf8_bytes = max(32, int(chunk_bytes))
        elif chunk_profile == "balanced":
            if bucket == "large":
                chunk_utf8_bytes = 24 * 1024
            elif bucket == "medium":
                chunk_utf8_bytes = 16 * 1024
            else:
                chunk_utf8_bytes = 8 * 1024
        else:
            # Mimic the painful case: many short chunks/cells/paragraphs that
            # all contain common terms.  Excel is intentionally smallest because
            # real workbooks often explode into many searchable cells.
            if file_type == "Excel":
                chunk_utf8_bytes = 384
            elif file_type == "PowerPoint":
                chunk_utf8_bytes = 768
            else:
                chunk_utf8_bytes = 1024
        topic = topics[(idx - 1) % len(topics)]
        name = _make_filename(idx, file_type, ext, topic)
        path = f"C:/OfficeWhereBench/ai-systems/{folder}/{name}"
        docs.append(
            PlannedDocument(
                index=idx,
                file_type=file_type,
                extension=ext,
                folder=folder,
                raw_utf8_bytes=raw_utf8_bytes,
                chunk_utf8_bytes=chunk_utf8_bytes,
                topic=topic,
                name=name,
                path=path,
            )
        )
    return docs


def _location_for(doc: PlannedDocument, chunk_index: int) -> str:
    if doc.file_type == "PowerPoint":
        return f"슬라이드 {chunk_index + 1}"
    if doc.file_type == "Excel":
        row = 1 + chunk_index * 20
        col = 1 + (chunk_index % 12)
        return f"AI서비스평가 시트 | {row}행 {col}열"
    return f"섹션 {chunk_index + 1}"


def _document_sentence(doc: PlannedDocument, chunk_index: int, line_index: int, rng: random.Random) -> str:
    sampled_terms = rng.sample(AI_TERMS, k=8)
    rare = RARE_TERMS[(doc.index + chunk_index + line_index) % len(RARE_TERMS)]
    numeric = 100 + ((doc.index * 31 + chunk_index * 17 + line_index * 13) % 900)
    return (
        f"{' '.join(COMMON_TERMS)}. "
        f"{doc.name} 문서의 AI 시스템 및 서비스 개발 검색 기록입니다. "
        f"핵심 주제는 {doc.topic}이며, 공통 키워드는 {' '.join(COMMON_TERMS)} 입니다. "
        f"세부 항목은 {' '.join(sampled_terms)} 와 {rare} 를 포함합니다. "
        f"검색 재현성을 위해 요구사항 ID OW-AI-{doc.index:04d}-{chunk_index:03d}-{line_index:03d}, "
        f"p95 latency {numeric}ms, 처리량 {numeric * 7} tokens/s, "
        "운영 로그, 장애 대응, 캐시 전략, 회귀 테스트 결과를 반복 기록합니다.\n"
    )


def build_chunks(doc: PlannedDocument, *, seed: int) -> list[dict[str, str]]:
    """Generate deterministic chunk rows close to the planned UTF-8 size."""

    rng = random.Random(seed + doc.index * 1009)
    remaining = doc.raw_utf8_bytes
    chunks: list[dict[str, str]] = []
    chunk_index = 0
    while remaining > 0:
        target = min(doc.chunk_utf8_bytes, remaining)
        lines: list[str] = []
        line_index = 0
        while _utf8_len("".join(lines)) < target:
            lines.append(_document_sentence(doc, chunk_index, line_index, rng))
            line_index += 1
        content = _trim_utf8("".join(lines), target)
        chunks.append({"location": _location_for(doc, chunk_index), "content": content})
        remaining -= _utf8_len(content)
        chunk_index += 1
        if not content:
            break
    return chunks


def _configure_benchmark_env(output_dir: Path) -> tuple[Path, Path]:
    data_dir = output_dir / "backend-data"
    log_dir = output_dir / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    data_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "search-benchmark.ndjson"
    os.environ["OW_DATA_DIR"] = str(data_dir)
    os.environ["OW_INDEX_PERF_LOG"] = "1"
    os.environ["OW_INDEX_PERF_LOG_PATH"] = str(log_path)
    os.environ["OW_EVERYTHING_SDK"] = "0"
    return data_dir, log_path


def _reset_index_perf_module() -> None:
    module = sys.modules.get("backend.core.index_perf")
    if module is not None:
        setattr(module, "_ENABLED", None)
        setattr(module, "_LOG_PATH", None)


def _import_database(data_dir: Path):
    from backend import database

    database.configure_database(data_dir)
    return database


def _table_count(db_path: Path, table: str) -> int:
    with sqlite3.connect(str(db_path)) as conn:
        row = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()
        return int(row[0] if row else 0)


def _remove_existing_output(output_dir: Path) -> None:
    if output_dir.exists():
        shutil.rmtree(output_dir)


def generate_dataset(args: argparse.Namespace, output_dir: Path, data_dir: Path) -> dict[str, Any]:
    target_db_bytes = _bytes_from_args(args)
    docs = plan_documents(
        file_count=args.files,
        target_db_bytes=target_db_bytes,
        seed=args.seed,
        chunk_profile=args.chunk_profile,
        chunk_bytes=args.chunk_bytes,
    )
    raw_utf8_planned = sum(doc.raw_utf8_bytes for doc in docs)
    database = _import_database(data_dir)

    generation_started = perf_counter()
    database.init_db()
    staging = database.begin_initial_index_staging()

    batch = []
    raw_utf8_actual = 0
    chunk_count = 0
    last_progress_file = 0
    mtime_base = 1_756_800_000.0  # 2025-09-ish stable synthetic source time.

    def print_progress(current_file: int, *, force: bool = False) -> None:
        nonlocal last_progress_file
        every = max(1, int(args.progress_every_files))
        if not force and current_file - last_progress_file < every:
            return
        last_progress_file = current_file
        print(
            f"[generate] saved {current_file}/{len(docs)} files, "
            f"chunks={chunk_count}, raw={raw_utf8_actual / 1024 / 1024:.1f} MiB",
            flush=True,
        )

    try:
        for doc in docs:
            chunks = build_chunks(doc, seed=args.seed)
            raw_utf8_actual += sum(_utf8_len(chunk["content"]) for chunk in chunks)
            chunk_count += len(chunks)
            batch.append(
                database.prepare_indexed_file(
                    path=doc.path,
                    name=doc.name,
                    file_type=doc.file_type,
                    column_count=12 if doc.file_type == "Excel" else 1,
                    chunks=chunks,
                    file_mtime=mtime_base + doc.index,
                    excel_sheets=(
                        [
                            {
                                "sheet_name": "AI서비스평가",
                                "sheet_index": 1,
                                "row_count": max(20, len(chunks) * 20),
                                "column_count": 12,
                                "non_empty_cell_count": max(20, len(chunks) * 12),
                                "content_hash": f"bench-{doc.index:04d}",
                            }
                        ]
                        if doc.file_type == "Excel"
                        else None
                    ),
                )
            )
            if len(batch) >= args.batch_size:
                staging.save_indexed_files_batch(batch)
                print_progress(doc.index)
                batch.clear()
        if batch:
            staging.save_indexed_files_batch(batch)
            print_progress(len(docs), force=True)
            batch.clear()
        print("[generate] rebuilding FTS and copying staging DB to main DB...", flush=True)
        finalize_metrics = staging.finalize_to_main()
    except Exception:
        staging.close(remove_files=True)
        raise

    db_path = data_dir / "data.db"
    db_bytes = db_path.stat().st_size if db_path.exists() else 0
    profile_counts: dict[str, int] = {}
    for doc in docs:
        profile_counts[doc.file_type] = profile_counts.get(doc.file_type, 0) + 1

    manifest = {
        "generated_at": datetime.now().isoformat(),
        "description": "Synthetic OfficeWhere search benchmark dataset with AI system/service development terminology.",
        "target_db_bytes": target_db_bytes,
        "target_db_gib": round(target_db_bytes / 1024 / 1024 / 1024, 4),
        "actual_db_bytes": db_bytes,
        "actual_db_gib": round(db_bytes / 1024 / 1024 / 1024, 4),
        "planned_raw_utf8_bytes": raw_utf8_planned,
        "actual_raw_utf8_bytes": raw_utf8_actual,
        "file_count": len(docs),
        "chunk_count": chunk_count,
        "db_path": str(db_path),
        "output_dir": str(output_dir),
        "chunk_profile": args.chunk_profile,
        "chunk_bytes_override": args.chunk_bytes,
        "size_multiplier_assumption": RAW_UTF8_TO_SQLITE_BYTES_MULTIPLIERS[args.chunk_profile],
        "profile_counts": profile_counts,
        "queries": _normalize_query_list(args.queries),
        "scopes": args.scopes,
        "batch_size": args.batch_size,
        "seed": args.seed,
        "finalize_metrics": finalize_metrics,
        "total_generate_ms": int((perf_counter() - generation_started) * 1000),
    }
    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        f"[generate] done: db={db_bytes / 1024 / 1024 / 1024:.3f} GiB, "
        f"files={len(docs)}, chunks={chunk_count}",
        flush=True,
    )
    return manifest


def _model_dump(model: Any) -> dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()


def run_benchmarks(args: argparse.Namespace, output_dir: Path, data_dir: Path) -> list[dict[str, Any]]:
    from backend.core.search_cache import reset_search_cache_for_tests

    database = _import_database(data_dir)
    db_path = Path(database.get_db_path())
    if not db_path.exists():
        raise FileNotFoundError(f"benchmark DB does not exist: {db_path}")

    from backend.application.search_service import search_documents
    from backend.models.schemas import SearchRequest

    queries = _normalize_query_list(args.queries)
    results: list[dict[str, Any]] = []

    def run_one(*, query: str, scope: str, cache_mode: str, repeat: int) -> None:
        request = SearchRequest(
            query=query,
            limit=args.limit,
            file_limit=args.file_limit,
            file_offset=0,
            per_file_limit=args.per_file_limit,
            search_scope=scope,
        )
        started = perf_counter()
        response = search_documents(request)
        elapsed_ms = int((perf_counter() - started) * 1000)
        payload = _model_dump(response)
        results.append(
            {
                "query": query,
                "scope": scope,
                "cache_mode": cache_mode,
                "repeat": repeat,
                "elapsed_ms": elapsed_ms,
                "result_total": payload.get("total", 0),
                "file_count": payload.get("file_count", 0),
                "has_more": payload.get("has_more", False),
                "search_index_state": payload.get("search_index_state", ""),
            }
        )
        print(
            f"[bench] {cache_mode:<11} scope={scope:<16} query={query:<12} "
            f"elapsed={elapsed_ms:>5}ms files={payload.get('file_count', 0):>3}",
            flush=True,
        )

    # Cold/miss path: no search-response cache, so each request exercises DB/FTS.
    os.environ["OW_SEARCH_CACHE_MAX_ENTRIES"] = "0"
    os.environ["OW_SEARCH_CACHE_TTL_SECONDS"] = "30"
    reset_search_cache_for_tests()
    for repeat in range(1, args.cold_repeat + 1):
        for scope in args.scopes:
            for query in queries:
                run_one(query=query, scope=scope, cache_mode="cold_no_cache", repeat=repeat)

    # Warm path: first request populates the response cache, second request should
    # measure the user-facing repeat-search behavior.
    if args.warm_repeat > 0:
        os.environ["OW_SEARCH_CACHE_MAX_ENTRIES"] = str(args.cache_entries)
        os.environ["OW_SEARCH_CACHE_TTL_SECONDS"] = str(args.cache_ttl_seconds)
        for repeat in range(1, args.warm_repeat + 1):
            reset_search_cache_for_tests()
            for scope in args.scopes:
                for query in queries:
                    run_one(query=query, scope=scope, cache_mode="warm_prime", repeat=repeat)
                    run_one(query=query, scope=scope, cache_mode="warm_hit", repeat=repeat)

    result_path = output_dir / "search-benchmark-results.json"
    result_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")

    csv_path = output_dir / "search-benchmark-results.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "query",
                "scope",
                "cache_mode",
                "repeat",
                "elapsed_ms",
                "result_total",
                "file_count",
                "has_more",
                "search_index_state",
            ],
        )
        writer.writeheader()
        writer.writerows(results)

    summary = {
        "benchmarked_at": datetime.now().isoformat(),
        "db_path": str(db_path),
        "db_bytes": db_path.stat().st_size,
        "registered_files": _table_count(db_path, "registered_files"),
        "file_chunks": _table_count(db_path, "file_chunks"),
        "result_json": str(result_path),
        "result_csv": str(csv_path),
        "rows": len(results),
    }
    (output_dir / "search-benchmark-summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"[bench] wrote {result_path} and {csv_path}", flush=True)
    return results


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Create an OfficeWhere synthetic AI terminology search DB and run "
            "representative search benchmarks with NDJSON perf logs."
        )
    )
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--files", type=int, default=DEFAULT_FILE_COUNT)
    parser.add_argument("--target-gb", type=float, default=DEFAULT_TARGET_GB)
    parser.add_argument("--target-mb", type=float, default=None, help="Override target size for small smoke runs.")
    parser.add_argument("--seed", type=int, default=20260608)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--progress-every-files", type=int, default=50)
    parser.add_argument(
        "--chunk-profile",
        choices=["row-heavy", "balanced"],
        default="row-heavy",
        help=(
            "row-heavy creates many short chunks/cells and is the realistic slow-search profile; "
            "balanced creates fewer large chunks and mostly tests DB byte size."
        ),
    )
    parser.add_argument(
        "--chunk-bytes",
        type=int,
        default=None,
        help="Override generated chunk size in UTF-8 bytes for all synthetic documents.",
    )
    parser.add_argument("--force", action="store_true", help="Remove the output directory before generation.")
    parser.add_argument("--skip-generate", action="store_true", help="Benchmark an existing output directory DB.")
    parser.add_argument("--no-benchmark", action="store_true", help="Only generate the DB and manifest.")
    parser.add_argument("--cold-repeat", type=int, default=1)
    parser.add_argument("--warm-repeat", type=int, default=1)
    parser.add_argument("--cache-entries", type=int, default=64)
    parser.add_argument("--cache-ttl-seconds", type=float, default=30.0)
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--file-limit", type=int, default=20)
    parser.add_argument("--per-file-limit", type=int, default=5)
    parser.add_argument(
        "--queries",
        nargs="*",
        default=None,
        help="Queries to benchmark. Defaults cover common Korean, trigram, English, and rare terms.",
    )
    parser.add_argument(
        "--scopes",
        nargs="*",
        choices=["filename_content", "filename", "content"],
        default=["content", "filename_content"],
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)
    output_dir = args.output_dir.expanduser().resolve()

    if args.force and not args.skip_generate:
        _remove_existing_output(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    data_dir, log_path = _configure_benchmark_env(output_dir)
    _reset_index_perf_module()

    if not args.skip_generate:
        generate_dataset(args, output_dir, data_dir)
    elif not (data_dir / "data.db").exists():
        parser.error(f"--skip-generate requested but DB is missing: {data_dir / 'data.db'}")

    if not args.no_benchmark:
        run_benchmarks(args, output_dir, data_dir)

    print(
        "\n완료\n"
        f"- DB: {data_dir / 'data.db'}\n"
        f"- perf log: {log_path}\n"
        f"- manifest: {output_dir / 'manifest.json'}\n"
        f"- results: {output_dir / 'search-benchmark-results.json'}",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
