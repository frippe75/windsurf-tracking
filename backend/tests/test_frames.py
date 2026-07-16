"""Frame extraction fallback: cv2 → ffmpeg (for AV1 etc. OpenCV can't decode)."""
import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def test_falls_back_to_ffmpeg_when_cv2_fails(monkeypatch):
    from app import frames

    sentinel = object()
    monkeypatch.setattr(frames, "_extract_cv2", lambda p, n, fps=None: None)
    monkeypatch.setattr(frames, "_extract_ffmpeg", lambda p, n, fps=None: sentinel)
    assert frames.extract_frame_image("x.mp4", 0) is sentinel


def test_uses_cv2_when_it_succeeds(monkeypatch):
    from app import frames

    cv2img = object()
    called = {"ffmpeg": False}
    monkeypatch.setattr(frames, "_extract_cv2", lambda p, n: cv2img)
    monkeypatch.setattr(frames, "_extract_ffmpeg", lambda p, n, fps=None: (called.__setitem__("ffmpeg", True) or object()))
    assert frames.extract_frame_image("x.mp4", 0) is cv2img
    assert called["ffmpeg"] is False  # ffmpeg not invoked when cv2 works


def test_raises_when_both_fail(monkeypatch):
    from app import frames

    monkeypatch.setattr(frames, "_extract_cv2", lambda p, n, fps=None: None)
    monkeypatch.setattr(frames, "_extract_ffmpeg", lambda p, n, fps=None: None)
    with pytest.raises(ValueError):
        frames.extract_frame_image("x.mp4", 7)


def test_ffmpeg_time_seeks_when_fps_known(monkeypatch):
    """With fps, the ffmpeg fallback must input-seek by time (-ss before -i),
    not decode O(N) with the select filter."""
    from app import frames

    captured = {}

    class FakeProc:
        returncode = 1
        stdout = b""

    def fake_run(cmd, **kw):
        captured["cmd"] = cmd
        return FakeProc()

    monkeypatch.setattr(frames.subprocess, "run", fake_run)
    frames._extract_ffmpeg("v.mp4", 250, fps=25.0)
    cmd = captured["cmd"]
    # -ss must appear BEFORE -i (input seek = keyframe jump), and no select filter
    assert "-ss" in cmd
    assert cmd.index("-ss") < cmd.index("-i")
    assert "10.000000" in cmd[cmd.index("-ss") + 1]  # 250/25
    assert not any("select=" in str(a) for a in cmd)


def test_ffmpeg_falls_back_to_select_without_fps(monkeypatch):
    from app import frames

    captured = {}

    class FakeProc:
        returncode = 1
        stdout = b""

    monkeypatch.setattr(frames.subprocess, "run", lambda cmd, **kw: (captured.__setitem__("cmd", cmd) or FakeProc()))
    frames._extract_ffmpeg("v.mp4", 250, fps=None)
    assert any("select=eq(n\\,250)" in str(a) for a in captured["cmd"])
