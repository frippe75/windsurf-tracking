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

    class FakeAnthropic:  # metadata extractor: echoes whether it got an image + the prompt
        def infer(self, *, prompt=None, image_png_base64=None, json_schema=None, **kw):
            return {"got_image": image_png_base64 is not None, "prompt": prompt}

    class FakeYolo:  # trained detector: echoes the version it was asked to run
        def infer(self, *, image_png_base64=None, version_id=None, conf=0.25, **kw):
            return {"detections": [{"bbox": [0.1, 0.1, 0.2, 0.2], "score": 0.9, "label": "Sail", "class_id": 0}],
                    "width": 10, "height": 10, "served_version": version_id}

    MODELS.register_instance("t-sam3", FakeSam3(), capabilities=["concept-segment", "segment-click"])
    MODELS.register_instance("t-sam2", FakeSam2(), capabilities=["segment-click"])
    MODELS.register_instance("t-vlm", FakeVlm(), capabilities=["vlm-extract"])
    MODELS.register_instance("t-track", FakeTrack(), capabilities=["concept-track"])
    MODELS.register_instance("t-claude", FakeAnthropic(), capabilities=["metadata-extract"])
    MODELS.register_instance("t-yolo", FakeYolo(), capabilities=["detect"])
    c = TestClient(create_app())
    try:
        yield c
    finally:
        for n in ("t-sam3", "t-sam2", "t-vlm", "t-track", "t-claude", "t-yolo"):
            MODELS._instances.pop(n, None)
            MODELS._caps.pop(n, None)


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200 and "t-sam3" in r.json()["models"]


def test_openapi_spec_served(client):
    r = client.get("/openapi.json")
    assert r.status_code == 200
    assert "/metadata" in r.json()["paths"]


def test_openapi_follows_service_prefix(monkeypatch):
    # behind the /pipeline ingress the spec must live under the prefix, not app-root
    import pipeline_service.app as appmod

    monkeypatch.setenv("SERVICE_PREFIX", "/pipeline")
    c = TestClient(appmod.create_app())
    assert c.get("/pipeline/openapi.json").status_code == 200
    assert c.get("/openapi.json").status_code == 404


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


def test_detect_routes_to_trained_yolo(client):
    r = client.post("/detect", json={"capability": "detect", "inputs": {"version_id": "dsv_x", "image_png_base64": "aGk="}})
    assert r.status_code == 200
    body = r.json()
    assert body["model"] == "t-yolo"
    assert body["served_version"] == "dsv_x"
    assert body["detections"][0]["label"] == "Sail"


def test_detect_extracts_frame_from_video(client, monkeypatch):
    import pipeline_service.app as appmod

    monkeypatch.setattr(appmod, "_resolve_stream_url", lambda vid: "u")
    monkeypatch.setattr(appmod, "_extract_frame_b64", lambda url, t: "FRAMEB64")
    r = client.post("/detect", json={"capability": "detect", "inputs": {"version_id": "dsv_x", "video_id": "v", "time_sec": 2.0}})
    assert r.status_code == 200 and r.json()["model"] == "t-yolo"


def test_metadata_text_only_draft(client):
    # no frames -> text-only call (schema auto-draft), no image
    r = client.post("/metadata", json={"capability": "metadata-extract", "inputs": {"schema": {"type": "object"}, "prompt": "draft"}})
    assert r.status_code == 200
    assert r.json()["model"] == "t-claude"
    assert r.json()["result"] == {"got_image": False, "prompt": "draft"}


def test_metadata_grid_extract(client, monkeypatch):
    import pipeline_service.app as appmod

    monkeypatch.setattr(appmod, "_resolve_stream_url", lambda vid: "u")
    monkeypatch.setattr(appmod, "_extract_frame_b64", lambda url, t: _square_mask_b64())  # a real PNG per frame
    r = client.post("/metadata", json={"capability": "metadata-extract", "inputs": {
        "schema": {"type": "object"}, "video_id": "v", "time_secs": [1, 2, 3, 4]}})
    assert r.status_code == 200
    assert r.json()["result"]["got_image"] is True  # frames -> grid image was built + passed


def test_metadata_skips_unreadable_frames(client, monkeypatch):
    # one timestamp past end-of-clip must not fail the whole grid — skip it, use the rest
    import pipeline_service.app as appmod
    from fastapi import HTTPException

    monkeypatch.setattr(appmod, "_resolve_stream_url", lambda vid: "u")

    def flaky(url, t):
        if t >= 100:
            raise HTTPException(502, "could not read a frame from the video url: no output")
        return _square_mask_b64()

    monkeypatch.setattr(appmod, "_extract_frame_b64", flaky)
    r = client.post("/metadata", json={"capability": "metadata-extract", "inputs": {
        "schema": {"type": "object"}, "video_id": "v", "time_secs": [1, 2, 99999]}})
    assert r.status_code == 200
    assert r.json()["result"]["got_image"] is True  # built from the 2 good frames


def test_metadata_all_frames_unreadable_502(client, monkeypatch):
    import pipeline_service.app as appmod
    from fastapi import HTTPException

    monkeypatch.setattr(appmod, "_resolve_stream_url", lambda vid: "u")

    def dead(url, t):
        raise HTTPException(502, "no output")

    monkeypatch.setattr(appmod, "_extract_frame_b64", dead)
    r = client.post("/metadata", json={"capability": "metadata-extract", "inputs": {
        "schema": {"type": "object"}, "video_id": "v", "time_secs": [99999]}})
    assert r.status_code == 502
    assert "no readable frames" in r.json()["detail"]


def test_build_train_job_manifest():
    import pipeline_service.app as appmod

    spec = {"dataset_url": "https://s3/ds.zip", "project_id": "abc12345-xyz", "epochs": 10, "imgsz": 512, "model": "yolov8s.pt"}
    m = appmod.build_train_job(
        spec, image="harbor/train:v1", namespace="windsurf-prod", s3_secret="windsurf-s3-secret",
        s3_endpoint="http://s3", s3_bucket="windsurf-videos",
    )
    assert m["kind"] == "Job"
    assert m["metadata"]["name"] == appmod.train_job_name(spec)
    ann = m["metadata"]["annotations"]
    assert ann[appmod.RESULTS_ANNOTATION] == appmod.train_results_prefix(spec)
    assert ann[appmod.MODEL_ANNOTATION] == "yolov8s.pt" and ann[appmod.EPOCHS_ANNOTATION] == "10"
    pod = m["spec"]["template"]["spec"]
    c = pod["containers"][0]
    assert c["image"] == "harbor/train:v1"
    assert c["resources"]["limits"]["nvidia.com/gpu"] == 1
    # /dev/shm mount so PyTorch dataloader workers don't deadlock on the 64Mi default
    assert {"name": "dshm", "mountPath": "/dev/shm"} in c["volumeMounts"]
    assert pod["volumes"][0]["emptyDir"]["medium"] == "Memory"
    env = {e["name"]: e for e in c["env"]}
    assert env["DATASET_URL"]["value"] == "https://s3/ds.zip"
    assert env["TRAIN_EPOCHS"]["value"] == "10"
    assert env["S3_ACCESS_KEY"]["valueFrom"]["secretKeyRef"]["name"] == "windsurf-s3-secret"


def test_build_train_job_carries_dataset_version_for_lineage():
    import pipeline_service.app as appmod

    spec = {"dataset_url": "u", "project_id": "p", "dataset_version_id": "dsv_abc", "model": "yolov8n.pt", "epochs": 5}
    m = appmod.build_train_job(spec, image="i", namespace="n", s3_secret="s", s3_endpoint="e", s3_bucket="b")
    assert m["metadata"]["annotations"][appmod.DATASET_VERSION_ANNOTATION] == "dsv_abc"


def test_build_model_run_lineage_record():
    import pipeline_service.app as appmod

    run = appmod.build_model_run(
        run_id="train-1", dataset_version_id="dsv_x", model="yolov8n.pt", epochs="15",
        metrics={"mAP50": 0.84}, results_prefix="exports/p/train-1/", created_at="t",
    )
    assert run == {
        "run_id": "train-1", "dataset_version_id": "dsv_x", "model": "yolov8n.pt", "epochs": 15,
        "metrics": {"mAP50": 0.84}, "weights_key": "exports/p/train-1/best.pt", "created_at": "t",
    }


def test_train_job_name_is_idempotent_per_dataset():
    import pipeline_service.app as appmod

    a = appmod.train_job_name({"project_id": "p", "dataset_url": "u"})
    b = appmod.train_job_name({"project_id": "p", "dataset_url": "u"})
    c = appmod.train_job_name({"project_id": "p", "dataset_url": "u2"})
    assert a == b and a != c and a.startswith("train-")


def test_train_route_submits_and_polls(client, monkeypatch):
    import pipeline_service.app as appmod

    monkeypatch.setattr(appmod, "train_submit", lambda spec: "train-deadbeef")
    monkeypatch.setattr(appmod, "train_status", lambda jid: {"job_id": jid, "status": "succeeded", "metrics": {"mAP50": 0.9}})
    r = client.post("/train", json={"dataset_url": "https://s3/ds.zip", "project_id": "p1"})
    assert r.status_code == 200 and r.json()["job_id"] == "train-deadbeef"
    s = client.get("/train/train-deadbeef")
    assert s.status_code == 200 and s.json()["metrics"]["mAP50"] == 0.9


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
