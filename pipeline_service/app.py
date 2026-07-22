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


class MetadataRequest(BaseModel):
    model: str | None = None
    capability: str | None = None  # e.g. "metadata-extract"
    # {schema, prompt?, video_id?, time_secs?[]} — with frames -> grid image; without -> text-only (draft)
    inputs: dict[str, Any] = Field(default_factory=dict)


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


def _mask_to_polygon_pct(mask_b64: str | None) -> list[dict[str, float]] | None:
    """Full-frame mask PNG -> simplified outer contour as percent-of-frame points.

    Silhouettes are stored as polygons (percent coords), not full-frame PNGs: ~10x smaller,
    they render via the frontend's points-fill path, and they ARE the YOLO-seg label format.
    W/H come from the PNG itself, so this is correct whether the mask was extracted at native
    or downscaled resolution. Returns None on any failure -> caller falls back to the bbox.
    """
    if not mask_b64:
        return None
    try:
        import base64
        import io

        import cv2
        import numpy as np
        from PIL import Image

        im = Image.open(io.BytesIO(base64.b64decode(mask_b64))).convert("L")
        W, H = im.size
        if not W or not H:
            return None
        _, binm = cv2.threshold(np.array(im), 127, 255, cv2.THRESH_BINARY)
        contours, _ = cv2.findContours(binm, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            return None
        c = max(contours, key=cv2.contourArea)
        if cv2.contourArea(c) <= 0:
            return None
        approx = cv2.approxPolyDP(c, 0.01 * cv2.arcLength(c, True), True).reshape(-1, 2)
        if len(approx) < 3:
            return None
        return [{"x": float(x) / W * 100.0, "y": float(y) / H * 100.0} for x, y in approx]
    except Exception:
        return None


_WARMTH_CACHE: dict[str, Any] = {"ts": 0.0, "data": {}}


def _query_warmth(name: str) -> dict[str, Any]:
    """Readiness of one model. Serverless (RunPod) models report warm/warming/cold from their
    /health worker counts; everything else is serverless:false. Never raises."""
    import json
    import os
    import re
    import urllib.request

    try:
        cfg = getattr(MODELS.get(name), "config", None)
    except Exception:
        cfg = None
    base = getattr(cfg, "base_url", "") or ""
    if "api.runpod.ai" not in base:
        return {"serverless": False}
    m = re.search(r"/v2/([a-zA-Z0-9]+)", base)
    if not m:
        return {"serverless": True, "status": "unknown"}
    key = os.environ.get(cfg.auth_env) if getattr(cfg, "auth_env", None) else None
    headers = {"Authorization": f"Bearer {key}"} if key else {}
    try:
        req = urllib.request.Request(f"https://api.runpod.ai/v2/{m.group(1)}/health", headers=headers)
        w = (json.loads(urllib.request.urlopen(req, timeout=5).read()).get("workers") or {})
        if (w.get("ready", 0) + w.get("idle", 0) + w.get("running", 0)) > 0:
            status = "warm"
        elif w.get("initializing", 0) > 0:
            status = "warming"
        else:
            status = "cold"
        return {"serverless": True, "status": status, "warm": status == "warm"}
    except Exception:
        return {"serverless": True, "status": "unknown"}


def _warmth_all() -> dict[str, Any]:
    """Per-model warmth, cached ~15s so /warmth stays cheap and never hammers RunPod."""
    import time

    now = time.time()
    if now - _WARMTH_CACHE["ts"] < 15 and _WARMTH_CACHE["data"]:
        return _WARMTH_CACHE["data"]
    data = {n: _query_warmth(n) for n in MODELS.names()}
    _WARMTH_CACHE["ts"] = now
    _WARMTH_CACHE["data"] = data
    return data


def _grid_png_b64(frames_b64: list[str], cols: int = 3, tile_w: int = 512) -> str:
    """Tile frames into one grid PNG (base64). One image for a whole clip keeps the LLM call cheap;
    tiles are downscaled to `tile_w` wide so the grid stays a reasonable size."""
    import base64
    import io
    import math

    from PIL import Image

    imgs = []
    for f in frames_b64:
        if not f:
            continue
        im = Image.open(io.BytesIO(base64.b64decode(f))).convert("RGB")
        if im.width > tile_w:
            im = im.resize((tile_w, max(1, round(im.height * tile_w / im.width))))
        imgs.append(im)
    if not imgs:
        raise HTTPException(502, "no frames to build the grid")
    tw, th = imgs[0].size
    n = len(imgs)
    c = min(cols, n)
    r = math.ceil(n / c)
    grid = Image.new("RGB", (tw * c, th * r), (0, 0, 0))
    for i, im in enumerate(imgs):
        if im.size != (tw, th):
            im = im.resize((tw, th))
        grid.paste(im, ((i % c) * tw, (i // c) * th))
    buf = io.BytesIO()
    grid.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def create_app() -> FastAPI:
    # Behind the labelbee ingress the app is mounted at /pipeline (same origin, no rewrite),
    # so routes carry that prefix in prod; tests use "" (default). The OpenAPI spec + docs must
    # live under the same prefix or the ingress won't route them (default /openapi.json is unreachable).
    prefix = os.environ.get("SERVICE_PREFIX", "").rstrip("/")
    app = FastAPI(
        title="pipeline-engine service",
        openapi_url=f"{prefix}/openapi.json",
        docs_url=f"{prefix}/docs",
        redoc_url=f"{prefix}/redoc",
    )
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

    @router.get("/warmth")
    def warmth() -> dict[str, Any]:
        # per-model readiness for serverless (RunPod) endpoints; cached ~15s
        return {"warmth": _warmth_all()}

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
        # Concept detections carry a full-frame mask PNG -> convert to a compact polygon and drop
        # the PNG (SAM2 click results have no "detections" list, so they keep their mask).
        if isinstance(result, dict) and isinstance(result.get("detections"), list):
            for d in result["detections"]:
                if isinstance(d, dict):
                    d["polygon"] = _mask_to_polygon_pct(d.pop("mask_base64", None))
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
                             "score": o.get("score"),
                             "polygon": _mask_to_polygon_pct(o.get("mask_base64"))})
            frames.append({"frame_number": fr.get("frame_number"), "objects": objs})
        return {"status": res.get("status"), "frames": frames, "count": len(frames)}

    # Metadata extraction via a frontier VLM (Claude): with `time_secs` -> extract those frames,
    # tile a grid, and ask for schema-conformant JSON; without frames -> a text-only call (used to
    # auto-draft the schema). The API key stays server-side.
    @router.post("/metadata")
    def metadata(req: MetadataRequest) -> dict[str, Any]:
        name = _resolve(req.model, req.capability)
        try:
            handle = MODELS.get(name)
        except Exception as exc:
            raise HTTPException(404, str(exc)) from exc
        inp = dict(req.inputs)
        schema = inp.get("schema")
        prompt = inp.get("prompt")
        image = None
        time_secs = inp.get("time_secs")
        video_id = inp.get("video_id")
        if time_secs and video_id:
            stream = _resolve_stream_url(video_id)
            # Tolerate individual unreadable timestamps (e.g. sampled past end-of-clip): skip them
            # and build the grid from whatever frames we got. One bad frame must not fail the run.
            frames: list[str] = []
            for t in list(time_secs)[:9]:
                try:
                    frames.append(_extract_frame_b64(stream, float(t)))
                except HTTPException:
                    continue
            if not frames:
                raise HTTPException(502, f"no readable frames at the requested times (clip may be shorter than {max(time_secs):.1f}s)")
            image = _grid_png_b64(frames)
        try:
            result = handle.infer(prompt=prompt, image_png_base64=image, json_schema=schema)
        except pe.ModelError as exc:
            raise HTTPException(502, str(exc)) from exc
        except TypeError as exc:
            raise HTTPException(400, f"bad inputs for model {name!r}: {exc}") from exc
        return {"model": name, "result": result}

    app.include_router(router)
    return app


app = create_app()
