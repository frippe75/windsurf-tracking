"""Deterministic content fingerprint for a dataset version.

The fingerprint is the version's identity: same annotations + classes + split + format ⇒ same id,
regardless of order, which project they live under, or when they were exported. This gives dedup and
reproducibility for free (DATASET_ARCHITECTURE.md §3, §6). It depends on class *index* (position), not
class UUIDs, so logically-identical datasets in different projects collapse to one version.
"""
from __future__ import annotations

import hashlib
import json


def fingerprint(*, annotations: list, classes: list, val_fraction: float, fmt: str = "yolo") -> str:
    class_index = {str(c.id): i for i, c in enumerate(classes)}

    rows: list[list] = []
    for a in annotations:
        cid = str(a.class_id) if getattr(a, "class_id", None) else None
        bbox = (getattr(a, "geometry", None) or {}).get("bbox")
        if cid is None or cid not in class_index or not bbox:
            continue  # same filtering the generator applies — non-exportable rows don't affect identity
        rows.append([
            class_index[cid],
            int(a.frame_number),
            round(float(bbox["x"]), 6), round(float(bbox["y"]), 6),
            round(float(bbox["w"]), 6), round(float(bbox["h"]), 6),
        ])
    rows.sort()  # order-independent

    payload = {
        "format": fmt,
        "val_fraction": round(float(val_fraction), 4),
        "classes": [c.name for c in classes],  # ordered → class index is meaningful
        "rows": rows,
    }
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return "dsv_" + hashlib.sha256(blob.encode()).hexdigest()[:16]
