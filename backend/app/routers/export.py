"""
YOLO dataset export.

Reads the project's persisted annotations + classes (source of truth), builds a YOLO
dataset, and publishes it via a pluggable sink (zip by default, ClearML if configured).

Async: the heavy work (frame extraction + zip) runs as a Celery task on the cpu-worker so
it never blocks or OOM-kills the web pod. POST dispatches and returns a job_id; poll the
status endpoint until `completed`, then read `result.url`.
"""
import os

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import get_current_active_user
from ..database import DBAnnotation, DBProject, DBUser, get_db
from ..api_models import ExportRequest
from ..export import sinks

router = APIRouter(prefix="/api", tags=["export"])

videos_db = {}  # injected from main


def _celery():
    """Celery client for dispatching to / polling the cpu-worker (queue: cpu_worker)."""
    from celery import Celery

    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
    app = Celery("windsurf_workers")
    app.conf.broker_url = f"{redis_url}/1"
    app.conf.result_backend = f"{redis_url}/2"
    return app


@router.get("/export/sinks")
async def list_sinks():
    """Destinations available in this deployment (first is the default)."""
    return {"sinks": list(sinks.available_sinks().keys())}


@router.post("/projects/{project_id}/export")
async def export_project(
    project_id: str,
    request: ExportRequest = ExportRequest(),
    db: Session = Depends(get_db),
    current_user: DBUser = Depends(get_current_active_user),
):
    """Validate cheaply, then dispatch the build to the cpu-worker. Returns {job_id}."""
    project = db.query(DBProject).filter(
        DBProject.id == project_id, DBProject.owner_id == current_user.id,
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found or access denied")

    if sinks.get_sink(request.sink) is None:
        avail = list(sinks.available_sinks().keys())
        raise HTTPException(status_code=400, detail=f"sink '{request.sink}' unavailable; available: {avail}")

    if db.query(DBAnnotation).filter(DBAnnotation.project_id == project_id).count() == 0:
        raise HTTPException(status_code=400, detail="Project has no annotations to export")

    task = _celery().send_task(
        "windsurf.export_dataset",
        args=[project_id, request.sink, request.val_fraction, request.clearml_project],
        queue="cpu_worker",
    )
    return {"project_id": project_id, "job_id": task.id, "status": "queued"}


@router.get("/projects/{project_id}/export/status/{job_id}")
async def export_status(
    project_id: str,
    job_id: str,
    current_user: DBUser = Depends(get_current_active_user),
):
    """Poll the export job: {status: queued|running|completed|failed, progress?, result?, stats?}."""
    res = _celery().AsyncResult(job_id)
    state = res.state
    if state in ("PENDING", "RECEIVED", "STARTED"):
        return {"job_id": job_id, "status": "running", "progress": 0}
    if state == "PROGRESS":
        info = res.info if isinstance(res.info, dict) else {}
        return {"job_id": job_id, "status": "running", **info}
    if state == "SUCCESS":
        r = res.result or {}
        return {"job_id": job_id, "status": "completed", "sink": r.get("sink"),
                "stats": r.get("stats"), "result": r.get("result"), "version_id": r.get("version_id")}
    if state == "FAILURE":
        return {"job_id": job_id, "status": "failed", "error": str(res.info)[:400]}
    return {"job_id": job_id, "status": state.lower()}


@router.get("/dataset-versions/{version_id}")
async def get_dataset_version(
    version_id: str,
    current_user: DBUser = Depends(get_current_active_user),
):
    """Inspect an immutable dataset version: status, stats, a fresh artifact URL, lineage pointers."""
    from .. import storage
    from ..datasets.versioning.repository import S3DatasetVersionRepository

    v = S3DatasetVersionRepository().get(version_id)
    if v is None:
        raise HTTPException(status_code=404, detail=f"dataset version {version_id!r} not found")
    url = storage.presigned_get(v.artifact_key, f"dataset-{v.id}.zip") if v.artifact_key else None
    return {
        "version_id": v.id, "project_id": v.project_id, "status": v.status, "format": v.format,
        "fingerprint": v.fingerprint, "stats": v.stats, "created_at": v.created_at,
        "source_video_id": v.source_video_id, "manifest_key": v.manifest_key, "artifact_url": url,
    }
