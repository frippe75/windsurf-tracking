"""Ports (interfaces) for the dataset bounded context — the stable seams.

The core depends only on these Protocols, never on ffmpeg / boto3 / a wire format. Adapters live at
the edges (`frames/extractor.py`, `frames/store.py`, …) and are swapped freely in tests and in prod.
See docs/DATASET_ARCHITECTURE.md. P1 defines the frame-materialization seams; versioning/lineage
ports arrive in later phases.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable


@dataclass(frozen=True)
class FrameRef:
    """A stable, content-addressed reference to one materialized frame image."""
    video_id: str
    frame_number: int
    key: str  # storage key (e.g. S3 object key)


@runtime_checkable
class FrameExtractor(Protocol):
    """Decode a single frame from a source file and return JPEG bytes. The adapter chooses the
    mechanism (ffmpeg seek, OpenCV, …)."""

    def extract(self, source_path: str, frame_number: int, fps: float | None) -> bytes: ...


@runtime_checkable
class FrameStore(Protocol):
    """Content-addressed, idempotent frame-image persistence.

    A frame is materialized (extracted + stored) at most once, ever; subsequent requests hit the
    cache. This is what turns export from O(frames) ffmpeg work per run into a one-time cost.
    """

    def ref(self, video_id: str, frame_number: int) -> FrameRef: ...

    def exists(self, ref: FrameRef) -> bool: ...

    def get_or_materialize(
        self,
        video_id: str,
        frame_number: int,
        *,
        source_path: str,
        fps: float | None,
        extractor: FrameExtractor,
    ) -> bytes:
        """Return the frame's JPEG bytes, extracting + persisting only if not already cached."""
        ...
