"""Lineage domain: a ModelRun links a trained model back to the dataset version it consumed."""
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any


@dataclass
class ModelRun:
    run_id: str                       # the training job id
    dataset_version_id: str           # ← the lineage link
    model: str                        # e.g. yolov8n.pt
    epochs: int
    metrics: dict[str, Any] | None = None   # mAP50, mAP50_95, per_class
    weights_key: str | None = None    # S3 key of best.pt
    created_at: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "ModelRun":
        return cls(**{f: d.get(f) for f in cls.__dataclass_fields__})
