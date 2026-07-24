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


class InMemoryDatasetVersionRepository:
    """Test/local adapter with the same contract."""

    def __init__(self) -> None:
        self._versions: dict[str, DatasetVersion] = {}
        self._manifests: dict[str, dict] = {}

    def get(self, version_id: str) -> DatasetVersion | None:
        return self._versions.get(version_id)

    def upsert(self, version: DatasetVersion) -> DatasetVersion:
        self._versions[version.id] = version
        return version

    def write_manifest(self, version_id: str, manifest: dict) -> str:
        self._manifests[version_id] = manifest
        return _manifest_key(version_id)
