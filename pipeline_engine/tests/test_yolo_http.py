"""YoloHttpHandle: posts to yolo-serve /detect and normalizes the response (mocked urllib)."""
from __future__ import annotations

import io
import json

import pytest

from pipeline_engine.errors import ModelError
from pipeline_engine.handles.yolo_http import YoloHttpHandle
from pipeline_engine.models import HANDLES, ModelConfig


def test_registered():
    assert "yolo-http" in HANDLES.names()


def _cfg():
    return ModelConfig(type="yolo-http", capabilities=["detect"], base_url="http://yolo-serve:8080", timeout_s=5)


def test_posts_detect_and_returns_detections(monkeypatch):
    captured = {}

    class FakeResp:
        def __enter__(self):
            return self
        def __exit__(self, *a):
            return False
        def read(self):
            return json.dumps({"detections": [{"bbox": [0.1, 0.1, 0.2, 0.2], "score": 0.9, "label": "Sail"}],
                               "width": 640, "height": 480}).encode()

    def fake_urlopen(req, timeout=None):
        captured["url"] = req.full_url
        captured["body"] = json.loads(req.data.decode())
        return FakeResp()

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    out = YoloHttpHandle(_cfg()).infer(image_png_base64="aGk=", version_id="dsv_x", conf=0.3)

    assert captured["url"] == "http://yolo-serve:8080/detect"
    assert captured["body"] == {"version_id": "dsv_x", "image_png_base64": "aGk=", "conf": 0.3}
    assert out["detections"][0]["label"] == "Sail" and out["width"] == 640


def test_requires_image_and_version():
    with pytest.raises(ModelError):
        YoloHttpHandle(_cfg()).infer(image_png_base64=None, version_id="dsv_x")
    with pytest.raises(ModelError):
        YoloHttpHandle(_cfg()).infer(image_png_base64="aGk=", version_id=None)
