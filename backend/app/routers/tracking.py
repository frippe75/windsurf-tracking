"""
Tracking job execution endpoints.

Jobs are *created* by `POST /api/videos/{video_id}/tracking/jobs` (see
routers/videos.py), which stores each (sub-)job in `tracking_jobs_db`. Here we
execute a stored job on the GPU worker (Celery task
`workers.tasks.sam2.track_objects_task`, queue `gpu_0_worker`) and expose its
live status/results. The worker pulls the source video from S3 itself, runs
SAM2 video propagation, and returns per-frame bboxes + base64 masks.
"""

import os
from fastapi import APIRouter, HTTPException, BackgroundTasks

router = APIRouter(prefix="/api/tracking", tags=["tracking"])

# Injected from main (shared with routers.videos so create/execute see the same jobs)
tracking_jobs_db = {}
job_status_db = {}


def _celery():
    """Celery client bound to the shared Redis (broker db 1, results db 2)."""
    from celery import Celery
    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
    app = Celery("windsurf_workers")
    app.conf.broker_url = f"{redis_url}/1"
    app.conf.result_backend = f"{redis_url}/2"
    return app


def _celery_status(job: dict) -> dict:
    """Translate the Celery task state of a job into the frontend's status shape
    ({status, percentage, ...}). Also flips the stored job status on terminal
    states so a completed job stays completed after the result expires."""
    task_id = job.get("task_id")
    if not task_id:
        return {"job_id": job["job_id"], "status": job.get("status", "pending"), "percentage": 0}

    res = _celery().AsyncResult(task_id)
    state = res.state
    out = {"job_id": job["job_id"]}

    if state in ("PENDING", "RECEIVED", "STARTED", "RETRY"):
        out.update(status="running", percentage=job.get("percentage", 0))
    elif state == "PROGRESS":
        info = res.info if isinstance(res.info, dict) else {}
        pct = info.get("percentage", job.get("percentage", 0))
        job["percentage"] = pct
        out.update(status="running", percentage=pct,
                   current_frame=info.get("current_frame"), stage=info.get("stage"))
    elif state == "SUCCESS":
        result = res.result if isinstance(res.result, dict) else {}
        if result.get("success"):
            job["status"] = "completed"
            out.update(status="completed", percentage=100)
        else:
            job["status"] = "failed"
            out.update(status="failed", percentage=0,
                       error=result.get("error", "tracking failed in worker"))
    elif state == "FAILURE":
        job["status"] = "failed"
        out.update(status="failed", percentage=0, error=str(res.info)[:300])
    else:
        out.update(status=job.get("status", "running"), percentage=job.get("percentage", 0))

    return out


@router.post("/jobs/{job_id}/execute")
async def execute_tracking_job(job_id: str, background_tasks: BackgroundTasks):
    """Dispatch a pending tracking job to the GPU worker."""

    if job_id not in tracking_jobs_db:
        raise HTTPException(status_code=404, detail="Job not found")

    job = tracking_jobs_db[job_id]

    if job.get("status") not in (None, "pending"):
        # Idempotent: re-executing a running/completed job just reports it.
        return {"job_id": job_id, "status": job.get("status"),
                "message": f"Job already {job.get('status')}",
                "monitor_url": f"/api/tracking/jobs/{job_id}/status"}

    task_data = {
        "s3_bucket": job["s3_bucket"],
        "s3_key": job["s3_key"],
        "objects_data": job["objects_data"],
        "start_frame": job["start_frame"],
        "end_frame": job["end_frame"],
        "model_size": job.get("model_size", "tiny"),
    }

    try:
        task = _celery().send_task(
            "workers.tasks.sam2.track_objects_task",
            args=[task_data],
            queue="gpu_0_worker",
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not reach GPU worker: {e}")

    job["task_id"] = task.id
    job["status"] = "running"
    job["percentage"] = 0

    return {
        "job_id": job_id,
        "status": "started",
        "message": "SAM2 tracking dispatched to GPU worker",
        "monitor_url": f"/api/tracking/jobs/{job_id}/status",
    }


@router.get("/jobs/{job_id}/status")
async def get_job_status(job_id: str):
    """Live status/progress of a tracking job (Celery task state)."""

    if job_id not in tracking_jobs_db:
        raise HTTPException(status_code=404, detail="Job not found")

    return _celery_status(tracking_jobs_db[job_id])


@router.get("/jobs/{job_id}/results")
async def get_job_results(job_id: str):
    """Per-frame tracking results once the job has completed."""

    if job_id not in tracking_jobs_db:
        raise HTTPException(status_code=404, detail="Job not found")

    job = tracking_jobs_db[job_id]
    status = _celery_status(job)

    result_payload = None
    task_id = job.get("task_id")
    if status["status"] == "completed" and task_id:
        res = _celery().AsyncResult(task_id)
        worker_result = res.result if isinstance(res.result, dict) else {}
        # Worker returns {success, results: {frames: [...], summary}}
        result_payload = worker_result.get("results")

    return {
        "job_id": job_id,
        "video_id": job.get("video_id"),
        "name": job.get("name", "Tracking Job"),
        "status": status["status"],
        "start_frame": job.get("start_frame"),
        "end_frame": job.get("end_frame"),
        "frames": job.get("frames"),
        "results": result_payload,
        "error": status.get("error"),
    }


@router.get("/results")
async def get_tracking_results():
    """Summary of all known tracking jobs."""

    results = []
    for job_id, job in tracking_jobs_db.items():
        st = _celery_status(job)
        results.append({
            "job_id": job_id,
            "video_id": job.get("video_id"),
            "name": job.get("name", "Tracking Job"),
            "status": st["status"],
            "percentage": st.get("percentage", 0),
            "start_frame": job.get("start_frame"),
            "end_frame": job.get("end_frame"),
            "frames": job.get("frames"),
        })

    return {
        "results": results,
        "total": len(results),
        "summary": {
            "completed": len([r for r in results if r["status"] == "completed"]),
            "running": len([r for r in results if r["status"] == "running"]),
            "pending": len([r for r in results if r["status"] == "pending"]),
            "failed": len([r for r in results if r["status"] == "failed"]),
        },
    }
