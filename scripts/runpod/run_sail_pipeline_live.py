#!/usr/bin/env python3
"""End-to-end LIVE test: run the sail-brand-model pipeline against the deployed RunPod VLM.

Wires the real `openai-compat-http` handle to the live endpoint (from
runpod-vlm-endpoint.json), fakes only the SAM2 segment step (not deployed), and runs the
real `crop_mask` + `vlm_extract` stages so the crop actually hits Qwen3-VL and comes back
as validated SailMeta. Requires RUNPOD_API_KEY in the environment.

    RUNPOD_API_KEY=$(cat ~/.runpod/api_key) python3 scripts/runpod/run_sail_pipeline_live.py
"""
from __future__ import annotations

import base64
import io
import json
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

import pipeline_engine as pe  # noqa: E402
from pipeline_engine.models import MODELS, ModelConfig  # noqa: E402
from pipeline_engine.pipeline import PipelineDef  # noqa: E402
from pipeline_engine.runner import BuiltinRunner  # noqa: E402
from pipeline_engine.stage import STAGES, RunContext  # noqa: E402
from pipeline_engine.artifacts import Artifact, BBox, Image, Mask, Point  # noqa: E402

INFO = Path(__file__).with_name("runpod-vlm-endpoint.json")
SAIL_YAML = REPO / "pipeline_engine" / "pipelines" / "sail_brand_model.yaml"


def _sail_png() -> bytes:
    from PIL import Image as PILImage, ImageDraw, ImageFont

    img = PILImage.new("RGB", (640, 480), (20, 60, 160))
    d = ImageDraw.Draw(img)

    def font(sz):
        for p in ("/usr/share/fonts/dejavu-sans-fonts/DejaVuSans-Bold.ttf",
                  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
            try:
                return ImageFont.truetype(p, sz)
            except Exception:
                pass
        return ImageFont.load_default()

    d.text((60, 120), "DUOTONE", fill="white", font=font(90))
    d.text((70, 240), "Warp", fill=(255, 220, 0), font=font(70))
    d.text((70, 330), "5.4", fill="white", font=font(60))
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def main() -> int:
    if not INFO.exists():
        print(f"missing {INFO} — deploy the endpoint first"); return 1
    meta = json.loads(INFO.read_text())
    base_url, model_name = meta["openai_base_url"], meta["model"]
    if not os.environ.get("RUNPOD_API_KEY"):
        print("set RUNPOD_API_KEY in the environment"); return 1

    # 1) wire the live model under the stable logical name the pipeline references
    MODELS.configure("sail-vlm", ModelConfig(
        type="openai-compat-http", model_name=model_name, base_url=base_url,
        auth_env="RUNPOD_API_KEY", timeout_s=300, max_tokens=256,
    ))

    # 2) fake only SAM2 (not deployed): return a box+mask over the printed text region
    png = _sail_png()
    tmp = Path("/tmp/_sail_live.png"); tmp.write_bytes(png)

    class FakeSam2:
        name = "sam2"

        def infer(self, **kw):
            b64 = base64.b64encode(png).decode()  # full-frame white mask proxy
            from PIL import Image as PILImage
            w = PILImage.new("L", (520, 320), 255)
            mb = io.BytesIO(); w.save(mb, "PNG")
            return {"bbox": {"x": 40, "y": 90, "w": 520, "h": 320},
                    "mask_base64": base64.b64encode(mb.getvalue()).decode()}

    MODELS.register_instance("sam2", FakeSam2())

    ctx = RunContext(extra={"load_image": lambda uri: __import__("PIL.Image", fromlist=["open"]).open(tmp)})
    inputs = {
        "image": Image(uri=str(tmp), width=640, height=480),
        "point": Point(x=320, y=200, label=1),
    }
    print(f"running sail pipeline against {base_url}  (model={model_name})")
    res = BuiltinRunner().run(PipelineDef.from_yaml_path(SAIL_YAML), inputs, ctx=ctx)
    md = res["metadata"]["metadata"]
    print("EXTRACTED METADATA:", json.dumps(md.fields, indent=2))
    print("confidence:", md.confidence)

    ok = str(md.fields.get("brand", "")).lower().startswith("duotone")
    print("RESULT:", "PASS ✅ (brand read correctly)" if ok else "CHECK ⚠️ (brand not 'Duotone')")
    return 0 if ok else 2


if __name__ == "__main__":
    raise SystemExit(main())
