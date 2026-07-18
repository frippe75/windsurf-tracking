"""Crop-to-mask stage: crop the source image to the mask's bbox (+ margin) and,
optionally, suppress the background outside the mask so the downstream model focuses on
the object. Pillow/numpy are imported lazily inside ``run`` so importing this stage is
free.

Pixel access is injected, not assumed: ``ctx.extra['load_image'](uri) -> PIL.Image``.
This keeps the stage decoupled from storage/app code.
"""
from __future__ import annotations

import base64
from io import BytesIO
from typing import Any, ClassVar

from ..artifacts import Artifact, Crop, Image, Mask
from ..errors import RunError
from ..stage import RunContext, STAGES


@STAGES.register
class CropMask:
    name: ClassVar[str] = "crop_mask"
    inputs: ClassVar[dict[str, type[Artifact]]] = {"image": Image, "mask": Mask}
    outputs: ClassVar[dict[str, type[Artifact]]] = {"crop": Crop}

    def run(
        self,
        *,
        inputs: dict[str, Artifact],
        params: dict[str, Any],
        ctx: RunContext,
    ) -> dict[str, Artifact]:
        from PIL import Image as PILImage  # lazy: no Pillow at import time

        image: Image = inputs["image"]  # type: ignore[assignment]
        mask: Mask = inputs["mask"]  # type: ignore[assignment]

        load_image = ctx.extra.get("load_image")
        if not callable(load_image):
            raise RunError(
                "crop_mask needs a pixel loader: set ctx.extra['load_image'](uri) -> PIL.Image"
            )

        margin_pct: float = float(params.get("margin_pct", 20))
        suppress_background: bool = bool(params.get("suppress_background", True))
        min_px: int = int(params.get("min_px", 0))

        src = load_image(image.uri).convert("RGBA")
        b = mask.bbox
        mx = b.w * margin_pct / 100.0
        my = b.h * margin_pct / 100.0
        left = max(0, int(b.x - mx))
        top = max(0, int(b.y - my))
        right = min(src.width, int(b.x + b.w + mx))
        bottom = min(src.height, int(b.y + b.h + my))
        if right <= left or bottom <= top:
            raise RunError(f"crop_mask produced an empty region from bbox {b!r}")

        crop_img = src.crop((left, top, right, bottom))

        if suppress_background and mask.png_base64:
            mask_img = PILImage.open(BytesIO(base64.b64decode(mask.png_base64))).convert("L")
            # mask png is stored relative to its bbox; align it onto the crop
            mask_img = mask_img.resize((int(b.w), int(b.h)))
            full = PILImage.new("L", src.size, 0)
            full.paste(mask_img, (int(b.x), int(b.y)))
            crop_alpha = full.crop((left, top, right, bottom))
            gray = PILImage.new("RGBA", crop_img.size, (127, 127, 127, 255))
            crop_img = PILImage.composite(crop_img, gray, crop_alpha)

        if min_px:
            w, h = crop_img.size
            scale = min_px / max(w, h)
            if scale > 1:
                crop_img = crop_img.resize((int(w * scale), int(h * scale)))

        buf = BytesIO()
        crop_img.convert("RGB").save(buf, format="PNG")
        png_b64 = base64.b64encode(buf.getvalue()).decode()
        return {"crop": Crop(png_base64=png_b64, source_bbox=b)}
