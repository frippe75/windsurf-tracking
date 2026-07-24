"""Dataset versioning (P2): content fingerprint, version repository, and dedup in the service."""
import types

from app.datasets.service import BuildInputs, DatasetService
from app.datasets.versioning.fingerprint import fingerprint
from app.datasets.versioning.models import DatasetVersion
from app.datasets.versioning.repository import InMemoryDatasetVersionRepository


def _cls(name):
    return types.SimpleNamespace(id=f"cls-{name}", name=name)


def _ann(frame, class_id, bbox):
    return types.SimpleNamespace(frame_number=frame, class_id=class_id, geometry={"bbox": bbox})


BB = {"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4}


def test_fingerprint_is_deterministic_and_order_independent():
    cls = _cls("sail")
    a = [_ann(0, cls.id, BB), _ann(5, cls.id, BB)]
    b = [_ann(5, cls.id, BB), _ann(0, cls.id, BB)]  # reordered
    fa = fingerprint(annotations=a, classes=[cls], val_fraction=0.2)
    fb = fingerprint(annotations=b, classes=[cls], val_fraction=0.2)
    assert fa == fb and fa.startswith("dsv_")


def test_fingerprint_changes_with_content():
    cls = _cls("sail")
    base = fingerprint(annotations=[_ann(0, cls.id, BB)], classes=[cls], val_fraction=0.2)
    moved = fingerprint(annotations=[_ann(0, cls.id, {**BB, "x": 0.9})], classes=[cls], val_fraction=0.2)
    split = fingerprint(annotations=[_ann(0, cls.id, BB)], classes=[cls], val_fraction=0.3)
    assert base != moved and base != split


def test_fingerprint_independent_of_class_uuid_but_depends_on_names():
    # two projects, same logical data, different class UUIDs -> same fingerprint (dedup across projects)
    c1 = types.SimpleNamespace(id="uuid-A", name="sail")
    c2 = types.SimpleNamespace(id="uuid-B", name="sail")
    f1 = fingerprint(annotations=[_ann(0, "uuid-A", BB)], classes=[c1], val_fraction=0.2)
    f2 = fingerprint(annotations=[_ann(0, "uuid-B", BB)], classes=[c2], val_fraction=0.2)
    assert f1 == f2


def test_repository_roundtrip_and_missing():
    repo = InMemoryDatasetVersionRepository()
    assert repo.get("nope") is None
    v = DatasetVersion(id="dsv_x", project_id="p", fingerprint="dsv_x", format="yolo",
                       status="ready", created_at="t", stats={"images": 3})
    repo.upsert(v)
    got = repo.get("dsv_x")
    assert got.status == "ready" and got.stats["images"] == 3


class _CountingBuilder:
    def __init__(self):
        self.builds = 0

    def build(self, *, version_id, inputs, fmt="yolo", progress_cb=None):
        self.builds += 1
        stats = types.SimpleNamespace(images=2, labels=2, boxes=2, skipped=0, classes=["sail"], splits={"train": 2})
        return stats, {"key": f"datasets/versions/{version_id}/dataset.zip", "url": "http://z"}


def _inputs():
    cls = _cls("sail")
    return BuildInputs(project_id="p", project_name="P", source_video_id="v", source_path="/x.mp4",
                       fps=25.0, classes=[cls], annotations=[_ann(0, cls.id, BB), _ann(5, cls.id, BB)],
                       val_fraction=0.2, sink_name="zip")


def test_service_builds_then_dedups():
    repo = InMemoryDatasetVersionRepository()
    builder = _CountingBuilder()
    svc = DatasetService(repo, builder, clock=lambda: "t0")

    v1 = svc.create_or_get(_inputs())          # builds
    v2 = svc.create_or_get(_inputs())          # identical content → dedup, no rebuild

    assert v1.id == v2.id and v1.status == "ready"
    assert builder.builds == 1                 # ← built once, second call served from the repo
    assert v1.artifact_key.endswith("dataset.zip")
    assert repo.get(v1.id).manifest_key is not None
    # version is indexed under its source video (for the Models card listing)
    assert repo.list_for_video("v") == [v1.id]


def test_video_version_index_roundtrip():
    repo = InMemoryDatasetVersionRepository()
    repo.index_video("vidA", "dsv_1")
    repo.index_video("vidA", "dsv_2")
    repo.index_video("vidA", "dsv_1")  # idempotent
    repo.index_video("vidB", "dsv_3")
    assert repo.list_for_video("vidA") == ["dsv_1", "dsv_2"]
    assert repo.list_for_video("vidB") == ["dsv_3"]
    assert repo.list_for_video("nope") == []


def test_service_marks_failed_on_builder_error():
    repo = InMemoryDatasetVersionRepository()

    class Boom:
        def build(self, **_):
            raise RuntimeError("kaboom")

    svc = DatasetService(repo, Boom(), clock=lambda: "t0")
    try:
        svc.create_or_get(_inputs())
        assert False, "should raise"
    except RuntimeError:
        pass
    # a failed record is persisted (so a retry can see it, and it never masquerades as ready)
    fp = fingerprint(annotations=_inputs().annotations, classes=_inputs().classes, val_fraction=0.2)
    assert repo.get(fp).status == "failed"
