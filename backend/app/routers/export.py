"""
YOLO dataset export.

Reads the project's persisted annotations + classes (source of truth), generates
a YOLO dataset, and hands it to a pluggable sink (zip download by default,
ClearML if configured). Synchronous v1 — fine for modest datasets; wrap in a job
(with a Redis-backed store) when datasets get large.
"""
import re
import shutil
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import get_current_active_user
from ..database import DBAnnotation, DBAnnotationClass, DBProject, DBUser, get_db
from ..api_models import ExportRequest
from ..export import generator, sinks
from .. import storage

router = APIRouter(prefix="/api", tags=["export"])

videos_db = {}  # injected from main


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
    project = db.query(DBProject).filter(
        DBProject.id == project_id, DBProject.owner_id == current_user.id,
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found or access denied")

    sink = sinks.get_sink(request.sink)
    if sink is None:
        avail = list(sinks.available_sinks().keys())
        raise HTTPException(status_code=400,
                            detail=f"sink '{request.sink}' unavailable; available: {avail}")

    video_id = str(project.video_id)
    video_info = videos_db.get(video_id)
    if not video_info:
        raise HTTPException(status_code=404, detail="Project video not found")
    local = storage.ensure_local(video_id)
    if not local:
        raise HTTPException(status_code=400, detail="Video file unavailable for frame export")

    classes = (db.query(DBAnnotationClass)
               .filter(DBAnnotationClass.project_id == project_id)
               .order_by(DBAnnotationClass.created_at).all())
    annotations = (db.query(DBAnnotation)
                   .filter(DBAnnotation.project_id == project_id).all())
    if not annotations:
        raise HTTPException(status_code=400, detail="Project has no annotations to export")

    tmp = Path(tempfile.mkdtemp(prefix="yolo-export-"))
    try:
        stats = generator.build_yolo_dataset(
            tmp, str(local), video_info.fps, video_id[:8],
            annotations, classes, request.val_fraction,
        )
        if stats.images == 0:
            raise HTTPException(status_code=400,
                                detail="No exportable boxes (need class_id + bbox on annotations)")
        safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", f"{project.name}-{project_id[:8]}")
        meta = {"project_id": project_id, "name": safe, "clearml_project": request.clearml_project}
        result = sink.publish(tmp, meta)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    return {
        "project_id": project_id,
        "sink": sink.name,
        "stats": {
            "images": stats.images, "labels": stats.labels, "boxes": stats.boxes,
            "skipped": stats.skipped, "classes": stats.classes, "splits": stats.splits,
        },
        "result": result,
    }
