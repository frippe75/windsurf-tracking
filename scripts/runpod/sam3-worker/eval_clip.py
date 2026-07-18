#!/usr/bin/env python3
"""Eval SAM3 concept (text-prompt) detection on a clip vs pixel-derived ground truth.

For each frame: (1) compute the true object bbox from the pixels (the fixture is a bright
square on a dark background — largest bright contour), (2) ask the SAM3 serverless endpoint
for `text` detections, (3) IoU between the top-scoring SAM3 box and ground truth.

Usage:
  python3 eval_clip.py <ENDPOINT_ID> ["white square"] [clip.mp4]
Requires RUNPOD key at ~/.runpod/api_key and opencv (pip install opencv-python-headless).
"""
import base64
import json
import os
import sys
import urllib.request
from pathlib import Path

import numpy as np

try:
    import cv2
except ImportError:
    sys.exit("need opencv: pip install opencv-python-headless")

KEY = Path(os.path.expanduser("~/.runpod/api_key")).read_text().strip()
EID = sys.argv[1]
TEXT = sys.argv[2] if len(sys.argv) > 2 else "white square"
CLIP = sys.argv[3] if len(sys.argv) > 3 else str(
    Path(__file__).resolve().parents[3] / "backend/tests/e2e/fixtures/moving_square.mp4"
)


def gt_bbox(frame_bgr):
    gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
    _, th = cv2.threshold(gray, 40, 255, cv2.THRESH_BINARY)
    cnts, _ = cv2.findContours(th, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return None
    x, y, w, h = cv2.boundingRect(max(cnts, key=cv2.contourArea))
    return [float(x), float(y), float(x + w), float(y + h)]


def iou(a, b):
    if a is None or b is None:
        return 0.0
    ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
    ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / ua if ua > 0 else 0.0


def call_sam3(frame_bgr):
    ok, buf = cv2.imencode(".png", frame_bgr)
    b64 = base64.b64encode(buf.tobytes()).decode()
    body = json.dumps({"input": {"image_base64": b64, "text": TEXT}}).encode()
    req = urllib.request.Request(
        f"https://api.runpod.ai/v2/{EID}/runsync", data=body,
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json",
                 "User-Agent": "sam3-eval/0.1"}, method="POST")
    with urllib.request.urlopen(req, timeout=600) as r:
        return json.loads(r.read().decode())


def main():
    cap = cv2.VideoCapture(CLIP)
    ious, i = [], 0
    print(f"clip={CLIP} text={TEXT!r} endpoint={EID}")
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        gt = gt_bbox(frame)
        resp = call_sam3(frame)
        out = resp.get("output", resp) or {}
        if out.get("error"):
            print(f"frame {i}: ENDPOINT ERROR: {out['error']}")
            print(out.get("trace", ""))
            return
        dets = out.get("detections", [])
        best = max(dets, key=lambda d: d.get("score") or 0, default=None)
        pred = best["bbox"] if best else None
        j = iou(gt, pred)
        ious.append(j)
        print(f"frame {i}: GT={_r(gt)} SAM3={_r(pred)} IoU={j:.2f} ({len(dets)} dets)")
        i += 1
    if ious:
        hits = sum(1 for v in ious if v >= 0.5)
        print(f"\n{len(ious)} frames | mean IoU {np.mean(ious):.3f} | IoU>=0.5 on {hits}/{len(ious)} frames")


def _r(b):
    return None if b is None else [round(v, 1) for v in b]


if __name__ == "__main__":
    main()
