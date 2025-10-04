"""
FastAPI Backend for Windsurf Dataset Web UI
Low-latency video annotation API with persistent AI models
"""

import os
import sys
import uuid
import cv2
import numpy as np
import time
import logging
from pathlib import Path
from typing import List, Dict, Optional, Tuple
from datetime import datetime
import json

# Setup debug logging to file
debug_logger = logging.getLogger("windsurf_debug")
debug_logger.setLevel(logging.DEBUG)
debug_handler = logging.FileHandler("/tmp/windsurf_debug.log")
debug_handler.setFormatter(logging.Formatter('%(asctime)s - %(levelname)s - %(message)s'))
debug_logger.addHandler(debug_handler)

# Add windsurf package to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel
import uvicorn
import asyncio
import redis
import json

# Import windsurf business logic (single source of truth)
from windsurf.scene_detector import detect_scenes_api_format
from windsurf.ai_models import preload_all_models, model_manager, segment_frame_with_prompts, detect_sails_in_frame
from windsurf.video_manager import save_uploaded_video, extract_frame, extract_video_metadata

# Import request/response models
from models import (
    TrackingJobRequest, TrackingJobResponse, AutoSplitResult, SplitJobInfo,
    JobStatus, JobProgress, MemoryUsage, ClickPrompt, TrackingSegment
)

app = FastAPI(
    title="Windsurf Dataset API",
    description="Low-latency API for windsurf video annotation and AI model integration",
    version="1.0.0"
)

# Enable CORS for web frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://e2f2a6ee-f804-40b9-ac9c-90cce5fa95de.lovableproject.com",
        "http://localhost:3000",  # For local development
        "http://localhost:5173",  # For Vite dev server
        "*" if os.getenv("ENV") == "development" else ""  # Wildcard only in dev
    ],
    allow_origin_regex=r"https://.*\.lovable\.app",  # Allow all Lovable app domains
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global storage (in production, use proper database)
videos_db = {}  # video_id -> VideoInfo
projects_db = {}  # project_id -> ProjectData
tracking_jobs_db = {}  # job_id -> TrackingJobData

# Redis for async job status (fallback to dict if Redis not available)
try:
    redis_client = redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)
    redis_client.ping()
    USE_REDIS = True
except:
    USE_REDIS = False
    job_status_db = {}  # Fallback to in-memory

# Data models
class VideoInfo(BaseModel):
    id: str
    filename: str
    file_path: str
    duration: float
    fps: float
    width: int
    height: int
    total_frames: int
    upload_date: datetime
    status: str = "ready"

class SceneData(BaseModel):
    scene_id: int
    start_frame: int
    end_frame: int
    start_time: float
    end_time: float
    duration: float
    quality: str = "unknown"  # unknown, good, bad

class FrameRequest(BaseModel):
    frame_number: int
    width: Optional[int] = None
    height: Optional[int] = None

# Configure windsurf library for backend upload directory
from windsurf.video_manager import video_manager
backend_upload_dir = Path(__file__).parent / "uploads"
video_manager.upload_dir = backend_upload_dir
video_manager.upload_dir.mkdir(exist_ok=True)

@app.get("/")
async def root():
    """API health check"""
    return {
        "message": "Windsurf Dataset API",
        "version": "1.0.0",
        "status": "healthy"
    }

@app.post("/api/videos/upload")
async def upload_video(file: UploadFile = File(...)):
    """Upload video file and extract metadata - thin wrapper over windsurf library"""
    
    try:
        # Read file content
        content = await file.read()
        
        # Use windsurf library for all logic
        video_data = save_uploaded_video(file.filename, content)
        
        # Store in database
        video_info = VideoInfo(
            id=video_data['video_id'],
            filename=video_data['filename'],
            file_path=video_data['file_path'],
            duration=video_data['duration'],
            fps=video_data['fps'],
            width=video_data['width'],
            height=video_data['height'],
            total_frames=video_data['total_frames'],
            upload_date=datetime.now()
        )
        
        videos_db[video_data['video_id']] = video_info
        
        return {
            "video_id": video_data['video_id'],
            "filename": video_data['filename'],
            "duration": video_data['duration'],
            "fps": video_data['fps'],
            "resolution": video_data['resolution'],
            "total_frames": video_data['total_frames'],
            "message": "Video uploaded successfully"
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/videos")
async def list_videos():
    """List all uploaded videos"""
    
    video_list = []
    for video_id, video_info in videos_db.items():
        video_list.append({
            "video_id": video_id,
            "filename": video_info.filename,
            "duration": video_info.duration,
            "fps": video_info.fps,
            "resolution": f"{video_info.width}x{video_info.height}",
            "total_frames": video_info.total_frames,
            "upload_date": video_info.upload_date.isoformat(),
            "status": video_info.status
        })
    
    return {"videos": video_list, "total": len(video_list)}

@app.get("/api/videos/exists")
async def check_video_exists(filename: str):
    """Check if video exists by filename"""
    
    # Search through videos_db for matching filename
    for video_id, video_info in videos_db.items():
        if video_info.filename == filename:
            return {
                "exists": True,
                "video_id": video_id,
                "filename": filename,
                "duration": video_info.duration,
                "resolution": f"{video_info.width}x{video_info.height}",
                "upload_date": video_info.upload_date.isoformat()
            }
    
    return {
        "exists": False,
        "filename": filename
    }

@app.get("/api/videos/{video_id}")
async def get_video_info(video_id: str):
    """
    Get detailed video information including coordinate system specs
    
    Returns video metadata needed for proper click coordinate mapping.
    Frontend should use width×height for click prompt coordinates.
    """
    
    if video_id not in videos_db:
        raise HTTPException(status_code=404, detail="Video not found")
    
    video_info = videos_db[video_id]
    
    return {
        "video_id": video_id,
        "filename": video_info.filename,
        "duration": video_info.duration,
        "fps": video_info.fps,
        "width": video_info.width,
        "height": video_info.height,
        "total_frames": video_info.total_frames,
        "upload_date": video_info.upload_date.isoformat(),
        "status": video_info.status,
        "file_size": Path(video_info.file_path).stat().st_size if Path(video_info.file_path).exists() else 0,
        "coordinate_system": {
            "description": "Click prompts must use native video resolution coordinates",
            "x_range": [0, video_info.width],
            "y_range": [0, video_info.height],
            "example_center": [video_info.width // 2, video_info.height // 2]
        }
    }

@app.get("/api/videos/{video_id}/frame/{frame_number}")
async def get_frame(video_id: str, frame_number: int, width: Optional[int] = None, height: Optional[int] = None):
    """Extract specific frame as image - thin wrapper over windsurf library"""
    
    if video_id not in videos_db:
        raise HTTPException(status_code=404, detail="Video not found")
    
    video_info = videos_db[video_id]
    
    try:
        # Use windsurf library for frame extraction
        resize = (width, height) if width and height else None
        pil_frame = extract_frame(video_info.file_path, frame_number, resize)
        
        # Convert to PNG bytes using library
        from windsurf.video_manager import video_manager
        png_bytes = video_manager.frame_to_png_bytes(pil_frame)
        
        import io
        return StreamingResponse(
            io.BytesIO(png_bytes),
            media_type="image/png",
            headers={"Cache-Control": "max-age=3600"}
        )
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Frame extraction failed: {str(e)}")

@app.delete("/api/videos/{video_id}")
async def delete_video(video_id: str):
    """Delete video and cleanup files - thin wrapper over windsurf library"""
    
    if video_id not in videos_db:
        raise HTTPException(status_code=404, detail="Video not found")
    
    video_info = videos_db[video_id]
    
    try:
        # Use windsurf library for cleanup
        from windsurf.video_manager import video_manager
        video_manager.delete_video(video_info.file_path)
        
        # Remove from database
        del videos_db[video_id]
        
        return {"message": f"Video {video_id} deleted successfully"}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Scene Detection Routes
@app.post("/api/videos/{video_id}/scenes/detect")
async def detect_scenes_api(video_id: str, background_tasks: BackgroundTasks):
    """Run scene detection on video"""
    
    if video_id not in videos_db:
        raise HTTPException(status_code=404, detail="Video not found")
    
    video_info = videos_db[video_id]
    
    try:
        # Use windsurf library for real scene detection
        scenes_data = detect_scenes_api_format(video_info.file_path)
        
        return {
            "video_id": video_id,
            **scenes_data  # Include all scene detection results
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Scene detection failed: {str(e)}")

# AI Model Endpoints - Direct model access with 1:1 parameter mapping

@app.post("/api/ai/dino/detect")
async def dino_detect(request: Dict):
    """DINO object detection - direct model access"""
    
    try:
        # Get image from video_id+frame_number or base64
        pil_frame = await extract_image_from_request(request)
        
        # DINO-specific parameters
        confidence_threshold = request.get('confidence_threshold', 0.3)
        
        # Use windsurf library for detection
        sail_count, bboxes, centers = detect_sails_in_frame(pil_frame, confidence_threshold)
        
        return {
            "success": True,
            "model": "GroundingDINO",
            "parameters": {"confidence_threshold": confidence_threshold},
            "results": {
                "sail_count": sail_count,
                "bboxes": bboxes,
                "centers": centers
            }
        }
        
    except Exception as e:
        return {
            "success": False,
            "model": "GroundingDINO",
            "error": str(e)
        }

@app.post("/api/ai/sam2/segment")
async def sam2_segment(request: Dict):
    """SAM2 segmentation - direct model access with positive/negative prompts"""
    
    try:
        # Get image
        pil_frame = await extract_image_from_request(request)
        
        # SAM2-specific parameters
        positive_prompts = []
        negative_prompts = []
        
        for prompt in request.get('click_prompts', []):
            point = (prompt['x'], prompt['y'])
            if prompt['type'] == 'positive':
                positive_prompts.append(point)
            elif prompt['type'] == 'negative':
                negative_prompts.append(point)
        
        if not positive_prompts:
            raise HTTPException(status_code=400, detail="At least one positive click-prompt required")
        
        # Use windsurf library for segmentation
        result = segment_frame_with_prompts(pil_frame, positive_prompts, negative_prompts)
        
        if result['success']:
            # Convert mask to base64 for frontend
            mask = result['mask']
            import base64
            from io import BytesIO
            from PIL import Image
            
            mask_img = Image.fromarray((mask * 255).astype(np.uint8), mode='L')
            img_buffer = BytesIO()
            mask_img.save(img_buffer, format='PNG')
            mask_base64 = base64.b64encode(img_buffer.getvalue()).decode()
            
            return {
                "success": True,
                "model": "SAM2-Hiera-Tiny",
                "parameters": {
                    "positive_prompts": positive_prompts,
                    "negative_prompts": negative_prompts
                },
                "results": {
                    "bbox": result['bbox'],
                    "center": result['center'],
                    "score": result['score'],
                    "mask_base64": mask_base64,
                    "mask_pixels": len(np.where(mask)[0])
                }
            }
        else:
            return {
                "success": False,
                "model": "SAM2-Hiera-Tiny",
                "error": result['error']
            }
            
    except Exception as e:
        return {
            "success": False,
            "model": "SAM2-Hiera-Tiny",
            "error": str(e)
        }

@app.get("/api/ai/status")
async def ai_models_status():
    """AI model status and GPU memory information"""
    
    from windsurf.ai_models import model_manager
    import torch
    
    status = {
        "models_loaded": list(model_manager.models.keys()),
        "device": str(model_manager.device),
        "gpu_available": torch.cuda.is_available()
    }
    
    if torch.cuda.is_available():
        # Runtime VRAM detection (critical for K8s)
        total_memory = torch.cuda.get_device_properties(0).total_memory
        allocated_memory = torch.cuda.memory_allocated()
        reserved_memory = torch.cuda.memory_reserved()
        
        status["gpu_memory"] = {
            "total_gb": f"{total_memory / 1024**3:.2f}",
            "allocated_gb": f"{allocated_memory / 1024**3:.2f}",
            "reserved_gb": f"{reserved_memory / 1024**3:.2f}",
            "available_gb": f"{(total_memory - reserved_memory) / 1024**3:.2f}",
            "utilization_percent": f"{(reserved_memory / total_memory) * 100:.1f}%"
        }
    
    return status

# Tracking Job Endpoints
@app.post("/api/videos/{video_id}/tracking/jobs")
async def create_tracking_job(video_id: str, request: Dict, background_tasks: BackgroundTasks):
    """
    Create tracking job with auto-splitting for T4 memory limits
    
    Click prompt coordinates must be in NATIVE VIDEO RESOLUTION:
    - For 1280×720 video: x ∈ [0, 1280], y ∈ [0, 720]
    - For 640×360 video: x ∈ [0, 640], y ∈ [0, 360]
    
    Example request:
    {
        "segments": [{
            "start_frame": 100,
            "end_frame": 115,
            "click_prompts": [
                {"x": 640, "y": 360, "type": "positive"}  # Center of 1280×720 video
            ]
        }]
    }
    """
    
    if video_id not in videos_db:
        raise HTTPException(status_code=404, detail="Video not found")
    
    video_info = videos_db[video_id]
    
    try:
        # Extract request parameters
        segments = request.get('segments', [])
        if not segments:
            raise HTTPException(status_code=400, detail="No segments provided")
        
        segment = segments[0]  # For now, handle single segment
        start_frame = segment['start_frame']
        end_frame = segment['end_frame']
        click_prompts = segment.get('click_prompts', [])
        
        total_frames = end_frame - start_frame
        
        # Memory estimation using scrubber logic
        estimated_memory = estimate_sam2_memory(total_frames, num_objects=len(click_prompts))
        
        job_id = str(uuid.uuid4())
        
        # Auto-split if too big for T4
        if estimated_memory > 12.0:  # T4 limit
            # Split into 100-frame chunks
            max_frames = 100
            num_parts = (total_frames + max_frames - 1) // max_frames
            
            split_jobs = []
            for part in range(num_parts):
                if part == 0:
                    part_start = start_frame
                else:
                    part_start = start_frame + (part * max_frames) - part  # 1-frame overlap
                
                part_end = min(part_start + max_frames, end_frame)
                part_frames = part_end - part_start
                
                part_job_id = f"{job_id}-part-{part+1}"
                split_job = {
                    "job_id": part_job_id,
                    "name": f"Tracking Job [Part {part+1}/{num_parts}]",
                    "start_frame": part_start,
                    "end_frame": part_end,
                    "frames": part_frames,
                    "click_prompts": click_prompts if part == 0 else "will_be_propagated",
                    "prompt_source": "manual" if part == 0 else "propagated",
                    "estimated_memory": f"{estimate_sam2_memory(part_frames, len(click_prompts)):.1f}GB",
                    "status": "pending"
                }
                split_jobs.append(split_job)
                
                # Store individual job
                tracking_jobs_db[part_job_id] = {
                    "video_id": video_id,
                    "video_path": video_info.file_path,
                    "fps": video_info.fps,
                    **split_job
                }
            
            return {
                "job_id": job_id,
                "original_request": {
                    "start_frame": start_frame,
                    "end_frame": end_frame,
                    "total_frames": total_frames
                },
                "auto_split_result": {
                    "split_required": True,
                    "estimated_memory": f"{estimated_memory:.1f}GB",
                    "t4_safe": False,
                    "created_jobs": split_jobs
                },
                "message": f"Large segment auto-split into {num_parts} T4-safe jobs"
            }
        else:
            # Single job - T4 safe
            tracking_jobs_db[job_id] = {
                "video_id": video_id,
                "video_path": video_info.file_path,
                "fps": video_info.fps,
                "job_id": job_id,
                "name": "Single Tracking Job",
                "start_frame": start_frame,
                "end_frame": end_frame,
                "frames": total_frames,
                "click_prompts": click_prompts,
                "estimated_memory": f"{estimated_memory:.1f}GB",
                "status": "pending"
            }
            
            return {
                "job_id": job_id,
                "single_job": tracking_jobs_db[job_id],
                "message": "Single T4-safe tracking job created"
            }
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Job creation failed: {str(e)}")

@app.post("/api/tracking/jobs/{job_id}/execute")
async def execute_tracking_job(job_id: str, background_tasks: BackgroundTasks):
    """Execute tracking job in background with progress monitoring"""
    
    if job_id not in tracking_jobs_db:
        raise HTTPException(status_code=404, detail="Job not found")
    
    job_data = tracking_jobs_db[job_id]
    
    if job_data['status'] != 'pending':
        raise HTTPException(status_code=400, detail=f"Job status: {job_data['status']}")
    
    # Start job in background
    background_tasks.add_task(run_sam2_tracking_async, job_id)
    
    # Update status immediately
    await update_job_status(job_id, "running", {
        "current_frame": job_data['start_frame'],
        "total_frames": job_data['frames'],
        "percentage": 0.0
    })
    
    return {
        "job_id": job_id,
        "status": "started",
        "message": "SAM2 tracking started in background",
        "monitor_url": f"/api/tracking/jobs/{job_id}/status"
    }

@app.get("/api/tracking/jobs/{job_id}/status")
async def get_job_status(job_id: str):
    """Get current job status and progress"""
    
    if job_id not in tracking_jobs_db:
        raise HTTPException(status_code=404, detail="Job not found")
    
    # Get status from Redis or fallback
    if USE_REDIS:
        status_data = redis_client.get(f"job_status:{job_id}")
        if status_data:
            status_response = json.loads(status_data)
            debug_logger.info(f"Status request for {job_id}: {status_response}")
            return status_response
    else:
        if job_id in job_status_db:
            status_response = job_status_db[job_id]
            debug_logger.info(f"Status request for {job_id}: {status_response}")
            return status_response
    
    # Fallback to job database
    job_data = tracking_jobs_db[job_id]
    fallback_response = {
        "job_id": job_id,
        "status": job_data['status'],
        "message": "No detailed status available"
    }
    debug_logger.info(f"Status fallback for {job_id}: {fallback_response}")
    return fallback_response

@app.get("/api/tracking/jobs/{job_id}/results")
async def get_job_results(job_id: str):
    """Get specific tracking job results"""
    
    if job_id not in tracking_jobs_db:
        raise HTTPException(status_code=404, detail="Job not found")
    
    job_data = tracking_jobs_db[job_id]
    
    # Get detailed status if available
    detailed_status = None
    if USE_REDIS:
        status_data = redis_client.get(f"job_status:{job_id}")
        if status_data:
            detailed_status = json.loads(status_data)
    else:
        if job_id in job_status_db:
            detailed_status = job_status_db[job_id]
    
    result = {
        "job_id": job_id,
        "video_id": job_data.get('video_id'),
        "name": job_data.get('name', 'Tracking Job'),
        "status": job_data['status'],
        "start_frame": job_data.get('start_frame'),
        "end_frame": job_data.get('end_frame'),
        "frames": job_data.get('frames'),
        "estimated_memory": job_data.get('estimated_memory')
    }
    
    # Add status-specific details
    if detailed_status:
        if job_data['status'] == 'completed':
            # Return actual per-frame tracking data from real SAM2 results
            tracking_results = detailed_status.get('tracking_results', [])
            
            result["results"] = {
                "frames": tracking_results,  # Real SAM2 tracking data per frame
                "summary": {
                    "frames_tracked": detailed_status.get('frames_tracked'),
                    "processing_time": detailed_status.get('processing_time'),
                    "final_frame": detailed_status.get('final_frame'),
                    "success": True
                }
            }
        elif job_data['status'] == 'running':
            result["progress"] = {
                "percentage": detailed_status.get('percentage', 0),
                "current_frame": detailed_status.get('current_frame'),
                "frames_completed": detailed_status.get('frames_completed'),
                "updated_at": detailed_status.get('updated_at')
            }
        elif job_data['status'] == 'failed':
            result["error"] = detailed_status.get('error', 'Unknown error')
    
    return result

@app.get("/api/tracking/results")
async def get_tracking_results():
    """Get all tracking job results with completion status"""
    
    results = []
    for job_id, job_data in tracking_jobs_db.items():
        # Get detailed status if available
        detailed_status = None
        if USE_REDIS:
            status_data = redis_client.get(f"job_status:{job_id}")
            if status_data:
                detailed_status = json.loads(status_data)
        else:
            if job_id in job_status_db:
                detailed_status = job_status_db[job_id]
        
        result = {
            "job_id": job_id,
            "video_id": job_data.get('video_id'),
            "name": job_data.get('name', 'Tracking Job'),
            "status": job_data['status'],
            "start_frame": job_data.get('start_frame'),
            "end_frame": job_data.get('end_frame'),
            "frames": job_data.get('frames'),
            "estimated_memory": job_data.get('estimated_memory')
        }
        
        # Add progress/completion details
        if detailed_status:
            if job_data['status'] == 'completed':
                result["results"] = {
                    "frames_tracked": detailed_status.get('frames_tracked'),
                    "processing_time": detailed_status.get('processing_time'),
                    "final_frame": detailed_status.get('final_frame')
                }
            elif job_data['status'] == 'running':
                result["progress"] = {
                    "percentage": detailed_status.get('percentage', 0),
                    "current_frame": detailed_status.get('current_frame'),
                    "frames_completed": detailed_status.get('frames_completed')
                }
            elif job_data['status'] == 'failed':
                result["error"] = detailed_status.get('error', 'Unknown error')
        
        results.append(result)
    
    return {
        "results": results,
        "total": len(results),
        "summary": {
            "completed": len([r for r in results if r['status'] == 'completed']),
            "running": len([r for r in results if r['status'] == 'running']),
            "pending": len([r for r in results if r['status'] == 'pending']),
            "failed": len([r for r in results if r['status'] == 'failed'])
        }
    }

# Helper functions
def estimate_sam2_memory(total_frames, num_objects=1):
    """Estimate SAM2 memory usage (from scrubber research)"""
    model_memory = 2.0
    memory_per_frame = 0.1
    memory_bank = min(total_frames, 100) * memory_per_frame
    object_memory = num_objects * memory_bank * 0.8
    total_memory = model_memory + memory_bank + object_memory
    return total_memory * 1.4  # Safety factor

async def update_job_status(job_id: str, status: str, data: Dict):
    """Update job status in Redis or fallback storage"""
    
    status_data = {
        "job_id": job_id,
        "status": status,
        "updated_at": datetime.now().isoformat(),
        **data
    }
    
    if USE_REDIS:
        redis_client.setex(f"job_status:{job_id}", 3600, json.dumps(status_data))
    else:
        job_status_db[job_id] = status_data

async def run_sam2_tracking_async(job_id: str):
    """Background SAM2 tracking with progress updates using real windsurf library"""
    
    try:
        job_data = tracking_jobs_db[job_id]
        
        print(f"\n=== ASYNC TRACKING JOB {job_id} ===")
        print(f"Frames: {job_data['start_frame']}-{job_data['end_frame']}")
        print(f"Click prompts: {job_data['click_prompts']}")
        
        # Import windsurf tracking
        from windsurf.sail_tracking import track_objects_in_video
        
        # Convert click prompts to objects_data format for multi-object tracking
        click_prompts = job_data['click_prompts']
        debug_logger.info(f"Raw click_prompts: {click_prompts}, type: {type(click_prompts)}")
        
        # Handle special case for propagated jobs
        if click_prompts == "will_be_propagated":
            raise ValueError("Multi-part job propagation not yet implemented")
        
        # Group prompts by object (for now, treat each positive as separate object)
        objects_data = []
        obj_id = 1
        
        for prompt in click_prompts:
            if prompt['type'] == 'positive':
                # Each positive click becomes a separate object
                objects_data.append({
                    "object_id": obj_id,
                    "positive_points": [(prompt['x'], prompt['y'])],
                    "negative_points": []  # TODO: Support negative prompts per object
                })
                obj_id += 1
        
        if not objects_data:
            raise ValueError("No positive click prompts provided")
        
        # Run real SAM2 tracking
        print(f"🚀 Running Facebook SAM2 tracking with {len(objects_data)} objects...")
        
        # Update status to show tracking started
        await update_job_status(job_id, "running", {
            "current_frame": job_data['start_frame'],
            "total_frames": job_data['frames'],
            "percentage": 0.0,
            "message": "Initializing SAM2 tracking..."
        })
        
        # Create progress callback for real-time updates with race condition protection
        progress_active = {"active": True}  # Shared flag to disable callbacks
        
        async def progress_callback(current_frame, percentage, phase):
            if progress_active["active"]:  # Only update if still active
                await update_job_status(job_id, "running", {
                    "current_frame": job_data['start_frame'] + current_frame,
                    "total_frames": job_data['frames'],
                    "percentage": percentage,
                    "phase": phase,
                    "frames_completed": int((percentage / 100) * job_data['frames'])
                })
        
        # Use smaller model for tracking
        start_time = time.time()
        try:
            debug_logger.info(f"Starting tracking: {len(objects_data)} objects, frames {job_data['start_frame']}-{job_data['end_frame']}")
            results, frame_masks, scaled_points = track_objects_in_video(
                video_path=job_data['video_path'],
                objects_data=objects_data,
                initial_frame=job_data['start_frame'],
                end_frame=job_data['end_frame'],
                model_size="tiny",
                progress_callback=progress_callback
            )
            debug_logger.info(f"Tracking completed successfully")
        except Exception as tracking_error:
            debug_logger.error(f"Tracking failed: {tracking_error}")
            raise
        
        processing_time = time.time() - start_time
        
        # Convert results to frontend format
        try:
            tracking_results = []
            frame_results = results.get('frame_results', {})
            
            debug_logger.info(f"frame_results keys: {list(frame_results.keys())}")
            debug_logger.info(f"frame_masks type: {type(frame_masks)}")
            debug_logger.info(f"frame_masks keys: {list(frame_masks.keys()) if isinstance(frame_masks, dict) else 'NOT A DICT'}")
            debug_logger.info(f"frame_masks length: {len(frame_masks) if frame_masks is not None else 'NONE'}")
            
            for frame_idx in range(job_data['start_frame'], job_data['end_frame']):
                if frame_idx in frame_results:
                    frame_data = frame_results[frame_idx]
                    
                    # Convert masks to base64 and extract polygons
                    frame_masks_b64 = []
                    frame_polygons = []
                    debug_logger.info(f"Frame {frame_idx}: frame_masks has key={frame_idx in frame_masks}, value type={type(frame_masks.get(frame_idx, 'MISSING'))}")
                    if frame_idx in frame_masks and frame_masks[frame_idx] is not None:
                        masks_for_frame = frame_masks[frame_idx]
                        debug_logger.info(f"Frame {frame_idx}: masks_for_frame length={len(masks_for_frame)}")
                        if isinstance(masks_for_frame, list) and len(masks_for_frame) > 0:
                            for i, mask in enumerate(masks_for_frame):
                                debug_logger.info(f"Frame {frame_idx}: processing mask {i}, type={type(mask)}")
                                if mask is not None:
                                    try:
                                        # Convert numpy mask to base64
                                        import base64
                                        from io import BytesIO
                                        from PIL import Image
                                        import cv2
                                        
                                        mask_img = Image.fromarray((mask * 255).astype(np.uint8), mode='L')
                                        img_buffer = BytesIO()
                                        mask_img.save(img_buffer, format='PNG')
                                        mask_base64 = base64.b64encode(img_buffer.getvalue()).decode()
                                        frame_masks_b64.append(mask_base64)
                                        
                                        # Extract polygon from mask
                                        mask_uint8 = (mask * 255).astype(np.uint8)
                                        contours, _ = cv2.findContours(mask_uint8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                                        
                                        # Get largest contour (main object outline)
                                        if contours and len(contours) > 0:
                                            largest_contour = max(contours, key=cv2.contourArea)
                                            # Flatten contour to list of [x,y,x,y,...] points
                                            polygon = largest_contour.reshape(-1, 2).flatten().tolist()
                                            frame_polygons.append(polygon)
                                        else:
                                            frame_polygons.append([])
                                    except Exception as e:
                                        debug_logger.error(f"Mask processing failed for frame {frame_idx}: {e}")
                                        frame_masks_b64.append("")
                                        frame_polygons.append([])
                
                    tracking_results.append({
                        "frame": frame_idx,
                        "bboxes": frame_data.get('bboxes', []),
                        "centers": frame_data.get('centers', []),
                        "object_ids": frame_data.get('object_ids', []),
                        "masks_base64": frame_masks_b64,
                        "polygons": frame_polygons,  # Add polygon contours
                        "success": len(frame_data.get('bboxes', [])) > 0
                    })
                else:
                    # No tracking data for this frame
                    tracking_results.append({
                        "frame": frame_idx,
                        "bboxes": [],
                        "centers": [],
                        "object_ids": [],
                        "masks_base64": [],
                        "polygons": [],
                        "success": False
                    })
            
            debug_logger.info(f"Results processing completed for job {job_id}")
            debug_logger.info(f"tracking_results length: {len(tracking_results)}")
            
            # Stop progress callbacks to prevent race condition
            progress_active["active"] = False
            debug_logger.info(f"Progress callbacks disabled for job {job_id}")
            
            # Small delay to ensure any pending callbacks complete
            await asyncio.sleep(0.1)
        
            # Job complete with real tracking results
            debug_logger.info(f"Updating job {job_id} to completed status with 100% progress")
            completion_data = {
                "frames_tracked": len(tracking_results),
                "processing_time": processing_time,
                "final_frame": job_data['end_frame'],
                "tracking_results": tracking_results,  # Real per-frame data
                "objects_detected": len(objects_data),
                "model": results.get('model', 'facebook/sam2-base_plus'),
                "percentage": 100.0,  # Mark as 100% complete
                "phase": "completed",
                "current_frame": job_data['end_frame']
            }
            debug_logger.info(f"Completion data: {completion_data}")
            await update_job_status(job_id, "completed", completion_data)
            debug_logger.info(f"Job {job_id} status update to completed - SUCCESS")
            
            # Update job database
            tracking_jobs_db[job_id]['status'] = 'completed'
            
            print(f"Job {job_id} completed successfully - {len(tracking_results)} frames tracked")
            
        except Exception as results_error:
            debug_logger.error(f"Results processing failed: {results_error}")
            debug_logger.error(f"results type: {type(results)}")
            debug_logger.error(f"frame_masks type: {type(frame_masks)}")
            raise Exception(f"Results processing failed: {results_error}")
        
    except Exception as e:
        await update_job_status(job_id, "failed", {
            "error": str(e)
        })
        tracking_jobs_db[job_id]['status'] = 'failed'
        print(f"Job {job_id} failed: {e}")

# Helper function for image extraction - thin wrapper over windsurf library
async def extract_image_from_request(request: Dict):
    """Extract PIL Image from request using windsurf library"""
    
    if 'image_base64' in request:
        # Decode base64 image
        import base64
        from io import BytesIO
        from PIL import Image
        
        image_data = base64.b64decode(request['image_base64'])
        return Image.open(BytesIO(image_data))
        
    elif 'video_id' in request and 'frame_number' in request:
        # Use windsurf library for frame extraction
        video_id = request['video_id']
        frame_number = request['frame_number']
        
        if video_id not in videos_db:
            raise HTTPException(status_code=404, detail="Video not found")
        
        video_info = videos_db[video_id]
        
        # Delegate to windsurf library
        return extract_frame(video_info.file_path, frame_number)
    else:
        raise HTTPException(status_code=400, detail="Must provide either image_base64 or video_id+frame_number")

async def restore_video_database():
    """Restore video database from upload directory on startup"""
    
    try:
        print("🔄 Restoring video database from uploads...")
        
        upload_dir = Path(__file__).parent / "uploads"
        video_files = list(upload_dir.glob("*.mp4"))
        
        restored_count = 0
        for video_file in video_files:
            try:
                # Extract video_id from filename (UUID)
                video_id = video_file.stem
                
                # Get video metadata using windsurf library
                metadata = extract_video_metadata(str(video_file))
                
                # Create VideoInfo object
                video_info = VideoInfo(
                    id=video_id,
                    filename=f"{video_id}.mp4",  # Store as UUID filename
                    file_path=str(video_file),
                    duration=metadata['duration'],
                    fps=metadata['fps'],
                    width=metadata['width'],
                    height=metadata['height'],
                    total_frames=metadata['total_frames'],
                    upload_date=datetime.fromtimestamp(video_file.stat().st_mtime),
                    status="ready"
                )
                
                videos_db[video_id] = video_info
                restored_count += 1
                
            except Exception as e:
                print(f"⚠️ Failed to restore {video_file.name}: {e}")
                continue
        
        print(f"✅ Restored {restored_count} videos from uploads directory")
        
    except Exception as e:
        print(f"⚠️ Video database restoration failed: {e}")

@app.on_event("startup")
async def startup_event():
    """Print available routes and preload models on startup"""
    
    print("\n" + "="*60)
    print("🚀 WINDSURF DATASET API STARTED")
    print("="*60)
    
    # Restore video database from upload directory
    await restore_video_database()
    
    # Preload AI models for low latency
    try:
        print("🤖 Preloading AI models...")
        preload_all_models()
        print("✅ AI models ready")
    except Exception as e:
        print(f"⚠️ Model preloading failed: {e}")
        print("Models will load on first use")
    print("📖 Documentation:")
    print("   Swagger UI: http://localhost:8000/docs")
    print("   ReDoc:      http://localhost:8000/redoc")
    print("\n📡 Available Routes:")
    
    # Print all routes organized by category
    video_routes = []
    scene_routes = []
    other_routes = []
    
    for route in app.routes:
        if hasattr(route, 'methods') and hasattr(route, 'path'):
            methods = ', '.join(route.methods)
            path = route.path
            
            if '/videos' in path and '/scenes' not in path:
                video_routes.append(f"   {methods:<8} {path}")
            elif '/scenes' in path:
                scene_routes.append(f"   {methods:<8} {path}")
            else:
                other_routes.append(f"   {methods:<8} {path}")
    
    if other_routes:
        print("\n🏠 General:")
        for route in sorted(other_routes):
            print(route)
    
    if video_routes:
        print("\n📹 Video Management:")
        for route in sorted(video_routes):
            print(route)
    
    if scene_routes:
        print("\n🎬 Scene Detection:")
        for route in sorted(scene_routes):
            print(route)
    
    print("\n" + "="*60)
    print("✅ API Ready for requests")
    print("="*60 + "\n")

if __name__ == "__main__":
    print("🔧 Initializing Windsurf Dataset API...")
    
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=False,  # Disable auto-reload for stability
        log_level="info"
    )