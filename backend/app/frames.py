"""
Frame extraction with an ffmpeg fallback.

OpenCV's bundled decoders don't cover every codec (notably AV1, which YouTube
now serves widely). When cv2 can't decode a frame we fall back to ffmpeg, which
has broad codec support in this image. Returns a PIL RGB Image.
"""
import io
import subprocess
from PIL import Image


def _extract_cv2(video_path: str, frame_number: int):
    import cv2
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return None
    try:
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
        ret, frame = cap.read()
        if not ret or frame is None:
            return None
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        return Image.fromarray(rgb)
    finally:
        cap.release()


def _extract_ffmpeg(video_path: str, frame_number: int, fps: float | None = None):
    """Extract one frame as PNG via ffmpeg.

    With fps: input-seek by time (`-ss` before `-i`) → jumps to the nearest
    keyframe and decodes forward. Near-constant time and frame-accurate.
    Without fps: `select=eq(n,N)` filter, which decodes every frame 0..N
    (O(N) — seconds for high frame numbers). Always pass fps when known.
    """
    if fps and fps > 0:
        seek = frame_number / fps
        cmd = [
            "ffmpeg", "-nostdin", "-v", "error",
            "-ss", f"{seek:.6f}", "-i", str(video_path),
            "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1",
        ]
    else:
        cmd = [
            "ffmpeg", "-nostdin", "-v", "error",
            "-i", str(video_path),
            "-vf", f"select=eq(n\\,{frame_number})",
            "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1",
        ]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0 or not proc.stdout:
        return None
    return Image.open(io.BytesIO(proc.stdout)).convert("RGB")


def extract_frame_image(video_path: str, frame_number: int, fps: float | None = None) -> Image.Image:
    """Return the given frame as a PIL RGB Image, or raise ValueError.
    Pass fps so the ffmpeg fallback can time-seek instead of decoding O(N)."""
    img = _extract_cv2(video_path, frame_number)
    if img is None:
        img = _extract_ffmpeg(video_path, frame_number, fps)
    if img is None:
        raise ValueError(f"Could not extract frame {frame_number}")
    return img
