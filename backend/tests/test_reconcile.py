"""
Tests for S3-driven video reconciliation — the download is a Celery job whose
durable output is the S3 object, so the backend's video index must derive from
S3, not from a client polling the job status.

Run: cd backend && python -m pytest tests/ -v
"""
import sys
import types
from datetime import datetime
from pathlib import Path

import pytest

# Make `app` importable without the full app dependency graph
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture
def videos_mod(monkeypatch):
    """Import app.routers.videos with a fake storage module injected."""
    from app import storage as real_storage
    from app.routers import videos

    # Fake S3 bucket: video_id -> metadata dict
    bucket = {}

    def fake_enabled():
        return True

    def fake_list_video_ids():
        return list(bucket.keys())

    def fake_head_metadata(vid):
        return bucket[vid]

    monkeypatch.setattr(videos.storage, "enabled", fake_enabled)
    monkeypatch.setattr(videos.storage, "list_video_ids", fake_list_video_ids)
    monkeypatch.setattr(videos.storage, "head_metadata", fake_head_metadata)
    monkeypatch.setattr(videos.storage, "LOCAL_CACHE_DIR", Path("/tmp/uploads"))

    videos.videos_db.clear()
    return videos, bucket


def _meta(**over):
    m = {
        "filename": "clip.mp4",
        "duration": "38.9",
        "fps": "25",
        "width": "1920",
        "height": "1080",
        "total_frames": "974",
        "upload_date": "2026-07-13T10:00:00",
    }
    m.update(over)
    return m


def test_video_info_from_s3_meta_parses_types(videos_mod):
    videos, _ = videos_mod
    vi = videos.video_info_from_s3_meta("vid1", _meta())
    assert vi.id == "vid1"
    assert vi.filename == "clip.mp4"
    assert vi.width == 1920 and vi.height == 1080
    assert vi.fps == 25.0
    assert vi.total_frames == 974
    assert vi.status == "ready"


def test_video_info_defaults_when_meta_missing(videos_mod):
    videos, _ = videos_mod
    vi = videos.video_info_from_s3_meta("vid2", {})
    assert vi.filename == "vid2.mp4"
    assert vi.width == 0 and vi.total_frames == 0
    assert isinstance(vi.upload_date, datetime)


def test_reconcile_indexes_bucket_video_without_polling(videos_mod):
    """The core fix: a completed job's S3 object gets indexed on reconcile,
    with no status-endpoint poll involved."""
    videos, bucket = videos_mod
    bucket["job-out"] = _meta(filename="Why_I_Windsurf.mp4")

    assert "job-out" not in videos.videos_db  # not yet indexed
    videos.reconcile_from_s3()
    assert "job-out" in videos.videos_db
    assert videos.videos_db["job-out"].filename == "Why_I_Windsurf.mp4"


def test_reconcile_is_incremental_and_idempotent(videos_mod):
    videos, bucket = videos_mod
    bucket["a"] = _meta()
    videos.reconcile_from_s3()
    first = videos.videos_db["a"]

    # Re-running must not rebuild an already-indexed entry (identity preserved)
    videos.reconcile_from_s3()
    assert videos.videos_db["a"] is first


def test_reconcile_never_raises_on_storage_error(videos_mod, monkeypatch):
    videos, _ = videos_mod

    def boom():
        raise RuntimeError("S3 down")

    monkeypatch.setattr(videos.storage, "list_video_ids", boom)
    videos.reconcile_from_s3()  # must swallow, not raise


def test_reconcile_noop_when_storage_disabled(videos_mod, monkeypatch):
    videos, bucket = videos_mod
    bucket["a"] = _meta()
    monkeypatch.setattr(videos.storage, "enabled", lambda: False)
    videos.reconcile_from_s3()
    assert "a" not in videos.videos_db
