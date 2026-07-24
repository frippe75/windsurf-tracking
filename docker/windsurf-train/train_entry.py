"""YOLO training entrypoint for the in-cluster GPU Job.

Pulls the exported YOLO dataset (a zip the app already produces, with a data.yaml + a
train/val split), trains + evals with ultralytics, and uploads metrics.json + best.pt to S3
under RESULTS_PREFIX. pipeline-service reads metrics.json back for the Train tab.

Heavy deps (ultralytics, boto3) are imported lazily so `build_metrics` stays unit-testable
without a GPU or the ML stack installed.

Env: DATASET_URL, RESULTS_PREFIX, S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY,
     TRAIN_MODEL (default yolov8n.pt), TRAIN_EPOCHS (50), TRAIN_IMGSZ (640).
"""
from __future__ import annotations

import json
import os


def build_metrics(
    names: list[str],
    map50: float,
    map50_95: float,
    per_class_map: list[float],
    epochs: int,
    num_images: int | None = None,
) -> dict:
    """Assemble the metrics.json payload from ultralytics eval numbers (pure)."""
    per_class = [
        {"class": names[i] if i < len(names) else str(i), "ap50_95": round(float(v), 4)}
        for i, v in enumerate(per_class_map)
    ]
    return {
        "mAP50": round(float(map50), 4),
        "mAP50_95": round(float(map50_95), 4),
        "per_class": per_class,
        "epochs": int(epochs),
        "num_images": num_images,
    }


def main() -> int:
    import io
    import tempfile
    import urllib.request
    import zipfile

    import boto3
    from ultralytics import YOLO

    dataset_url = os.environ["DATASET_URL"]
    results_prefix = os.environ["RESULTS_PREFIX"].rstrip("/") + "/"
    bucket = os.environ["S3_BUCKET"]
    model_name = os.environ.get("TRAIN_MODEL", "yolov8n.pt")
    epochs = int(os.environ.get("TRAIN_EPOCHS", "50"))
    imgsz = int(os.environ.get("TRAIN_IMGSZ", "640"))

    work = tempfile.mkdtemp(prefix="train-")
    print(f"[train] downloading dataset → {work}", flush=True)
    with urllib.request.urlopen(dataset_url, timeout=300) as r:
        zipfile.ZipFile(io.BytesIO(r.read())).extractall(work)
    data_yaml = os.path.join(work, "data.yaml")
    if not os.path.exists(data_yaml):
        raise SystemExit(f"[train] no data.yaml in dataset zip ({os.listdir(work)})")
    # Ultralytics resolves data.yaml `path:` against its datasets dir (not the file's dir), so a
    # relative `path: .` looks under /app. Pin it to the absolute extract dir.
    import re as _re
    _dy = open(data_yaml).read()
    _dy = _re.sub(r"(?m)^path:.*$", f"path: {work}", _dy)
    if not _re.search(r"(?m)^path:", _dy):
        _dy = f"path: {work}\n" + _dy
    open(data_yaml, "w").write(_dy)

    s3 = boto3.client(
        "s3",
        endpoint_url=os.environ["S3_ENDPOINT"],
        aws_access_key_id=os.environ["S3_ACCESS_KEY"],
        aws_secret_access_key=os.environ["S3_SECRET_KEY"],
    )

    def _put_json(key: str, obj: dict) -> None:
        s3.put_object(Bucket=bucket, Key=results_prefix + key, Body=json.dumps(obj).encode(), ContentType="application/json")

    # Live progress: after each epoch's validation, publish epoch + running mAP to S3 so the
    # Train tab can show the curve climbing without waiting for the whole run.
    def on_epoch(trainer):
        try:
            m = getattr(trainer, "metrics", {}) or {}
            _put_json("progress.json", {
                "epoch": int(getattr(trainer, "epoch", 0)) + 1,
                "total_epochs": epochs,
                "mAP50": round(float(m.get("metrics/mAP50(B)", 0.0)), 4),
                "mAP50_95": round(float(m.get("metrics/mAP50-95(B)", 0.0)), 4),
            })
        except Exception as ex:  # progress is best-effort, never fail the run
            print(f"[train] progress publish failed: {ex}", flush=True)

    print(f"[train] training {model_name} for {epochs} epochs @ {imgsz}", flush=True)
    _put_json("progress.json", {"epoch": 0, "total_epochs": epochs, "mAP50": 0.0, "mAP50_95": 0.0})
    model = YOLO(model_name)
    model.add_callback("on_fit_epoch_end", on_epoch)
    model.train(data=data_yaml, epochs=epochs, imgsz=imgsz, project=work, name="run", exist_ok=True)
    res = model.val()
    names = list(res.names.values()) if hasattr(res, "names") else []
    payload = build_metrics(names, res.box.map50, res.box.map, list(res.box.maps), epochs)

    s3.put_object(
        Bucket=bucket, Key=results_prefix + "metrics.json",
        Body=json.dumps(payload).encode(), ContentType="application/json",
    )
    best = os.path.join(work, "run", "weights", "best.pt")
    if os.path.exists(best):
        s3.upload_file(best, bucket, results_prefix + "best.pt")
    print(f"[train] done → {results_prefix} {payload}", flush=True)
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
