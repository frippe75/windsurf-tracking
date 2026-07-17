"""
Tracking job execution endpoints — backed by the durable `jobs` table.

Jobs are *created* by `POST /api/videos/{video_id}/tracking/jobs` (routers/videos.py),
which inserts DBJob(kind='tracking') rows. Here we execute a stored job on the GPU
worker (Celery task `workers.tasks.sam2.track_objects_task`, queue `gpu_0_worker`)
and expose its live status/results. The job row (params + task_id + status) lives in
Postgres so status/results survive pod restarts, rollouts, and multiple replicas —
the heavy per-frame result stays in the Celery result backend (Redis).
"""
import os
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db, DBJob

router = APIRouter(prefix="/api/tracking", tags=["tracking"])


def _celery():
    from celery import Celery
    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
    app = Celery("windsurf_workers")
    app.conf.broker_url = f"{redis_url}/1"
    app.conf.result_backend = f"{redis_url}/2"
    return app


def _get_job(job_id: str, db: Session) -> DBJob:
    job = db.query(DBJob).filter(DBJob.id == job_id, DBJob.kind == "tracking").first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


def _job_status(db: Session, job: DBJob) -> dict:
    """Reconcile the job's Celery task state into {status, percentage}, persisting
    terminal/progress transitions. Never lets an undecodable meta 500 a poll."""
    out = {"job_id": str(job.id)}
    if not job.task_id:
        return {**out, "status": job.status or "pending", "percentage": job.progress or 0}

    res = _celery().AsyncResult(job.task_id)
    try:
        state = res.state
    except Exception:
        return {**out, "status": job.status or "running", "percentage": job.progress or 0}

    def _safe(attr):
        try:
            v = getattr(res, attr)
            return v if isinstance(v, dict) else {}
        except Exception:
            return {}

    changed = False
    if state in ("PENDING", "RECEIVED", "STARTED", "RETRY"):
        out.update(status="running", percentage=job.progress or 0)
    elif state == "PROGRESS":
        pct = _safe("info").get("percentage", job.progress or 0)
        if pct != job.progress:
            job.progress = pct
            changed = True
        out.update(status="running", percentage=pct)
    elif state == "SUCCESS":
        ok = _safe("result").get("success")
        new_status = "completed" if ok else "failed"
        if job.status != new_status:
            job.status = new_status
            job.progress = 100 if ok else job.progress
            changed = True
        out.update(status=new_status, percentage=100 if ok else (job.progress or 0))
        if not ok:
            out["error"] = _safe("result").get("error", "tracking failed in worker")
    elif state == "FAILURE":
        if job.status != "failed":
            job.status = "failed"
            changed = True
        out.update(status="failed", percentage=0, error=str(res.info)[:300])
    else:
        out.update(status=job.status or "running", percentage=job.progress or 0)

    if changed:
        db.commit()
    return out


@router.post("/jobs/{job_id}/execute")
async def execute_tracking_job(job_id: str, db: Session = Depends(get_db)):
    """Dispatch a pending tracking job to the GPU worker."""
    job = _get_job(job_id, db)

    if job.status not in (None, "pending"):
        return {"job_id": job_id, "status": job.status,
                "message": f"Job already {job.status}",
                "monitor_url": f"/api/tracking/jobs/{job_id}/status"}

    p = job.params or {}
    task_data = {
        "s3_bucket": p.get("s3_bucket"),
        "s3_key": p.get("s3_key"),
        "objects_data": p.get("objects_data"),
        "start_frame": p.get("start_frame"),
        "end_frame": p.get("end_frame"),
        "model_size": p.get("model_size", "tiny"),
    }
    try:
        task = _celery().send_task(
            "workers.tasks.sam2.track_objects_task", args=[task_data], queue="gpu_0_worker",
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not reach GPU worker: {e}")

    job.task_id = task.id
    job.status = "running"
    job.progress = 0
    db.commit()
    return {"job_id": job_id, "status": "started",
            "message": "SAM2 tracking dispatched to GPU worker",
            "monitor_url": f"/api/tracking/jobs/{job_id}/status"}


@router.get("/jobs/{job_id}/status")
async def get_job_status(job_id: str, db: Session = Depends(get_db)):
    return _job_status(db, _get_job(job_id, db))


@router.get("/jobs/{job_id}/results")
async def get_job_results(job_id: str, db: Session = Depends(get_db)):
    job = _get_job(job_id, db)
    status = _job_status(db, job)

    result_payload = None
    if status["status"] == "completed" and job.task_id:
        try:
            res = _celery().AsyncResult(job.task_id)
            worker_result = res.result if isinstance(res.result, dict) else {}
        except Exception:
            worker_result = {}
        result_payload = worker_result.get("results")

    p = job.params or {}
    return {
        "job_id": job_id,
        "video_id": str(job.video_id) if job.video_id else None,
        "name": p.get("name", "Tracking Job"),
        "status": status["status"],
        "start_frame": p.get("start_frame"),
        "end_frame": p.get("end_frame"),
        "frames": p.get("frames"),
        "results": result_payload,
        "error": status.get("error"),
    }


@router.get("/results")
async def get_tracking_results(db: Session = Depends(get_db)):
    jobs = db.query(DBJob).filter(DBJob.kind == "tracking").all()
    results = []
    for job in jobs:
        st = _job_status(db, job)
        p = job.params or {}
        results.append({
            "job_id": str(job.id), "video_id": str(job.video_id) if job.video_id else None,
            "name": p.get("name", "Tracking Job"), "status": st["status"],
            "percentage": st.get("percentage", 0),
            "start_frame": p.get("start_frame"), "end_frame": p.get("end_frame"),
            "frames": p.get("frames"),
        })
    return {
        "results": results, "total": len(results),
        "summary": {s: len([r for r in results if r["status"] == s])
                    for s in ("completed", "running", "pending", "failed")},
    }
