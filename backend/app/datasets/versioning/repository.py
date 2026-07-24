"""DatasetVersionRepository adapters — the version-persistence seam.

`S3DatasetVersionRepository` stores each version's record + manifest at a content-addressed,
project-independent path `datasets/versions/{version_id}/…`, so identical content dedupes globally.
The port lets us swap to a Postgres adapter later with zero caller changes (DATASET_ARCHITECTURE.md §5).
"""
from __future__ import annotations

import json

from .models import DatasetVersion


def _version_key(version_id: str) -> str:
    return f"datasets/versions/{version_id}/version.json"


def _manifest_key(version_id: str) -> str:
    return f"datasets/versions/{version_id}/manifest.json"


def _video_index_key(video_id: str, version_id: str) -> str:
    # Versions are content-addressed (project-independent); this thin index lets us list the
    # versions built from a given source video — what the Project Manager "Models" card needs.
    return f"datasets/index/videos/{video_id}/{version_id}"


class S3DatasetVersionRepository:
    def get(self, version_id: str) -> DatasetVersion | None:
        from ... import storage

        key = _version_key(version_id)
        if not storage.object_exists(key):
            return None
        return DatasetVersion.from_dict(json.loads(storage.get_bytes(key)))

    def upsert(self, version: DatasetVersion) -> DatasetVersion:
        from ... import storage

        storage.put_bytes(_version_key(version.id), json.dumps(version.to_dict()).encode(), "application/json")
        return version

    def write_manifest(self, version_id: str, manifest: dict) -> str:
        from ... import storage

        key = _manifest_key(version_id)
        storage.put_bytes(key, json.dumps(manifest).encode(), "application/json")
        return key

    def index_video(self, video_id: str, version_id: str) -> None:
        from ... import storage

        storage.put_bytes(_video_index_key(video_id, version_id), b"", "application/octet-stream")

    def list_for_video(self, video_id: str) -> list[str]:
        from ... import storage

        prefix = f"datasets/index/videos/{video_id}/"
        return sorted(k[len(prefix):] for k in storage.list_keys(prefix) if k != prefix)


class InMemoryDatasetVersionRepository:
    """Test/local adapter with the same contract."""

    def __init__(self) -> None:
        self._versions: dict[str, DatasetVersion] = {}
        self._manifests: dict[str, dict] = {}
        self._by_video: dict[str, set] = {}

    def get(self, version_id: str) -> DatasetVersion | None:
        return self._versions.get(version_id)

    def upsert(self, version: DatasetVersion) -> DatasetVersion:
        self._versions[version.id] = version
        return version

    def write_manifest(self, version_id: str, manifest: dict) -> str:
        self._manifests[version_id] = manifest
        return _manifest_key(version_id)

    def index_video(self, video_id: str, version_id: str) -> None:
        self._by_video.setdefault(video_id, set()).add(version_id)

    def list_for_video(self, video_id: str) -> list[str]:
        return sorted(self._by_video.get(video_id, set()))
