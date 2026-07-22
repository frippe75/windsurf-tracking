"""Pure-helper tests for the training entrypoint (no GPU / ML stack needed)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from train_entry import build_metrics  # noqa: E402


def test_build_metrics_shapes_the_payload():
    m = build_metrics(
        names=["Sail"], map50=0.87321, map50_95=0.6412, per_class_map=[0.6412], epochs=50, num_images=120
    )
    assert m["mAP50"] == 0.8732
    assert m["mAP50_95"] == 0.6412
    assert m["per_class"] == [{"class": "Sail", "ap50_95": 0.6412}]
    assert m["epochs"] == 50 and m["num_images"] == 120


def test_build_metrics_falls_back_to_index_names():
    m = build_metrics(names=[], map50=0.5, map50_95=0.3, per_class_map=[0.3, 0.4], epochs=1)
    assert [c["class"] for c in m["per_class"]] == ["0", "1"]
