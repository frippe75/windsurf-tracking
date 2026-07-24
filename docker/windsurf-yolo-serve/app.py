"""yolo-serve — on-prem inference for trained YOLO detectors.

Loads a project's `best.pt` by **dataset version** (reads the lineage runs from S3, picks the best
mAP, downloads the weights, caches the model in memory) and detects on a posted image. One service
serves any trained model — the request names the version. Registered in the fleet as a `detect`
capability; pipeline-service routes to it. See docs/DATASET_ARCHITECTURE.md.
"""
from __future__ import annotations

import os

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from detect_utils import format_detections, pick_best_run

app = FastAPI(title="yolo-serve")
_models: dict = {}  # version_id -> loaded YOLO model (in-memory cache)


class DetectRequest(BaseModel):
    version_id: str
    image_png_base64: str
    conf: float = 0.25


def _s3():
    import boto3

    return boto3.client(
        "s3",
        endpoint_url=os.environ["S3_ENDPOINT"],
        aws_access_key_id=os.environ["S3_ACCESS_KEY"],
        aws_secret_access_key=os.environ["S3_SECRET_KEY"],
    ), os.environ["S3_BUCKET"]


def _runs_for_version(version_id: str) -> list[dict]:
    import json

    s3, bucket = _s3()
    prefix = f"datasets/versions/{version_id}/models/"
    runs = []
    for obj in s3.list_objects_v2(Bucket=bucket, Prefix=prefix).get("Contents", []):
        if obj["Key"].endswith(".json"):
            runs.append(json.loads(s3.get_object(Bucket=bucket, Key=obj["Key"])["Body"].read()))
    return runs


def _load(version_id: str):
    if version_id in _models:
        return _models[version_id]
    best = pick_best_run(_runs_for_version(version_id))
    if not best:
        raise HTTPException(404, f"no trained model for version {version_id!r}")
    import tempfile

    from ultralytics import YOLO

    s3, bucket = _s3()
    path = tempfile.mktemp(suffix=".pt")
    s3.download_file(bucket, best["weights_key"], path)
    model = YOLO(path)
    _models[version_id] = model
    return model


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "loaded": list(_models)}


@app.post("/detect")
def detect(req: DetectRequest) -> dict:
    import base64
    import io

    from PIL import Image

    model = _load(req.version_id)
    img = Image.open(io.BytesIO(base64.b64decode(req.image_png_base64))).convert("RGB")
    w, h = img.size
    res = model.predict(img, conf=req.conf, verbose=False)[0]
    n = len(res.boxes)
    boxes = [b.tolist() for b in res.boxes.xyxy] if n else []
    clss = [int(c) for c in res.boxes.cls.tolist()] if n else []
    scores = [float(s) for s in res.boxes.conf.tolist()] if n else []
    return {"detections": format_detections(boxes, clss, scores, res.names, w, h), "width": w, "height": h}
