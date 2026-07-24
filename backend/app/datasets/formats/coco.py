"""COCO detection format writer — proves the format seam (added with no core change).

Emits `images/` + `annotations/instances.json` (COCO object-detection schema). bboxes are absolute
pixels [x,y,w,h] (COCO), converted from the normalized geometry via the decoded frame size.
"""
from __future__ import annotations


class CocoWriter:
    name = "coco"

    def write(self, out_dir, frame_provider, stem, annotations, classes, val_fraction=0.2, progress_cb=None):
        import json
        from io import BytesIO

        from PIL import Image

        from ...export.generator import DatasetStats

        class_index = {str(c.id): i for i, c in enumerate(classes)}
        stats = DatasetStats(classes=[c.name for c in classes])

        by_frame: dict[int, list] = {}
        for a in annotations:
            cid = str(a.class_id) if a.class_id else None
            bbox = (a.geometry or {}).get("bbox")
            if cid is None or cid not in class_index or not bbox:
                stats.skipped += 1
                continue
            by_frame.setdefault(a.frame_number, []).append((class_index[cid], bbox))
            stats.boxes += 1

        (out_dir / "images").mkdir(parents=True, exist_ok=True)
        (out_dir / "annotations").mkdir(parents=True, exist_ok=True)

        categories = [{"id": i, "name": c.name} for i, c in enumerate(classes)]
        images: list[dict] = []
        coco_anns: list[dict] = []
        ann_id = 1
        frames = sorted(by_frame)
        val_every = max(2, round(1 / val_fraction)) if val_fraction > 0 else 0

        for i, frame in enumerate(frames):
            try:
                jpg = frame_provider(frame)
            except Exception:
                stats.skipped += len(by_frame[frame])
                continue
            w, h = Image.open(BytesIO(jpg)).size
            fname = f"{stem}_{frame:06d}.jpg"
            (out_dir / "images" / fname).write_bytes(jpg)
            img_id = i + 1
            images.append({"id": img_id, "file_name": f"images/{fname}", "width": w, "height": h})
            for cls_idx, bb in by_frame[frame]:
                bx, by, bw, bh = bb["x"] * w, bb["y"] * h, bb["w"] * w, bb["h"] * h
                coco_anns.append({
                    "id": ann_id, "image_id": img_id, "category_id": cls_idx,
                    "bbox": [bx, by, bw, bh], "area": bw * bh, "iscrowd": 0,
                })
                ann_id += 1
            stats.images += 1
            stats.labels += 1
            split = "val" if (val_every and i % val_every == 0) else "train"
            stats.splits[split] = stats.splits.get(split, 0) + 1
            if progress_cb:
                progress_cb(i + 1, len(frames))

        (out_dir / "annotations" / "instances.json").write_text(
            json.dumps({"images": images, "annotations": coco_anns, "categories": categories})
        )
        return stats
