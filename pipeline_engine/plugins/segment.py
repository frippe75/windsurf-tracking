"""SAM2 segmentation stage.

Delegates the actual inference to a registered ``sam2`` model handle (backed by the GPU
worker on the platform, faked in tests). The stage itself only maps artifacts <-> the
model's dict contract, so it has no ML dependency.
"""
from __future__ import annotations

from typing import Any, ClassVar

from ..artifacts import Artifact, BBox, Image, Mask, Point
from ..errors import RunError
from ..models import MODELS
from ..stage import RunContext, STAGES


@STAGES.register
class Sam2Segment:
    name: ClassVar[str] = "sam2"
    inputs: ClassVar[dict[str, type[Artifact]]] = {"image": Image, "point": Point}
    outputs: ClassVar[dict[str, type[Artifact]]] = {"mask": Mask, "bbox": BBox}

    def run(
        self,
        *,
        inputs: dict[str, Artifact],
        params: dict[str, Any],
        ctx: RunContext,
    ) -> dict[str, Artifact]:
        image: Image = inputs["image"]  # type: ignore[assignment]
        point: Point = inputs["point"]  # type: ignore[assignment]

        model = MODELS.get(params.get("model", "sam2"))
        result = model.infer(
            image_uri=image.uri,
            width=image.width,
            height=image.height,
            points=[{"x": point.x, "y": point.y, "label": point.label}],
        )
        try:
            bx = result["bbox"]
            bbox = BBox(x=bx["x"], y=bx["y"], w=bx["w"], h=bx["h"])
            mask = Mask(png_base64=result["mask_base64"], bbox=bbox)
        except (KeyError, TypeError) as exc:
            raise RunError(f"sam2 model returned an unexpected payload: {result!r}") from exc
        return {"mask": mask, "bbox": bbox}
