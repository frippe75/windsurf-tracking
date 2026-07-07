"""
Tracking job endpoints
"""

from fastapi import APIRouter, HTTPException, BackgroundTasks
from typing import Dict
import asyncio
import uuid
from datetime import datetime

router = APIRouter(prefix="/api/tracking", tags=["tracking"])

# These will be injected from main
tracking_jobs_db = {}
job_status_db = {}

@router.post("/jobs/{job_id}/execute")
async def execute_tracking_job(job_id: str, background_tasks: BackgroundTasks):
    """Execute tracking job in background"""
    
    if job_id not in tracking_jobs_db:
        raise HTTPException(status_code=404, detail="Job not found")
    
    job_data = tracking_jobs_db[job_id]
    
    if job_data['status'] != 'pending':
        raise HTTPException(status_code=400, detail=f"Job status: {job_data['status']}")
    
    # Start job in background (using Celery workers)
    background_tasks.add_task(run_tracking_via_celery, job_id)
    
    return {
        "job_id": job_id,
        "status": "started",
        "message": "Tracking started via Celery workers",
        "monitor_url": f"/api/tracking/jobs/{job_id}/status"
    }

@router.get("/jobs/{job_id}/status")
async def get_job_status(job_id: str):
    """Get current job status and progress"""
    
    if job_id not in tracking_jobs_db:
        raise HTTPException(status_code=404, detail="Job not found")
    
    # Check Redis or fallback storage for status
    try:
        import redis
        import json
        
        redis_client = redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)
        status_data = redis_client.get(f"job_status:{job_id}")
        if status_data:
            return json.loads(status_data)
    except:
        pass
    
    # Fallback to job database
    job_data = tracking_jobs_db[job_id]
    return {
        "job_id": job_id,
        "status": job_data['status'],
        "message": "No detailed status available"
    }

@router.get("/jobs/{job_id}/results")
async def get_job_results(job_id: str):
    """Get tracking job results"""
    
    if job_id not in tracking_jobs_db:
        raise HTTPException(status_code=404, detail="Job not found")
    
    job_data = tracking_jobs_db[job_id]
    
    # Return results (simplified for now)
    return {
        "job_id": job_id,
        "status": job_data['status'],
        "message": "Results via Celery workers"
    }

@router.get("/results")  
async def get_tracking_results():
    """Get all tracking job results"""
    
    results = []
    for job_id, job_data in tracking_jobs_db.items():
        results.append({
            "job_id": job_id,
            "status": job_data['status'],
            "created_at": job_data.get('created_at', '')
        })
    
    return {"results": results, "total": len(results)}

async def run_tracking_via_celery(job_id: str):
    """Run tracking job via Celery workers"""
    
    try:
        from celery import Celery
        
        job_data = tracking_jobs_db[job_id]
        
        # Connect to Celery
        celery_app = Celery('windsurf_workers')
        celery_app.conf.broker_url = 'redis://localhost:6379/1'
        celery_app.conf.result_backend = 'redis://localhost:6379/2'
        
        # Submit to GPU worker
        task = celery_app.send_task(
            'workers.tasks.sam2.track_objects_task',
            args=[job_data],
            queue='gpu_0_worker'
        )
        
        # Wait for completion
        result = task.get()
        
        # Update job status
        job_data['status'] = 'completed'
        
    except Exception as e:
        job_data['status'] = 'failed'
        print(f"Tracking job {job_id} failed: {e}")