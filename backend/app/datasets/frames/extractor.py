"""FrameExtractor adapters — the `source` seam.

Wraps the existing cv2/ffmpeg frame decode (`app.frames.extract_frame_image`) and encodes to JPEG
bytes so the store/format layers deal only in bytes, never PIL/ffmpeg. Swap this to change how frames
are decoded (e.g. a GPU decoder, an image-folder source) without touching the store or the generator.
"""
from __future__ import annotations


class PilFrameExtractor:
    """Decode one frame via the existing extractor and encode JPEG (quality matches the old export)."""

    name = "pil"

    def __init__(self, quality: int = 90) -> None:
        self.quality = quality

    def extract(self, source_path: str, frame_number: int, fps: float | None) -> bytes:
        from io import BytesIO

        from ...frames import extract_frame_image  # app.frames (cv2 + ffmpeg fallback)

        img = extract_frame_image(source_path, frame_number, fps)
        buf = BytesIO()
        img.convert("RGB").save(buf, format="JPEG", quality=self.quality)
        return buf.getvalue()


def default_extractor() -> PilFrameExtractor:
    return PilFrameExtractor()
