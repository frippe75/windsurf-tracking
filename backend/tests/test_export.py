"""YOLO export: generator (real frames from the fixture clip), sink registry,
route contract. No S3/ClearML/deploy needed."""
import os
import sys
import uuid
import types
import tempfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

FIXTURE = Path(__file__).resolve().parents[1] / "tests/e2e/fixtures/moving_square.mp4"


def _cls(name):
    c = types.SimpleNamespace(); c.id = uuid.uuid4(); c.name = name; return c


def _ann(frame, class_id, bbox):
    a = types.SimpleNamespace()
    a.frame_number = frame
    a.class_id = class_id
    a.geometry = {"bbox": bbox}
    return a


def test_yolo_line_converts_topleft_to_center():
    from app.export.generator import _yolo_line
    line = _yolo_line(0, {"x": 0.1, "y": 0.2, "w": 0.4, "h": 0.2})
    parts = line.split()
    assert parts[0] == "0"
    # center = (0.1+0.2, 0.2+0.1) = (0.3, 0.3); w,h passthrough
    assert [round(float(p), 3) for p in parts[1:]] == [0.3, 0.3, 0.4, 0.2]


def test_yolo_line_rejects_bad_bbox():
    from app.export.generator import _yolo_line
    assert _yolo_line(0, {"x": 0, "y": 0, "w": 0, "h": 0.2}) is None
    assert _yolo_line(0, {"x": 0}) is None


def _fixture_provider():
    """frame_number -> JPEG bytes from the fixture clip (mirrors the real extractor adapter)."""
    from io import BytesIO
    from app.frames import extract_frame_image

    def provider(frame_number: int) -> bytes:
        img = extract_frame_image(str(FIXTURE), frame_number, 10.0)
        buf = BytesIO()
        img.convert("RGB").save(buf, format="JPEG", quality=90)
        return buf.getvalue()

    return provider


@pytest.mark.skipif(not FIXTURE.exists(), reason="fixture clip missing")
def test_build_yolo_dataset_from_fixture():
    from app.export.generator import build_yolo_dataset
    cls = _cls("square")
    # square (48px) in a 320x240 frame, normalized top-left+size
    bbox = {"x": 54 / 320, "y": 54 / 240, "w": 48 / 320, "h": 48 / 240}
    anns = [_ann(0, cls.id, bbox), _ann(5, cls.id, bbox), _ann(10, cls.id, bbox),
            _ann(15, cls.id, bbox), _ann(19, cls.id, bbox)]

    with tempfile.TemporaryDirectory() as d:
        out = Path(d)
        stats = build_yolo_dataset(out, _fixture_provider(), "clip", anns, [cls], val_fraction=0.2)

        assert stats.boxes == 5 and stats.images == 5 and stats.classes == ["square"]
        jpgs = list(out.rglob("images/**/*.jpg"))
        txts = list(out.rglob("labels/**/*.txt"))
        assert len(jpgs) == 5 and len(txts) == 5
        # data.yaml lists the class
        yaml = (out / "data.yaml").read_text()
        assert "nc: 1" in yaml and "square" in yaml
        # a label line is a valid YOLO row for class 0
        sample = txts[0].read_text().strip().split("\n")[0].split()
        assert sample[0] == "0" and len(sample) == 5
        assert all(0.0 <= float(v) <= 1.0 for v in sample[1:])
        # split honored
        assert set(stats.splits) <= {"train", "val"} and sum(stats.splits.values()) == 5


def test_annotations_without_class_or_bbox_are_skipped():
    from app.export.generator import build_yolo_dataset
    cls = _cls("square")
    anns = [_ann(0, None, {"x": .1, "y": .1, "w": .1, "h": .1}),   # no class
            _ann(1, cls.id, {})]                                    # no bbox
    with tempfile.TemporaryDirectory() as d:
        # frame_provider must never be called — every annotation is skipped (no class / no bbox)
        def boom(_fn):
            raise AssertionError("frame_provider should not be called when all anns are skipped")

        stats = build_yolo_dataset(Path(d), boom, "clip", anns, [cls])
        assert stats.boxes == 0 and stats.images == 0 and stats.skipped == 2


def test_sink_registry_is_safe_without_backends():
    from app.export import sinks
    avail = sinks.available_sinks()          # no S3/clearml in CI → empty, no crash
    assert isinstance(avail, dict)
    # get_sink tolerates an empty registry
    assert sinks.get_sink("zip") is None or "zip" in avail


def test_export_routes_exist():
    from app.routers import export
    routes = {(m, r.path) for r in export.router.routes for m in getattr(r, "methods", [])}
    assert ("POST", "/api/projects/{project_id}/export") in routes
    assert ("GET", "/api/export/sinks") in routes
    # async status endpoint for the dispatched job
    assert ("GET", "/api/projects/{project_id}/export/status/{job_id}") in routes
    # dataset version inspection (P2) + lineage (P3)
    assert ("GET", "/api/dataset-versions/{version_id}") in routes
    assert ("GET", "/api/dataset-versions/{version_id}/lineage") in routes
    assert ("GET", "/api/videos/{video_id}/dataset-versions") in routes


def test_zipsink_streams_to_a_file_not_memory(monkeypatch):
    """ZipSink must upload via storage.put_file (streamed from disk), not put_bytes (RAM)."""
    from app.export import sinks
    from app import storage

    calls = {}
    monkeypatch.setattr(storage, "put_file", lambda key, path, ct="": calls.update(key=key, path=path, ct=ct))
    monkeypatch.setattr(storage, "put_bytes", lambda *a, **k: (_ for _ in ()).throw(AssertionError("must not buffer in RAM")))
    monkeypatch.setattr(storage, "presigned_get", lambda key, fname="": f"https://s3/{key}")

    with tempfile.TemporaryDirectory() as d:
        ds = Path(d) / "ds"
        (ds / "images" / "train").mkdir(parents=True)
        (ds / "images" / "train" / "a.jpg").write_bytes(b"x" * 100)
        (ds / "data.yaml").write_text("nc: 1\n")
        out = sinks.ZipSink().publish(ds, {"project_id": "p1", "name": "proj"})

    assert out["kind"] == "zip" and out["bytes"] > 0
    assert calls["key"] == "exports/p1/proj.zip"
    assert calls["path"].endswith(".zip") and not os.path.exists(calls["path"])  # temp cleaned up
    assert out["url"] == "https://s3/exports/p1/proj.zip"


def test_export_dataset_task_is_registered():
    pytest.importorskip("celery")  # present in the annotation-api:base CI image
    from app.worker import celery_app, export_dataset_task  # noqa: F401
    assert "windsurf.export_dataset" in celery_app.tasks
