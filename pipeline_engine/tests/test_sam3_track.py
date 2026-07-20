"""SAM3 video-track handle: async submit/poll over RunPod /run + /status (mocked urllib)."""
from __future__ import annotations

import io
import json

import pytest

from pipeline_engine.errors import ModelError
from pipeline_engine.models import HANDLES, ModelConfig


def _resp(payload):
    class R(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    return R(json.dumps(payload).encode())


def test_track_handle_registered():
    assert "sam3-runpod-track" in HANDLES.names()


def _handle():
    cfg = ModelConfig(type="sam3-runpod-track", capabilities=["concept-track"],
                      base_url="https://api.runpod.ai/v2/vid", timeout_s=5)
    return HANDLES.get("sam3-runpod-track")(cfg)


def test_submit_posts_run_and_returns_job_id(monkeypatch):
    seen = {}

    def fake_urlopen(req, timeout=None):
        seen["url"] = req.full_url
        seen["body"] = json.loads(req.data.decode())
        return _resp({"id": "job-xyz", "status": "IN_QUEUE"})

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    jid = _handle().submit(frames_b64=["A", "B"], start_frame=7, text="windsurf sail rig")
    assert jid == "job-xyz"
    assert seen["url"].endswith("/run")
    assert seen["body"]["input"]["start_frame"] == 7
    assert seen["body"]["input"]["frames_b64"] == ["A", "B"]
    assert seen["body"]["input"]["text"] == "windsurf sail rig"


def test_poll_returns_output(monkeypatch):
    def fake_urlopen(req, timeout=None):
        return _resp({"status": "COMPLETED", "output": {"frames": [{"frame_number": 0, "objects": []}],
                                                        "image_size": [100, 50]}})

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    res = _handle().poll(job_id="job-xyz")
    assert res["status"] == "COMPLETED"
    assert res["output"]["image_size"] == [100, 50]


def test_poll_surfaces_worker_error(monkeypatch):
    def fake_urlopen(req, timeout=None):
        return _resp({"status": "COMPLETED", "output": {"error": "ffmpeg failed"}})

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    res = _handle().poll(job_id="job-xyz")
    assert res["status"] == "COMPLETED" and res["error"] == "ffmpeg failed" and "output" not in res


def test_submit_no_job_id_raises(monkeypatch):
    monkeypatch.setattr("urllib.request.urlopen", lambda req, timeout=None: _resp({"status": "?"}))
    with pytest.raises(ModelError):
        _handle().submit(frames_b64=["A"], start_frame=0, text="x")
