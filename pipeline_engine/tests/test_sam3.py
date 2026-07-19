"""SAM3 concept stage + RunPod handle (network faked)."""
from __future__ import annotations

import json

import pytest

from pipeline_engine.artifacts import Detections, Image
from pipeline_engine.handles.sam3_runpod import Sam3RunpodHandle
from pipeline_engine.models import HANDLES, MODELS, ModelConfig
from pipeline_engine.pipeline import PipelineDef, StageRef
from pipeline_engine.runner import BuiltinRunner
from pipeline_engine.stage import STAGES, RunContext


def test_registered():
    assert "sam3-runpod" in HANDLES.names()
    assert "sam3_concept" in STAGES.names()


def test_sam3_concept_stage():
    pytest.importorskip("PIL")
    from PIL import Image as PILImage

    class FakeSam3:
        def infer(self, *, image_png_base64, text, **kw):
            return {"detections": [
                {"bbox": [10, 10, 50, 50], "score": 0.9, "label": text},
                {"bbox": [60, 60, 90, 90], "score": 0.4},
            ]}

    MODELS.register_instance("sam3", FakeSam3())
    try:
        ctx = RunContext(extra={"load_image": lambda uri: PILImage.new("RGB", (100, 100), (0, 0, 0))})
        d = PipelineDef(
            name="p", inputs={"image": "Image"},
            stages=[StageRef(id="seg", uses="sam3_concept",
                             params={"text": "windsurf sail rig"}, wire={"image": "@input.image"})],
        )
        res = BuiltinRunner().run(d, {"image": Image(uri="x", width=100, height=100)}, ctx=ctx)
        dets = res["seg"]["detections"]
        assert isinstance(dets, Detections)
        assert len(dets.items) == 2
        assert dets.items[0].bbox.w == 40 and dets.items[0].label == "windsurf sail rig"
        assert dets.prompt == "windsurf sail rig"
    finally:
        MODELS._instances.pop("sam3", None)


def test_sam3_handle_request(monkeypatch):
    import urllib.request

    captured = {}

    class R:
        def __init__(self, d):
            self.d = d

        def read(self):
            return self.d

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def fake(req, timeout=None):
        captured["url"] = req.full_url
        captured["body"] = json.loads(req.data.decode())
        captured["auth"] = req.get_header("Authorization")
        return R(json.dumps({"output": {"detections": [{"bbox": [1, 2, 3, 4], "score": 0.5}]}}).encode())

    monkeypatch.setattr(urllib.request, "urlopen", fake)
    monkeypatch.setenv("RUNPOD_API_KEY", "k")
    h = Sam3RunpodHandle(ModelConfig(
        type="sam3-runpod", model_name="sam3",
        base_url="https://api.runpod.ai/v2/abc", auth_env="RUNPOD_API_KEY"))
    out = h.infer(image_png_base64="aGk=", text="sail")
    assert out["detections"][0]["bbox"] == [1, 2, 3, 4]
    assert captured["url"].endswith("/runsync")
    assert captured["body"]["input"]["text"] == "sail"
    assert captured["auth"] == "Bearer k"
