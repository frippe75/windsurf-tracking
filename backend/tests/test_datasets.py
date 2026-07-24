"""Frame-store bounded context (P1): idempotent, content-addressed frame materialization.

Pure — no S3/ffmpeg needed (uses fakes), mirroring how pipeline_service tests fake handles.
"""
from app.datasets.frames.store import InMemoryFrameStore, S3FrameStore, frame_key


class _CountingExtractor:
    """A fake FrameExtractor that records how many decodes happened."""

    def __init__(self):
        self.calls = 0

    def extract(self, source_path, frame_number, fps):
        self.calls += 1
        return f"jpeg:{frame_number}".encode()


def test_frame_key_is_sortable_and_addressed_by_video_and_frame():
    assert frame_key("vid", 42) == "frames/vid/00000042.jpg"
    # zero-padded so lexical order == numeric order
    assert frame_key("v", 9) < frame_key("v", 10)


def test_inmemory_store_materializes_each_frame_exactly_once():
    store = InMemoryFrameStore()
    ext = _CountingExtractor()

    a = store.get_or_materialize("v1", 5, source_path="x", fps=30, extractor=ext)
    b = store.get_or_materialize("v1", 5, source_path="x", fps=30, extractor=ext)  # cache hit

    assert a == b == b"jpeg:5"
    assert ext.calls == 1               # decoded once, second call served from cache
    assert store.materialize_calls == 1
    assert store.exists(store.ref("v1", 5))
    assert not store.exists(store.ref("v1", 6))


def test_s3_store_key_and_caching(monkeypatch):
    from app import storage

    bucket: dict[str, bytes] = {}
    monkeypatch.setattr(storage, "object_exists", lambda k: k in bucket)
    monkeypatch.setattr(storage, "put_bytes", lambda k, d, ct="": bucket.__setitem__(k, d))
    monkeypatch.setattr(storage, "get_bytes", lambda k: bucket[k])

    store = S3FrameStore()
    ext = _CountingExtractor()
    assert store.ref("vid", 42).key == "frames/vid/00000042.jpg"

    d1 = store.get_or_materialize("vid", 42, source_path="p", fps=30, extractor=ext)
    d2 = store.get_or_materialize("vid", 42, source_path="p", fps=30, extractor=ext)

    assert d1 == d2 == b"jpeg:42"
    assert ext.calls == 1                          # ffmpeg once; second run is a cache hit
    assert "frames/vid/00000042.jpg" in bucket     # persisted to S3
