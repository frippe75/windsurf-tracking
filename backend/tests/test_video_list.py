"""The video list must expose width/height (not only a resolution string) —
the frontend maps them to native click-prompt coordinates. Missing them made
non-1280x720 videos mis-scale clicks (SAM2 segmented the wrong region)."""
import sys
from datetime import datetime
from pathlib import Path
import asyncio
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def test_list_videos_includes_width_height(monkeypatch):
    from app.routers import videos
    from app.api_models import VideoInfo

    videos.videos_db.clear()
    videos.videos_db["v1"] = VideoInfo(
        id="v1", filename="clip.mp4", file_path="/tmp/x.mp4",
        duration=38.96, fps=25.0, width=1920, height=1080,
        total_frames=974, upload_date=datetime(2026, 7, 11), status="ready",
    )
    # Skip the S3 reconcile side effect
    monkeypatch.setattr(videos, "reconcile_from_s3", lambda: None)

    result = asyncio.run(videos.list_videos())
    v = result["videos"][0]
    assert v["width"] == 1920
    assert v["height"] == 1080
    assert v["resolution"] == "1920x1080"  # kept for back-compat
