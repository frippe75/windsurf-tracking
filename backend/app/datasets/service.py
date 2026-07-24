"""DatasetService — the single façade routers/workers call.

Ties the seams together: fingerprint an export request, **dedup** against existing ready versions
(return instantly, no rebuild), otherwise build the artifact and persist an immutable version record
+ manifest. Everything it depends on is a port, injected by a composition root (the Celery task /
tests). See DATASET_ARCHITECTURE.md Appendix A.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .versioning.fingerprint import fingerprint
from .versioning.models import DatasetVersion, build_manifest


@dataclass
class BuildInputs:
    project_id: str
    project_name: str
    source_video_id: str
    source_path: str          # local video file for extraction (cache misses only)
    fps: float
    classes: list             # ordered rows with .id, .name
    annotations: list         # rows with .frame_number, .class_id, .geometry
    val_fraction: float = 0.2
    sink_name: str | None = None
    clearml_project: str | None = None


class DatasetService:
    def __init__(self, repository, builder, *, clock=None) -> None:
        self._repo = repository
        self._builder = builder
        self._now = clock or (lambda: __import__("datetime").datetime.utcnow().isoformat() + "Z")

    def get(self, version_id: str) -> DatasetVersion | None:
        return self._repo.get(version_id)

    def create_or_get(self, inputs: BuildInputs, *, fmt: str = "yolo", progress_cb=None) -> DatasetVersion:
        """Dedup by content: if a ready version with this fingerprint exists, return it untouched;
        otherwise build the artifact, persist the version + manifest, and return it."""
        fp = fingerprint(
            annotations=inputs.annotations, classes=inputs.classes,
            val_fraction=inputs.val_fraction, fmt=fmt,
        )
        existing = self._repo.get(fp)
        if existing is not None and existing.status == "ready":
            self._repo.index_video(inputs.source_video_id, existing.id)  # idempotent
            return existing  # ← dedup: instant, no re-extract / re-zip

        version = DatasetVersion(
            id=fp, project_id=inputs.project_id, fingerprint=fp, format=fmt,
            status="building", created_at=self._now(), source_video_id=inputs.source_video_id,
        )
        try:
            stats, result = self._builder.build(version_id=fp, inputs=inputs, progress_cb=progress_cb)
            version.status = "ready"
            version.stats = _stats_dict(stats)
            version.artifact_key = result.get("key")
            manifest = build_manifest(version, inputs.classes, version.stats)
            version.manifest_key = self._repo.write_manifest(fp, manifest)
            self._repo.upsert(version)
            self._repo.index_video(inputs.source_video_id, version.id)
            return version
        except Exception as exc:
            version.status = "failed"
            version.error = str(exc)[:400]
            self._repo.upsert(version)
            raise


def _stats_dict(stats) -> dict:
    if isinstance(stats, dict):
        return stats
    return {
        "images": stats.images, "labels": stats.labels, "boxes": stats.boxes,
        "skipped": stats.skipped, "classes": stats.classes, "splits": stats.splits,
    }
