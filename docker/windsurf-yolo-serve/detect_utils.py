"""Pure helpers for yolo-serve — no ML/cloud deps, so they're unit-testable anywhere."""
from __future__ import annotations


def pick_best_run(runs: list[dict]) -> dict | None:
    """Choose which trained run to serve for a version: highest mAP50 among those with weights."""
    ready = [r for r in runs if r.get("weights_key")]
    if not ready:
        return None
    return max(ready, key=lambda r: (r.get("metrics") or {}).get("mAP50", 0.0))


def format_detections(boxes_xyxy, class_ids, scores, names, w: int, h: int) -> list[dict]:
    """Normalize ultralytics boxes to the platform contract: bbox = [x, y, w, h] as 0–1 fractions."""
    out = []
    for (x1, y1, x2, y2), c, s in zip(boxes_xyxy, class_ids, scores):
        ci = int(c)
        label = names.get(ci, str(ci)) if isinstance(names, dict) else str(ci)
        out.append({
            "bbox": [x1 / w, y1 / h, (x2 - x1) / w, (y2 - y1) / h],
            "score": float(s), "class_id": ci, "label": label,
        })
    return out
