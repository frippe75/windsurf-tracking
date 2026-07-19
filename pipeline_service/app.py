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


def _extract_frame_b64(video_url: str, time_sec: float | None) -> str:
    """Server-side frame grab from a (presigned, cross-origin) video URL -> base64 PNG.

    Done here rather than in the browser because the video is a cross-origin presigned URL,
    which taints the client canvas. cv2/ffmpeg seeks via HTTP range requests (no full download).
    """
    import base64

    import cv2  # opencv-python-headless

    cap = cv2.VideoCapture(video_url)
    try:
        if time_sec:
            cap.set(cv2.CAP_PROP_POS_MSEC, float(time_sec) * 1000.0)
        ok, frame = cap.read()
    finally:
        cap.release()
    if not ok or frame is None:
        raise HTTPException(502, "could not read a frame from the video url")
    ok2, buf = cv2.imencode(".png", frame)
    if not ok2:
        raise HTTPException(500, "frame encode failed")
    return base64.b64encode(buf.tobytes()).decode()


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
        # convenience: extract the frame server-side from a (cross-origin) video url
        if inputs.get("video_url") and not inputs.get("image_png_base64"):
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

    app.include_router(router)
    return app


app = create_app()
