"""Dataset format writers — the `format` seam. Add a format = a new writer in this list.

Mirrors the export-sink registry pattern: `get_writer(name)` / `writer_names()`.
"""
from __future__ import annotations

from .coco import CocoWriter
from .yolo import YoloWriter

_WRITERS = {w.name: w for w in (YoloWriter(), CocoWriter())}


def get_writer(name: str | None):
    return _WRITERS.get(name or "yolo")


def writer_names() -> list[str]:
    return sorted(_WRITERS)
