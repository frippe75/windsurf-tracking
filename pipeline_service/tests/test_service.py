"""Service tests — routing by name/capability, no network (fake handles)."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from pipeline_engine.errors import ModelError
from pipeline_engine.models import MODELS
from pipeline_service.app import create_app


def _square_mask_b64() -> str:
    """A white square on black -> a clean 4-point contour for polygon-conversion tests."""
    import base64
    import io

    from PIL import Image

    im = Image.new("L", (100, 100), 0)
    for y in range(30, 70):
        for x in range(30, 70):
            im.putpixel((x, y), 255)
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


@pytest.fixture
def client():
    class FakeSam3:  # concept + click
        def infer(self, *, image_png_base64=None, text=None, **kw):
            return {"detections": [{"bbox": [1, 2, 3, 4], "score": 0.9, "label": text,
                                    "mask_base64": _square_mask_b64()}]}

    class FakeSam2:  # click only
        def infer(self, *, video_id=None, frame_number=None, points=None, **kw):
            if video_id is None:
                raise TypeError("video_id required")
            return {"bbox": [0, 0, 10, 10], "mask_base64": "m", "score": 0.8}

    class FakeVlm:
        def infer(self, **kw):
            raise ModelError("endpoint unreachable")

    class FakeTrack:  # async video tracker: submit -> job id, poll -> per-frame masklets
        def submit(self, *, frames_b64, start_frame, text):
            assert frames_b64 and text
            return "job-123"

        def poll(self, *, job_id):
            return {"status": "COMPLETED", "output": {
                "image_size": [1000, 500],
                "frames": [{"frame_number": 5, "objects": [
                    {"object_id": 0, "bbox": [100, 50, 300, 250], "score": 0.9,
                     "mask_base64": _square_mask_b64()}]}],
            }}

    MODELS.register_instance("t-sam3", FakeSam3(), capabilities=["concept-segment", "segment-click"])
    MODELS.register_instance("t-sam2", FakeSam2(), capabilities=["segment-click"])
    MODELS.register_instance("t-vlm", FakeVlm(), capabilities=["vlm-extract"])
    MODELS.register_instance("t-track", FakeTrack(), capabilities=["concept-track"])
    c = TestClient(create_app())
    try:
        yield c
    finally:
        for n in ("t-sam3", "t-sam2", "t-vlm", "t-track"):
            MODELS._instances.pop(n, None)
            MODELS._caps.pop(n, None)


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200 and "t-sam3" in r.json()["models"]


def test_models_filtered_by_capability(client):
    names = [m["name"] for m in client.get("/models", params={"capability": "concept-segment"}).json()["models"]]
    assert names == ["t-sam3"]  # sam2 (click-only) excluded
    click = [m["name"] for m in client.get("/models", params={"capability": "segment-click"}).json()["models"]]
    assert click == ["t-sam2", "t-sam3"]  # sorted


def test_segment_concept_by_name(client):
    r = client.post("/segment", json={"model": "t-sam3",
                                      "inputs": {"image_png_base64": "aGk=", "text": "windsurf sail rig"}})
    assert r.status_code == 200
    body = r.json()
    assert body["model"] == "t-sam3"
    det = body["result"]["detections"][0]
    assert det["label"] == "windsurf sail rig"
    # mask PNG -> polygon (pct), PNG dropped
    assert "mask_base64" not in det
    assert isinstance(det["polygon"], list) and len(det["polygon"]) >= 3


def test_segment_by_capability_picks_first(client):
    r = client.post("/segment", json={"capability": "segment-click",
                                      "inputs": {"video_id": "v", "frame_number": 0,
                                                 "points": [{"x": 1, "y": 2, "type": "positive"}]}})
    assert r.status_code == 200
    assert r.json()["model"] == "t-sam2" and "bbox" in r.json()["result"]


def test_unknown_model_404(client):
    assert client.post("/segment", json={"model": "nope", "inputs": {}}).status_code == 404


def test_no_capability_match_404(client):
    assert client.post("/segment", json={"capability": "embed", "inputs": {}}).status_code == 404


def test_missing_selector_400(client):
    assert client.post("/segment", json={"inputs": {}}).status_code == 400


def test_bad_inputs_400(client):
    # sam2 handle requires video_id -> TypeError -> 400
    r = client.post("/segment", json={"model": "t-sam2", "inputs": {}})
    assert r.status_code == 400


def test_model_error_502(client):
    r = client.post("/segment", json={"model": "t-vlm", "inputs": {}})
    assert r.status_code == 502


def test_segment_video_id_resolves_and_extracts(client, monkeypatch):
    # video_id -> resolve stream url (backend) -> extract frame -> handle
    import pipeline_service.app as appmod

    monkeypatch.setattr(appmod, "_resolve_stream_url", lambda vid: f"https://s3/{vid}.mp4")
    monkeypatch.setattr(appmod, "_extract_frame_b64", lambda url, t: "FRAMEB64")
    r = client.post("/segment", json={
        "model": "t-sam3",
        "inputs": {"video_id": "abc", "time_sec": 1.0, "text": "windsurf sail rig"},
    })
    assert r.status_code == 200
    assert r.json()["result"]["detections"][0]["label"] == "windsurf sail rig"


def test_track_submit_and_status(client, monkeypatch):
    import pipeline_service.app as appmod

    monkeypatch.setattr(appmod, "_resolve_stream_url", lambda vid: f"https://s3/{vid}.mp4")
    monkeypatch.setattr(appmod, "_extract_window_b64", lambda url, s, c, f: ["F1", "F2", "F3"])
    r = client.post("/track", json={"capability": "concept-track", "inputs": {
        "video_id": "abc", "start_frame": 5, "end_frame": 30, "fps": 30, "text": "windsurf sail rig"}})
    assert r.status_code == 200
    body = r.json()
    assert body["model"] == "t-track" and body["job_id"] == "job-123" and body["start_frame"] == 5

    s = client.get("/track/job-123", params={"model": "t-track"})
    assert s.status_code == 200
    sb = s.json()
    assert sb["status"] == "COMPLETED" and sb["count"] == 1
    obj = sb["frames"][0]["objects"][0]
    assert obj["object_id"] == 0
    # bbox px [100,50,300,250] over image_size [1000,500] -> percent
    assert obj["bbox_pct"] == [10.0, 10.0, 30.0, 50.0]
    # mask PNG is converted to a compact polygon (pct) and the PNG is dropped
    assert "mask_base64" not in obj
    assert isinstance(obj["polygon"], list) and len(obj["polygon"]) >= 3
    assert all(0 <= p["x"] <= 100 and 0 <= p["y"] <= 100 for p in obj["polygon"])


def test_warmth_reports_non_serverless_for_local_models(client):
    import pipeline_service.app as appmod

    appmod._WARMTH_CACHE["ts"] = 0.0  # bypass the 15s cache
    r = client.get("/warmth")
    assert r.status_code == 200
    w = r.json()["warmth"]
    # fake in-process handles have no RunPod base_url -> not serverless, no network hit
    assert w["t-sam3"]["serverless"] is False
    assert w["t-track"]["serverless"] is False


def test_track_needs_text_and_video_id(client):
    r = client.post("/track", json={"capability": "concept-track", "inputs": {"text": "x"}})
    assert r.status_code == 400


def test_track_on_non_track_model_400(client, monkeypatch):
    import pipeline_service.app as appmod

    monkeypatch.setattr(appmod, "_resolve_stream_url", lambda vid: "u")
    monkeypatch.setattr(appmod, "_extract_window_b64", lambda url, s, c, f: ["F1"])
    r = client.post("/track", json={"model": "t-sam3", "inputs": {"video_id": "a", "text": "x"}})
    assert r.status_code == 400  # t-sam3 has no submit()


def test_segment_video_url_extracts_frame(client, monkeypatch):
    # video_url in inputs -> server-side frame extraction fills image_png_base64
    import pipeline_service.app as appmod

    monkeypatch.setattr(appmod, "_extract_frame_b64", lambda url, t: "FRAMEB64")
    r = client.post("/segment", json={
        "model": "t-sam3",
        "inputs": {"video_url": "http://x/v.mp4", "time_sec": 1.5, "text": "windsurf sail rig"},
    })
    assert r.status_code == 200
    assert r.json()["result"]["detections"][0]["label"] == "windsurf sail rig"
