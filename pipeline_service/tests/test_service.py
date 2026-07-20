"""Service tests — routing by name/capability, no network (fake handles)."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from pipeline_engine.errors import ModelError
from pipeline_engine.models import MODELS
from pipeline_service.app import create_app


@pytest.fixture
def client():
    class FakeSam3:  # concept + click
        def infer(self, *, image_png_base64=None, text=None, **kw):
            return {"detections": [{"bbox": [1, 2, 3, 4], "score": 0.9, "label": text}]}

    class FakeSam2:  # click only
        def infer(self, *, video_id=None, frame_number=None, points=None, **kw):
            if video_id is None:
                raise TypeError("video_id required")
            return {"bbox": [0, 0, 10, 10], "mask_base64": "m", "score": 0.8}

    class FakeVlm:
        def infer(self, **kw):
            raise ModelError("endpoint unreachable")

    MODELS.register_instance("t-sam3", FakeSam3(), capabilities=["concept-segment", "segment-click"])
    MODELS.register_instance("t-sam2", FakeSam2(), capabilities=["segment-click"])
    MODELS.register_instance("t-vlm", FakeVlm(), capabilities=["vlm-extract"])
    c = TestClient(create_app())
    try:
        yield c
    finally:
        for n in ("t-sam3", "t-sam2", "t-vlm"):
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
    assert body["result"]["detections"][0]["label"] == "windsurf sail rig"


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
