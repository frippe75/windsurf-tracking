"""DatasetBuilder — assembles a version's on-disk dataset + publishes it via a sink.

Materialize frames (through the FrameStore, so they're cached) → write the YOLO layout → publish.
This is the orchestration the export Celery task used to do inline; centralizing it here keeps the
task a thin adapter and makes the pipeline unit-testable (DATASET_ARCHITECTURE.md §4).
"""
from __future__ import annotations

import shutil
import tempfile
from pathlib import Path

from ..ports import FrameExtractor, FrameStore


class DatasetBuilder:
    def __init__(self, store: FrameStore, extractor: FrameExtractor, sinks: dict) -> None:
        self._store = store
        self._extractor = extractor
        self._sinks = sinks  # {name: DatasetSink}

    def build(self, *, version_id: str, inputs, progress_cb=None):
        """Return (stats, sink_result). sink_result carries the artifact key + a URL."""
        from ...export import generator

        sink = self._sinks.get(inputs.sink_name)
        if sink is None:
            raise RuntimeError(f"sink {inputs.sink_name!r} unavailable ({list(self._sinks)})")

        tmp = Path(tempfile.mkdtemp(prefix="dsv-"))
        try:
            def frame_provider(frame_number: int) -> bytes:
                return self._store.get_or_materialize(
                    inputs.source_video_id, frame_number,
                    source_path=inputs.source_path, fps=inputs.fps, extractor=self._extractor,
                )

            stats = generator.build_yolo_dataset(
                tmp, frame_provider, inputs.source_video_id[:8],
                inputs.annotations, inputs.classes, inputs.val_fraction, progress_cb=progress_cb,
            )
            if stats.images == 0:
                raise RuntimeError("no exportable boxes (need class_id + bbox on annotations)")

            # Immutable, content-addressed artifact location.
            meta = {
                "project_id": inputs.project_id,
                "name": f"dataset-{version_id}",
                "key": f"datasets/versions/{version_id}/dataset.zip",
                "clearml_project": inputs.clearml_project,
            }
            result = sink.publish(tmp, meta)
            return stats, result
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
