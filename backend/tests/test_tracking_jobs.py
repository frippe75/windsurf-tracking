"""Tracking-job endpoints.

Regression guard: the whole tracking pipeline broke because the monolith->modular
refactor silently dropped `POST /api/videos/{id}/tracking/jobs` (the frontend's
create call) and left the tracking router as stubs — no test asserted the routes
the frontend actually calls still exist. `test_frontend_tracking_routes_exist`
is that missing contract check.
"""
import sys
import asyncio
from datetime import datetime
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def _route_set():
    from app.routers import videos, tracking
    routes = set()
    for router in (videos.router, tracking.router):
        for r in router.routes:
            for method in getattr(r, "methods", []):
                routes.add((method, r.path))
    return routes


def test_frontend_tracking_routes_exist():
    """Every tracking route lib/api.ts calls must exist on the backend."""
    routes = _route_set()
    required = {
        ("POST", "/api/videos/{video_id}/tracking/jobs"),   # createTrackingJob
        ("POST", "/api/tracking/jobs/{job_id}/execute"),    # executeTrackingJob
        ("GET", "/api/tracking/jobs/{job_id}/status"),      # getTrackingJobStatus
        ("GET", "/api/tracking/jobs/{job_id}/results"),     # getTrackingJobResults
    }
    missing = required - routes
    assert not missing, f"backend is missing routes the frontend calls: {sorted(missing)}"


def _seed_video():
    from app.routers import videos
    from app.api_models import VideoInfo

    videos.videos_db.clear()
    videos.tracking_jobs_db.clear()
    videos.videos_db["v1"] = VideoInfo(
        id="v1", filename="clip.mp4", file_path="/tmp/x.mp4",
        duration=38.96, fps=25.0, width=1920, height=1080,
        total_frames=974, upload_date=datetime(2026, 7, 11), status="ready",
    )
    return videos


def test_create_tracking_job_single():
    """A short range creates one T4-safe job with the click mapped to an object
    and the S3 key resolved for the worker to fetch."""
    videos = _seed_video()
    req = {"segments": [{
        "start_frame": 450, "end_frame": 470,
        "click_prompts": [{"x": 876, "y": 552, "type": "positive"}],
    }]}

    result = asyncio.run(videos.create_tracking_job("v1", req))

    assert "single_job" in result
    job_id = result["job_id"]
    assert job_id in videos.tracking_jobs_db
    job = videos.tracking_jobs_db[job_id]
    assert (job["start_frame"], job["end_frame"], job["frames"]) == (450, 470, 20)
    assert job["objects_data"] == [
        {"object_id": 1, "positive_points": [(876, 552)], "negative_points": []}
    ]
    assert job["s3_key"] == "videos/v1.mp4"
    assert job["status"] == "pending"


def test_create_tracking_job_auto_splits_large_range():
    """A long range is split into <=100-frame T4-safe parts, all stored."""
    videos = _seed_video()
    req = {"segments": [{
        "start_frame": 0, "end_frame": 260,
        "click_prompts": [{"x": 100, "y": 100, "type": "positive"}],
    }]}

    result = asyncio.run(videos.create_tracking_job("v1", req))

    assert result["auto_split_result"]["split_required"] is True
    created = result["auto_split_result"]["created_jobs"]
    assert len(created) == 3  # ceil(260/100)
    for part in created:
        assert part["job_id"] in videos.tracking_jobs_db
        assert part["frames"] <= 100


def test_create_tracking_job_validation():
    from app.routers import videos
    from fastapi import HTTPException

    _seed_video()

    # unknown video → 404
    with pytest.raises(HTTPException) as exc:
        asyncio.run(videos.create_tracking_job("nope", {
            "segments": [{"start_frame": 1, "end_frame": 2,
                          "click_prompts": [{"x": 1, "y": 2, "type": "positive"}]}]
        }))
    assert exc.value.status_code == 404

    # no positive prompts → 400
    with pytest.raises(HTTPException) as exc:
        asyncio.run(videos.create_tracking_job("v1", {
            "segments": [{"start_frame": 1, "end_frame": 2, "click_prompts": []}]
        }))
    assert exc.value.status_code == 400

    # end <= start → 400
    with pytest.raises(HTTPException) as exc:
        asyncio.run(videos.create_tracking_job("v1", {
            "segments": [{"start_frame": 10, "end_frame": 5,
                          "click_prompts": [{"x": 1, "y": 2, "type": "positive"}]}]
        }))
    assert exc.value.status_code == 400
