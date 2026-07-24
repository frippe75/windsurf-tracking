"""Dataset format seam (P4): registry + a second format (COCO) added with no core change."""
import json
import tempfile
import types
from io import BytesIO
from pathlib import Path

from PIL import Image

from app.datasets.formats import get_writer, writer_names


def _cls(name):
    return types.SimpleNamespace(id=f"cls-{name}", name=name)


def _ann(frame, class_id, bbox):
    return types.SimpleNamespace(frame_number=frame, class_id=class_id, geometry={"bbox": bbox})


def _provider():
    def p(_frame):
        buf = BytesIO()
        Image.new("RGB", (200, 100), (0, 0, 0)).save(buf, format="JPEG")
        return buf.getvalue()
    return p


def test_registry_lists_yolo_and_coco():
    assert set(writer_names()) >= {"yolo", "coco"}
    assert get_writer("coco").name == "coco"
    assert get_writer(None).name == "yolo"          # default
    assert get_writer("nope") is None


def test_coco_writer_emits_instances_json():
    cls = _cls("sail")
    bb = {"x": 0.25, "y": 0.5, "w": 0.5, "h": 0.25}
    anns = [_ann(0, cls.id, bb), _ann(3, cls.id, bb)]
    with tempfile.TemporaryDirectory() as d:
        out = Path(d)
        stats = get_writer("coco").write(out, _provider(), "clip", anns, [cls], val_fraction=0.2)

        assert stats.images == 2 and stats.boxes == 2 and stats.classes == ["sail"]
        assert len(list(out.rglob("images/*.jpg"))) == 2
        coco = json.loads((out / "annotations" / "instances.json").read_text())
        assert coco["categories"] == [{"id": 0, "name": "sail"}]
        assert len(coco["images"]) == 2 and len(coco["annotations"]) == 2
        # 200x100 frame: bbox absolute px = [0.25*200, 0.5*100, 0.5*200, 0.25*100]
        assert coco["annotations"][0]["bbox"] == [50.0, 50.0, 100.0, 25.0]
        assert coco["images"][0]["width"] == 200 and coco["images"][0]["height"] == 100
