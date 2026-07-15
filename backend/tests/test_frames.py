"""Frame extraction fallback: cv2 → ffmpeg (for AV1 etc. OpenCV can't decode)."""
import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def test_falls_back_to_ffmpeg_when_cv2_fails(monkeypatch):
    from app import frames

    sentinel = object()
    monkeypatch.setattr(frames, "_extract_cv2", lambda p, n: None)
    monkeypatch.setattr(frames, "_extract_ffmpeg", lambda p, n: sentinel)
    assert frames.extract_frame_image("x.mp4", 0) is sentinel


def test_uses_cv2_when_it_succeeds(monkeypatch):
    from app import frames

    cv2img = object()
    called = {"ffmpeg": False}
    monkeypatch.setattr(frames, "_extract_cv2", lambda p, n: cv2img)
    monkeypatch.setattr(frames, "_extract_ffmpeg", lambda p, n: (called.__setitem__("ffmpeg", True) or object()))
    assert frames.extract_frame_image("x.mp4", 0) is cv2img
    assert called["ffmpeg"] is False  # ffmpeg not invoked when cv2 works


def test_raises_when_both_fail(monkeypatch):
    from app import frames

    monkeypatch.setattr(frames, "_extract_cv2", lambda p, n: None)
    monkeypatch.setattr(frames, "_extract_ffmpeg", lambda p, n: None)
    with pytest.raises(ValueError):
        frames.extract_frame_image("x.mp4", 7)
