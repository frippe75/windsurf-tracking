"""Lineage (P3): model-runs recorded against a version, queryable back."""
from app.datasets.lineage.models import ModelRun
from app.datasets.lineage.repository import (
    InMemoryLineageRepository,
    S3LineageRepository,
    run_key,
)


def _run(run_id, vid, **kw):
    return ModelRun(run_id=run_id, dataset_version_id=vid, model="yolov8n.pt", epochs=15,
                    metrics={"mAP50": 0.8}, weights_key=f"models/{run_id}/best.pt",
                    created_at=kw.get("created_at", "t"))


def test_run_key_layout():
    assert run_key("dsv_x", "train-1") == "datasets/versions/dsv_x/models/train-1.json"


def test_inmemory_lineage_record_and_query_idempotent():
    repo = InMemoryLineageRepository()
    repo.record(_run("train-1", "dsv_x"))
    repo.record(_run("train-2", "dsv_x"))
    repo.record(_run("train-1", "dsv_x"))  # same run_id → replace, not duplicate
    runs = repo.runs_for_version("dsv_x")
    assert {r.run_id for r in runs} == {"train-1", "train-2"}
    assert repo.runs_for_version("dsv_other") == []


def test_s3_lineage_repository(monkeypatch):
    from app import storage

    bucket: dict[str, bytes] = {}
    monkeypatch.setattr(storage, "put_bytes", lambda k, d, ct="": bucket.__setitem__(k, d))
    monkeypatch.setattr(storage, "get_bytes", lambda k: bucket[k])
    monkeypatch.setattr(storage, "list_keys", lambda prefix: [k for k in bucket if k.startswith(prefix)])

    repo = S3LineageRepository()
    repo.record(_run("train-a", "dsv_1", created_at="t1"))
    repo.record(_run("train-b", "dsv_1", created_at="t2"))

    assert "datasets/versions/dsv_1/models/train-a.json" in bucket
    runs = repo.runs_for_version("dsv_1")
    assert [r.run_id for r in runs] == ["train-a", "train-b"]  # sorted by created_at
    assert runs[0].dataset_version_id == "dsv_1" and runs[0].metrics["mAP50"] == 0.8
