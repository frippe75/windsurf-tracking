"""Engine tests — CPU-only, no GPU, model handles faked."""
from __future__ import annotations

import base64
import io
from pathlib import Path
from typing import Any, ClassVar

import pytest

import pipeline_engine as pe
from pipeline_engine.artifacts import Artifact, Crop, Image
from pipeline_engine.errors import PipelineDefError, RunError
from pipeline_engine.models import MODELS
from pipeline_engine.pipeline import PipelineDef, StageRef
from pipeline_engine.runner import RUNNERS, BuiltinRunner
from pipeline_engine.stage import STAGES, RunContext

SAIL_YAML = Path(pe.__file__).parent / "pipelines" / "sail_brand_model.yaml"


def _png_b64(color=(255, 255, 255), size=(20, 20)) -> str:
    from PIL import Image as PILImage

    im = PILImage.new("RGBA", size, (*color, 255))
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


@pytest.fixture
def fake_models():
    """Register fake sam2 + VLM handles for the duration of a test."""

    class FakeSam2:
        name: ClassVar[str] = "sam2"

        def infer(self, **kw: Any) -> dict:
            return {
                "bbox": {"x": 10, "y": 10, "w": 20, "h": 20},
                "mask_base64": _png_b64((255, 255, 255), (20, 20)),
            }

    class FakeVLM:
        name: ClassVar[str] = "sail-vlm"

        def infer(self, **kw: Any) -> dict:
            return {
                "brand": "Duotone",
                "model": "Warp",
                "size_m2": 5.4,
                "sail_number": "SWE-11",
                "primary_colors": ["red", "white"],
                "_confidence": {"brand": 0.98},
            }

    MODELS.register_instance("sam2", FakeSam2())
    MODELS.register_instance("sail-vlm", FakeVLM())
    try:
        yield
    finally:
        MODELS._instances.pop("sam2", None)
        MODELS._instances.pop("sail-vlm", None)


@pytest.fixture
def ident_stage():
    """A trivial Image->Image passthrough stage, for graph-shape tests."""

    class Ident:
        name: ClassVar[str] = "ident"
        inputs: ClassVar[dict[str, type[Artifact]]] = {"x": Image}
        outputs: ClassVar[dict[str, type[Artifact]]] = {"y": Image}

        def run(self, *, inputs, params, ctx):
            return {"y": inputs["x"]}

    STAGES.register(Ident)
    try:
        yield "ident"
    finally:
        STAGES._items.pop("ident", None)


# --------------------------------------------------------------------------- #
# registration / discovery
# --------------------------------------------------------------------------- #
def test_builtin_stages_and_runner_registered():
    for name in ("sam2", "crop_mask", "vlm_extract"):
        assert name in STAGES.names()
    assert "builtin" in RUNNERS.names()


# --------------------------------------------------------------------------- #
# definition validation (build)
# --------------------------------------------------------------------------- #
def test_shipped_yaml_builds():
    dag = PipelineDef.from_yaml_path(SAIL_YAML).build()
    assert set(dag.nodes) == {"segment", "crop", "metadata"}
    assert dag.has_edge("segment", "crop")
    assert dag.has_edge("crop", "metadata")


def test_unknown_stage_type():
    d = PipelineDef(name="p", inputs={"image": "Image"},
                    stages=[StageRef(id="a", uses="nope", wire={})])
    with pytest.raises(PipelineDefError, match="unknown stage type"):
        d.build()


def test_bad_wire_ref():
    d = PipelineDef(
        name="p", inputs={"image": "Image", "point": "Point"},
        stages=[StageRef(id="s", uses="sam2", wire={"image": "noDotRef", "point": "@input.point"})],
    )
    with pytest.raises(PipelineDefError, match="bad wire ref"):
        d.build()


def test_type_mismatch():
    # crop_mask.mask expects a Mask; wiring the segment *bbox* (BBox) into it must fail.
    d = PipelineDef(
        name="p", inputs={"image": "Image", "point": "Point"},
        stages=[
            StageRef(id="segment", uses="sam2", wire={"image": "@input.image", "point": "@input.point"}),
            StageRef(id="crop", uses="crop_mask", wire={"image": "@input.image", "mask": "segment.bbox"}),
        ],
    )
    with pytest.raises(PipelineDefError, match="type mismatch"):
        d.build()


def test_missing_wired_input():
    d = PipelineDef(name="p", inputs={"image": "Image", "point": "Point"},
                    stages=[StageRef(id="s", uses="sam2", wire={"image": "@input.image"})])
    with pytest.raises(PipelineDefError, match="missing wired inputs"):
        d.build()


def test_undeclared_pipeline_input():
    d = PipelineDef(name="p", inputs={"image": "Image"},
                    stages=[StageRef(id="s", uses="sam2",
                                     wire={"image": "@input.image", "point": "@input.point"})])
    with pytest.raises(PipelineDefError, match="undeclared pipeline input"):
        d.build()


def test_cycle_detected(ident_stage):
    d = PipelineDef(
        name="p", inputs={},
        stages=[
            StageRef(id="a", uses="ident", wire={"x": "b.y"}),
            StageRef(id="b", uses="ident", wire={"x": "a.y"}),
        ],
    )
    with pytest.raises(PipelineDefError, match="cycle"):
        d.build()


# --------------------------------------------------------------------------- #
# execution
# --------------------------------------------------------------------------- #
def test_runner_missing_input_errors(fake_models):
    d = PipelineDef.from_yaml_path(SAIL_YAML)
    with pytest.raises(RunError, match="missing inputs"):
        BuiltinRunner().run(d, {"image": pe.Image(uri="u", width=10, height=10)})


def test_sail_pipeline_end_to_end(fake_models):
    pytest.importorskip("PIL")
    from PIL import Image as PILImage

    def load_image(uri: str):
        return PILImage.new("RGBA", (320, 240), (0, 0, 255, 255))

    ctx = RunContext(extra={"load_image": load_image})
    inputs = {
        "image": pe.Image(uri="frame://1", width=320, height=240),
        "point": pe.Point(x=100, y=80, label=1),
    }
    res = BuiltinRunner().run(PipelineDef.from_yaml_path(SAIL_YAML), inputs, ctx=ctx)

    crop = res["crop"]["crop"]
    assert isinstance(crop, Crop) and crop.png_base64

    md = res["metadata"]["metadata"]
    assert md.fields["brand"] == "Duotone"
    assert md.fields["model"] == "Warp"
    assert md.confidence["brand"] == pytest.approx(0.98)
