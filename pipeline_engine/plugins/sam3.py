"""SAM3 concept-segmentation stage: an open-vocab TEXT prompt segments every matching
instance in a frame -> a ``Detections`` set. Replaces the DINO(detect)+SAM2(segment)
chain for the "segment all sails" flow.

The text prompt is a stage param (``params.text``); the model is resolved by logical name
(``params.model``, default ``sam3``) so serving (local vs RunPod) is pure config.
"""
from __future__ import annotations

import base64
import io
from typing import Any, ClassVar

from ..artifacts import Artifact, BBox, Detection, Detections, Image
from ..errors import RunError
from ..models import MODELS
from ..stage import RunContext, STAGES


@STAGES.register
class Sam3Concept:
    name: ClassVar[str] = "sam3_concept"
    inputs: ClassVar[dict[str, type[Artifact]]] = {"image": Image}
    outputs: ClassVar[dict[str, type[Artifact]]] = {"detections": Detections}

    def run(
        self,
        *,
        inputs: dict[str, Artifact],
        params: dict[str, Any],
        ctx: RunContext,
    ) -> dict[str, Artifact]:
        image: Image = inputs["image"]  # type: ignore[assignment]
        text = params.get("text")
        if not text:
            raise RunError("sam3_concept requires params.text (the concept prompt)")

        load_image = ctx.extra.get("load_image")
        if not callable(load_image):
            raise RunError("sam3_concept needs ctx.extra['load_image'](uri) -> PIL.Image")
        pil = load_image(image.uri).convert("RGB")
        buf = io.BytesIO()
        pil.save(buf, format="PNG")
        b64 = base64.b64encode(buf.getvalue()).decode()

        model = MODELS.get(params.get("model", "sam3"))
        raw = model.infer(image_png_base64=b64, text=text)

        items: list[Detection] = []
        for d in raw.get("detections", []):
            b = d.get("bbox")
            if not b or len(b) != 4:
                continue
            x1, y1, x2, y2 = b
            items.append(
                Detection(
                    bbox=BBox(x=float(x1), y=float(y1), w=float(x2) - float(x1), h=float(y2) - float(y1)),
                    score=float(d.get("score") or 0.0),
                    label=d.get("label") or text,
                    mask_base64=d.get("mask_base64"),
                    track_id=d.get("track_id"),
                )
            )
        return {"detections": Detections(items=items, prompt=text)}
