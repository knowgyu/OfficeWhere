#!/usr/bin/env python3
"""Validate README demo media assets.

The capture script writes a JSON report for GIF demos and static PNG/JPEG
screenshots. This validator also accepts older WebP/MP4/WebM demo assets.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from PIL import Image, ImageSequence

DEFAULT_MAX_WIDTH = 1600
DEFAULT_MAX_HEIGHT = 1100
DEFAULT_MAX_DURATION_MS = 35_000
DEFAULT_MAX_BYTES = 14 * 1024 * 1024


def _frame_duration_ms(frame: Image.Image) -> int:
    try:
        return int(frame.info.get("duration", 0))
    except Exception:
        return 0


def _animated_image_metrics(path: Path) -> dict[str, Any]:
    with Image.open(path) as image:
        width, height = image.size
        frame_count = 0
        duration_ms = 0
        for frame in ImageSequence.Iterator(image):
            frame_count += 1
            duration_ms += _frame_duration_ms(frame)
        frame_count = max(1, frame_count)
        fps = round((frame_count * 1000 / duration_ms), 2) if duration_ms > 0 else 0
    return {
        "path": str(path),
        "kind": path.suffix.lower().lstrip("."),
        "bytes": path.stat().st_size,
        "width": width,
        "height": height,
        "frame_count": frame_count,
        "duration_ms": duration_ms,
        "fps": fps,
    }


def _report_metrics(report_path: Path) -> list[dict[str, Any]]:
    report = json.loads(report_path.read_text(encoding="utf-8"))
    items = []
    for clip in [*report.get("clips", []), *report.get("stills", [])]:
        output = Path(clip["output"])
        metrics = {
            "path": str(output),
            "kind": output.suffix.lower().lstrip("."),
            "bytes": output.stat().st_size if output.exists() else 0,
            "width": int(clip.get("width", 0)),
            "height": int(clip.get("height", 0)),
            "frame_count": clip.get("frame_count"),
            "duration_ms": None if clip.get("duration_ms") is None else int(clip.get("duration_ms", 0)),
            "fps": clip.get("fps"),
        }
        items.append(metrics)
    return items


def _asset_metrics(path: Path) -> dict[str, Any]:
    suffix = path.suffix.lower()
    if suffix in {".webp", ".gif"}:
        return _animated_image_metrics(path)
    if suffix in {".png", ".jpg", ".jpeg"}:
        with Image.open(path) as image:
            width, height = image.size
        return {
            "path": str(path),
            "kind": suffix.lstrip("."),
            "bytes": path.stat().st_size,
            "width": width,
            "height": height,
            "frame_count": 1,
            "duration_ms": None,
            "fps": None,
        }
    if suffix in {".webm", ".mp4", ".mov"}:
        return {
            "path": str(path),
            "kind": suffix.lstrip("."),
            "bytes": path.stat().st_size,
            "width": None,
            "height": None,
            "frame_count": None,
            "duration_ms": None,
            "fps": None,
        }
    raise ValueError(f"unsupported media type: {path}")


def validate(items: list[dict[str, Any]], args: argparse.Namespace) -> dict[str, Any]:
    results = []
    for metrics in items:
        path = Path(metrics["path"])
        width = metrics.get("width")
        height = metrics.get("height")
        duration_ms = metrics.get("duration_ms")
        checks = {
            "exists": path.exists(),
            "media_type_ok": path.suffix.lower() in {".gif", ".webm", ".webp", ".mp4", ".mov", ".png", ".jpg", ".jpeg"},
            "size_ok": int(metrics.get("bytes") or 0) <= args.max_bytes,
            "width_ok": width is None or int(width) <= args.max_width,
            "height_ok": height is None or int(height) <= args.max_height,
            "duration_ok": duration_ms is None or int(duration_ms) <= args.max_duration_ms,
        }
        metrics["checks"] = checks
        metrics["ok"] = all(checks.values())
        results.append(metrics)
    return {
        "ok": all(item["ok"] for item in results),
        "limits": {
            "max_width": args.max_width,
            "max_height": args.max_height,
            "max_duration_ms": args.max_duration_ms,
            "max_bytes": args.max_bytes,
        },
        "assets": results,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("assets", nargs="*", type=Path, help="Media assets to validate")
    parser.add_argument("--media-report", type=Path, help="Capture report with video dimensions and duration")
    parser.add_argument("--max-width", type=int, default=DEFAULT_MAX_WIDTH)
    parser.add_argument("--max-height", type=int, default=DEFAULT_MAX_HEIGHT)
    parser.add_argument("--max-duration-ms", type=int, default=DEFAULT_MAX_DURATION_MS)
    parser.add_argument("--max-bytes", type=int, default=DEFAULT_MAX_BYTES)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    items: list[dict[str, Any]] = []
    if args.media_report:
        items.extend(_report_metrics(args.media_report))
    items.extend(_asset_metrics(path) for path in args.assets)
    if not items:
        parser.error("provide assets or --media-report")

    report = validate(items, args)
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        for item in report["assets"]:
            kib = int(item.get("bytes") or 0) / 1024
            print(
                f"{item['path']}: {item.get('width')}x{item.get('height')}, "
                f"{item.get('duration_ms')} ms, {kib:.1f} KiB, ok={item['ok']}"
            )
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
