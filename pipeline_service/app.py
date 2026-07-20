"""FastAPI service over the pipeline_engine model registry.

Endpoints:
  GET  /health                     -> {status, models}
  GET  /models?capability=<cap>    -> the fleet (optionally filtered by capability)
  POST /segment  {model|capability, inputs} -> route to the model handle, return its output

The frontend's SAM toggle reads /models?capability=concept-segment (or segment-click) to
list choices, then POSTs /segment. Serving (local/external) is invisible here — it's the
model's base_url. No model logic lives in the service; it only routes.
"""
from __future__ import annotations

import os
from typing import Any

from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import pipeline_engine as pe
from pipeline_engine.models import MODELS


class SegmentRequest(BaseModel):
    model: str | None = None       # explicit model name, OR
    capability: str | None = None  # pick the first registered model with this capability
    inputs: dict[str, Any] = Field(default_factory=dict)  # passed to the handle's infer()


class TrackRequest(BaseModel):
    model: str | None = None
    capability: str | None = None  # e.g. "concept-track"
    inputs: dict[str, Any] = Field(default_factory=dict)  # {video_id, start_frame, end_frame, fps, text}


def _resolve_stream_url(video_id: str) -> str:
    """Resolve a video_id to its (presigned) stream URL via the backend, in-cluster.

    The browser holds the video only as a blob: URL (unusable by ffmpeg and cross-origin
    tainted), so we ask the backend for the real presigned S3 URL server-side. The
    /api/videos/{id}/stream-url route is unauthenticated.
    """
    import json
    import os
    import urllib.request

    base = os.environ.get("BACKEND_URL", "http://windsurf-prod-backend:8000").rstrip("/")
    url = f"{base}/api/videos/{video_id}/stream-url"
    try:
        with urllib.request.urlopen(url, timeout=15) as resp:
            data = json.loads(resp.read())
    except Exception as exc:
        raise HTTPException(502, f"could not resolve stream url for video {video_id}: {exc}") from exc
    stream = data.get("url")
    if not stream:
        raise HTTPException(502, f"backend returned no stream url: {data}")
    return stream


def _extract_frame_b64(video_url: str, time_sec: float | None) -> str:
    """Server-side frame grab from a (presigned, cross-origin) video URL -> base64 PNG.

    Done here rather than in the browser because the video is a cross-origin presigned URL,
    which taints the client canvas. Uses ffmpeg (robust HTTPS + fast `-ss` seek via range
    requests); opencv's VideoCapture over HTTP is unreliable.
    """
    import base64
    import subprocess

    t = f"{float(time_sec):.3f}" if time_sec else "0"
    cmd = [
        "ffmpeg", "-nostdin", "-loglevel", "error",
        "-ss", t, "-i", video_url,
        "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1",
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=90)
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(504, "ffmpeg timed out reading the video url") from exc
    except FileNotFoundError as exc:
        raise HTTPException(500, "ffmpeg not installed in the service image") from exc
    if proc.returncode != 0 or not proc.stdout:
        detail = proc.stderr[-400:].decode(errors="replace") if proc.stderr else "no output"
        raise HTTPException(502, f"could not read a frame from the video url: {detail}")
    return base64.b64encode(proc.stdout).decode()


def _extract_window_b64(video_url: str, start_frame: int, count: int, fps: float) -> list[str]:
    """Extract `count` frames from start_frame into a list of base64 JPEGs (0-based order).

    Done in-cluster (the RunPod worker can't reach the lab S3), downscaled to <=720px tall to
    bound the request payload. Fast `-ss` seek by time = start_frame/fps.
    """
    import base64
    import glob
    import os as _os
    import subprocess
    import tempfile

    ss = f"{(start_frame / fps):.3f}" if fps and fps > 0 else "0"
    d = tempfile.mkdtemp(prefix="sam3win_")
    try:
        cmd = [
            "ffmpeg", "-nostdin", "-loglevel", "error",
            "-ss", ss, "-i", video_url,
            "-frames:v", str(count), "-vsync", "0",
            "-vf", "scale=-2:'min(720,ih)'", "-q:v", "4",
            "-start_number", "0", _os.path.join(d, "%06d.jpg"),
        ]
        try:
            proc = subprocess.run(cmd, capture_output=True, timeout=180)
        except subprocess.TimeoutExpired as exc:
            raise HTTPException(504, "ffmpeg timed out extracting the tracking window") from exc
        except FileNotFoundError as exc:
            raise HTTPException(500, "ffmpeg not installed in the service image") from exc
        if proc.returncode != 0:
            detail = proc.stderr[-400:].decode(errors="replace") if proc.stderr else "no output"
            raise HTTPException(502, f"could not extract the tracking window: {detail}")
        out = []
        for f in sorted(glob.glob(_os.path.join(d, "*.jpg"))):
            with open(f, "rb") as fh:
                out.append(base64.b64encode(fh.read()).decode())
        return out
    finally:
        import shutil

        shutil.rmtree(d, ignore_errors=True)


def create_app() -> FastAPI:
    app = FastAPI(title="pipeline-engine service")
    # Behind the labelbee ingress the app is mounted at /pipeline (same origin, no rewrite),
    # so routes carry that prefix in prod; tests use "" (default).
    prefix = os.environ.get("SERVICE_PREFIX", "").rstrip("/")
    router = APIRouter(prefix=prefix)
    app.add_middleware(
        CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
    )

    # Register the model fleet declaratively if configured (else models are added elsewhere).
    yaml_path = os.environ.get("MODELS_YAML")
    if yaml_path and os.path.exists(yaml_path):
        pe.load_models_yaml(yaml_path)

    @router.get("/health")
    def health() -> dict[str, Any]:
        return {"status": "ok", "models": MODELS.names()}

    @router.get("/models")
    def list_models(capability: str | None = None) -> dict[str, Any]:
        names = MODELS.by_capability(capability) if capability else MODELS.names()
        return {"models": [
            {"name": n, "capabilities": MODELS.capabilities_of(n)} for n in names
        ]}

    @router.post("/segment")
    def segment(req: SegmentRequest) -> dict[str, Any]:
        name = req.model
        if not name and req.capability:
            candidates = MODELS.by_capability(req.capability)
            if not candidates:
                raise HTTPException(404, f"no model with capability {req.capability!r}")
            name = candidates[0]
        if not name:
            raise HTTPException(400, "provide 'model' or 'capability'")
        try:
            handle = MODELS.get(name)
        except Exception as exc:  # ModelError for unknown name
            raise HTTPException(404, str(exc)) from exc
        inputs = dict(req.inputs)
        # Only CONCEPT (text-prompt) requests need a frame extracted. Click requests
        # (points) pass video_id/frame_number straight through to the SAM2 handle.
        if inputs.get("text") and not inputs.get("image_png_base64"):
            if inputs.get("video_id"):
                stream = _resolve_stream_url(inputs.pop("video_id"))
                inputs["image_png_base64"] = _extract_frame_b64(stream, inputs.pop("time_sec", None))
                inputs.pop("frame_number", None)
                inputs.pop("video_url", None)
            elif inputs.get("video_url"):
                inputs["image_png_base64"] = _extract_frame_b64(
                    inputs.pop("video_url"), inputs.pop("time_sec", None)
                )
                inputs.pop("frame_number", None)
        try:
            result = handle.infer(**inputs)
        except pe.ModelError as exc:
            raise HTTPException(502, str(exc)) from exc
        except TypeError as exc:  # inputs don't match the handle contract
            raise HTTPException(400, f"bad inputs for model {name!r}: {exc}") from exc
        return {"model": name, "capabilities": MODELS.capabilities_of(name), "result": result}

    def _resolve(model: str | None, capability: str | None) -> str:
        if model:
            return model
        if capability:
            cands = MODELS.by_capability(capability)
            if not cands:
                raise HTTPException(404, f"no model with capability {capability!r}")
            return cands[0]
        raise HTTPException(400, "provide 'model' or 'capability'")

    # Video tracking is long/async, so it needs a job handle (submit -> poll), unlike the
    # synchronous /segment. The SAM3 video worker can't reach the lab S3, so we extract the
    # frame window HERE (in-cluster) and push the frames to the worker.
    MAX_WINDOW = 120

    @router.post("/track")
    def track(req: TrackRequest) -> dict[str, Any]:
        name = _resolve(req.model, req.capability)
        try:
            handle = MODELS.get(name)
        except Exception as exc:
            raise HTTPException(404, str(exc)) from exc
        if not hasattr(handle, "submit"):
            raise HTTPException(400, f"model {name!r} is not a tracking model")
        inp = dict(req.inputs)
        text = inp.get("text")
        video_id = inp.get("video_id")
        if not text or not video_id:
            raise HTTPException(400, "track needs inputs.text and inputs.video_id")
        start_frame = int(inp.get("start_frame", 0))
        end_frame = int(inp.get("end_frame", start_frame + MAX_WINDOW - 1))
        fps = float(inp.get("fps", 30.0))
        count = max(1, min(end_frame - start_frame + 1, MAX_WINDOW))
        stream = _resolve_stream_url(video_id)
        frames_b64 = _extract_window_b64(stream, start_frame, count, fps)
        if not frames_b64:
            raise HTTPException(502, "no frames extracted for the tracking window")
        try:
            job_id = handle.submit(frames_b64=frames_b64, start_frame=start_frame, text=text)
        except pe.ModelError as exc:
            raise HTTPException(502, str(exc)) from exc
        return {"model": name, "job_id": job_id, "start_frame": start_frame, "frames": count}

    @router.get("/track/{job_id}")
    def track_status(job_id: str, model: str) -> dict[str, Any]:
        try:
            handle = MODELS.get(model)
        except Exception as exc:
            raise HTTPException(404, str(exc)) from exc
        if not hasattr(handle, "poll"):
            raise HTTPException(400, f"model {model!r} is not a tracking model")
        try:
            res = handle.poll(job_id=job_id)
        except pe.ModelError as exc:
            raise HTTPException(502, str(exc)) from exc
        out = res.get("output")
        if not out:
            return {"status": res.get("status"), "error": res.get("error")}
        # normalise per-object bbox px -> percent of frame (aspect-preserved, so resolution-free)
        W, H = (out.get("image_size") or [0, 0])[:2]
        frames = []
        for fr in out.get("frames", []):
            objs = []
            for o in fr.get("objects", []):
                b = o.get("bbox") or [0, 0, 0, 0]
                bbox_pct = ([b[0] / W * 100, b[1] / H * 100, b[2] / W * 100, b[3] / H * 100]
                            if W and H else b)
                objs.append({"object_id": o.get("object_id"), "bbox_pct": bbox_pct,
                             "score": o.get("score"), "mask_base64": o.get("mask_base64")})
            frames.append({"frame_number": fr.get("frame_number"), "objects": objs})
        return {"status": res.get("status"), "frames": frames, "count": len(frames)}

    app.include_router(router)
    return app


app = create_app()
