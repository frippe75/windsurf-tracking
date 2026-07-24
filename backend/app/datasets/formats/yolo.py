"""YOLO format writer — delegates to the existing generator (the reference layout)."""
from __future__ import annotations


class YoloWriter:
    name = "yolo"

    def write(self, out_dir, frame_provider, stem, annotations, classes, val_fraction=0.2, progress_cb=None):
        from ...export import generator

        return generator.build_yolo_dataset(
            out_dir, frame_provider, stem, annotations, classes, val_fraction, progress_cb=progress_cb,
        )
