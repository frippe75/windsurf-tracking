"""
YOLO dataset generation — destination-agnostic.

Produces a standard YOLO detection dataset in a directory:
    images/{train,val}/<stem>.jpg
    labels/{train,val}/<stem>.txt     # <class_idx> <xc> <yc> <w> <h>  (normalized)
    data.yaml                         # names, nc, train/val paths

Coordinate contract: annotation `geometry.bbox` is {x, y, w, h} normalized to
[0,1] with (x,y) the top-left (displayed-rect % ÷ 100 = native fraction, since the
displayed rect is object-contain / same aspect as native). YOLO wants the box
CENTER, so we convert here. Boxes without a bbox are skipped (detection needs one).

The caller owns the output dir (a temp dir) and hands it to a sink to publish.
"""
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List


@dataclass
class DatasetStats:
    images: int = 0
    labels: int = 0
    boxes: int = 0
    skipped: int = 0
    classes: List[str] = field(default_factory=list)
    splits: Dict[str, int] = field(default_factory=dict)


def _yolo_line(class_idx: int, bbox: dict) -> str | None:
    try:
        x, y, w, h = float(bbox["x"]), float(bbox["y"]), float(bbox["w"]), float(bbox["h"])
    except (KeyError, TypeError, ValueError):
        return None
    if w <= 0 or h <= 0:
        return None
    xc, yc = x + w / 2.0, y + h / 2.0
    # clamp into [0,1]
    xc, yc = min(max(xc, 0.0), 1.0), min(max(yc, 0.0), 1.0)
    w, h = min(w, 1.0), min(h, 1.0)
    return f"{class_idx} {xc:.6f} {yc:.6f} {w:.6f} {h:.6f}"


def build_yolo_dataset(
    out_dir: Path,
    frame_provider,  # callable(frame_number:int) -> JPEG bytes; raises if unreadable
    stem: str,
    annotations: list,
    classes: list,
    val_fraction: float = 0.2,
    progress_cb=None,  # optional callable(done:int, total:int) — per-frame progress
) -> DatasetStats:
    """Assemble a YOLO dataset on disk. This is a pure *format writer*: it groups labels, splits
    train/val, and writes image bytes obtained from ``frame_provider`` — it no longer knows how a
    frame is decoded or where it's cached (that's the FrameStore's job). See DATASET_ARCHITECTURE.md.

    annotations: rows with .frame_number, .class_id, .geometry (dict with 'bbox').
    classes:     ordered rows with .id, .name → class index = position.
    """
    class_index = {str(c.id): i for i, c in enumerate(classes)}
    stats = DatasetStats(classes=[c.name for c in classes])

    # group boxes by frame (only annotations with a class + bbox)
    by_frame: Dict[int, List[str]] = {}
    for a in annotations:
        cid = str(a.class_id) if a.class_id else None
        bbox = (a.geometry or {}).get("bbox")
        if cid is None or cid not in class_index or not bbox:
            stats.skipped += 1
            continue
        line = _yolo_line(class_index[cid], bbox)
        if line is None:
            stats.skipped += 1
            continue
        by_frame.setdefault(a.frame_number, []).append(line)
        stats.boxes += 1

    # deterministic train/val split by frame (every Nth frame → val)
    frames = sorted(by_frame)
    val_every = max(2, round(1 / val_fraction)) if val_fraction > 0 else 0
    for d in ("images/train", "images/val", "labels/train", "labels/val"):
        (out_dir / d).mkdir(parents=True, exist_ok=True)

    for i, frame in enumerate(frames):
        split = "val" if (val_every and i % val_every == 0) else "train"
        name = f"{stem}_{frame:06d}"
        try:
            jpg = frame_provider(frame)
        except Exception:
            stats.skipped += len(by_frame[frame])
            continue
        (out_dir / "images" / split / f"{name}.jpg").write_bytes(jpg)
        (out_dir / "labels" / split / f"{name}.txt").write_text("\n".join(by_frame[frame]) + "\n")
        stats.images += 1
        stats.labels += 1
        stats.splits[split] = stats.splits.get(split, 0) + 1
        if progress_cb:
            progress_cb(i + 1, len(frames))

    names_yaml = "\n".join(f"  {i}: {n}" for i, n in enumerate(stats.classes))
    (out_dir / "data.yaml").write_text(
        f"path: .\ntrain: images/train\nval: images/val\nnc: {len(stats.classes)}\nnames:\n{names_yaml}\n"
    )
    return stats
