"""FrameStore adapters — the `storage` seam.

`S3FrameStore` is the production adapter: each frame lives at a deterministic key
`frames/{video_id}/{frame:08d}.jpg` and is materialized exactly once (extract → put). Every later
export/version reuses it — no re-decoding. `InMemoryFrameStore` is the test/local fake with the same
contract. See docs/DATASET_ARCHITECTURE.md §5.
"""
from __future__ import annotations

from ..ports import FrameExtractor, FrameRef


def frame_key(video_id: str, frame_number: int) -> str:
    """Canonical, sortable, content-addressable-by-(video,frame) storage key."""
    return f"frames/{video_id}/{frame_number:08d}.jpg"


class S3FrameStore:
    """Persistent frame cache backed by the app's S3 storage layer."""

    def ref(self, video_id: str, frame_number: int) -> FrameRef:
        return FrameRef(video_id, frame_number, frame_key(video_id, frame_number))

    def exists(self, ref: FrameRef) -> bool:
        from ... import storage

        return storage.object_exists(ref.key)

    def get_or_materialize(
        self, video_id: str, frame_number: int, *, source_path: str, fps: float | None, extractor: FrameExtractor
    ) -> bytes:
        from ... import storage

        ref = self.ref(video_id, frame_number)
        if storage.object_exists(ref.key):
            return storage.get_bytes(ref.key)  # cache hit — no ffmpeg
        data = extractor.extract(source_path, frame_number, fps)
        storage.put_bytes(ref.key, data, "image/jpeg")
        return data


class InMemoryFrameStore:
    """In-memory FrameStore — the test/local adapter. Tracks materialize() calls so idempotence is
    assertable."""

    def __init__(self) -> None:
        self._data: dict[str, bytes] = {}
        self.materialize_calls = 0

    def ref(self, video_id: str, frame_number: int) -> FrameRef:
        return FrameRef(video_id, frame_number, frame_key(video_id, frame_number))

    def exists(self, ref: FrameRef) -> bool:
        return ref.key in self._data

    def get_or_materialize(
        self, video_id: str, frame_number: int, *, source_path: str, fps: float | None, extractor: FrameExtractor
    ) -> bytes:
        ref = self.ref(video_id, frame_number)
        if ref.key in self._data:
            return self._data[ref.key]
        self.materialize_calls += 1
        data = extractor.extract(source_path, frame_number, fps)
        self._data[ref.key] = data
        return data
