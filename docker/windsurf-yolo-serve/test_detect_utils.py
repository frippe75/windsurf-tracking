import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from detect_utils import format_detections, pick_best_run  # noqa: E402


def test_pick_best_run_by_map():
    runs = [
        {"run_id": "a", "weights_key": "k/a", "metrics": {"mAP50": 0.70}},
        {"run_id": "b", "weights_key": "k/b", "metrics": {"mAP50": 0.84}},
        {"run_id": "c", "weights_key": None, "metrics": {"mAP50": 0.99}},  # no weights → ineligible
    ]
    assert pick_best_run(runs)["run_id"] == "b"
    assert pick_best_run([]) is None
    assert pick_best_run([{"run_id": "x", "weights_key": None}]) is None


def test_format_detections_normalizes_xyxy_to_xywh_fractions():
    dets = format_detections(
        boxes_xyxy=[[64, 48, 128, 144]], class_ids=[0], scores=[0.9],
        names={0: "Sail"}, w=640, h=480,
    )
    assert dets == [{"bbox": [0.1, 0.1, 0.1, 0.2], "score": 0.9, "class_id": 0, "label": "Sail"}]
