"""LineageRepository adapters — model↔version links.

Runs live at `datasets/versions/{version_id}/models/{run_id}.json`, next to the version they trained
on. The trainer (pipeline-service) *writes* these on success; the backend *reads* them for lineage
queries — S3 is the integration seam, so neither service calls the other. See DATASET_ARCHITECTURE.md.
"""
from __future__ import annotations

import json

from .models import ModelRun


def runs_prefix(version_id: str) -> str:
    return f"datasets/versions/{version_id}/models/"


def run_key(version_id: str, run_id: str) -> str:
    return f"{runs_prefix(version_id)}{run_id}.json"


class S3LineageRepository:
    def record(self, run: ModelRun) -> ModelRun:
        from ... import storage

        storage.put_bytes(
            run_key(run.dataset_version_id, run.run_id),
            json.dumps(run.to_dict()).encode(), "application/json",
        )
        return run

    def runs_for_version(self, version_id: str) -> list[ModelRun]:
        from ... import storage

        keys = [k for k in storage.list_keys(runs_prefix(version_id)) if k.endswith(".json")]
        runs = [ModelRun.from_dict(json.loads(storage.get_bytes(k))) for k in keys]
        runs.sort(key=lambda r: r.created_at or "")
        return runs


class InMemoryLineageRepository:
    def __init__(self) -> None:
        self._runs: dict[str, list[ModelRun]] = {}

    def record(self, run: ModelRun) -> ModelRun:
        self._runs.setdefault(run.dataset_version_id, [])
        # idempotent by run_id
        self._runs[run.dataset_version_id] = [
            r for r in self._runs[run.dataset_version_id] if r.run_id != run.run_id
        ] + [run]
        return run

    def runs_for_version(self, version_id: str) -> list[ModelRun]:
        return list(self._runs.get(version_id, []))
