"""Dataset version domain model + manifest builder (immutable snapshot descriptors)."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class DatasetVersion:
    """An immutable, content-addressed dataset snapshot. ``id == fingerprint``."""
    id: str
    project_id: str
    fingerprint: str
    format: str
    status: str  # building | ready | failed
    created_at: str
    stats: dict[str, Any] | None = None
    artifact_key: str | None = None   # S3 key of the published zip (immutable)
    manifest_key: str | None = None
    source_video_id: str | None = None
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "DatasetVersion":
        known = {f: d.get(f) for f in cls.__dataclass_fields__}  # tolerate extra/missing keys
        return cls(**known)


def build_manifest(version: DatasetVersion, classes: list, stats: dict) -> dict:
    """The reproducible description stored alongside the artifact."""
    return {
        "version_id": version.id,
        "project_id": version.project_id,
        "fingerprint": version.fingerprint,
        "format": version.format,
        "created_at": version.created_at,
        "classes": [{"index": i, "name": c.name} for i, c in enumerate(classes)],
        "source_videos": [version.source_video_id] if version.source_video_id else [],
        "stats": stats,
    }
