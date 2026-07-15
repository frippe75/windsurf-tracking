"""
AI model endpoints for detection, segmentation, and classification
"""

from fastapi import APIRouter, HTTPException, Depends
from typing import Dict
import asyncio

from ..auth import get_current_active_user
from ..database import DBUser

router = APIRouter(prefix="/api/ai", tags=["ai"])

@router.get("/status")
async def ai_models_status():
    """AI model status and GPU memory information"""
    
    try:
        from windsurf.ai_models import model_manager
        import torch
        
        status = {
            "models_loaded": list(model_manager.models.keys()),
            "device": str(model_manager.device),
            "gpu_available": torch.cuda.is_available()
        }
        
        if torch.cuda.is_available():
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
    except ImportError:
        # Fallback when AI models not available
        return {
            "models_loaded": [],
            "device": "unavailable",
            "gpu_available": False,
            "message": "AI models handled by workers"
        }

@router.post("/dino/detect")
async def dino_detect(request: Dict):
    """DINO object detection - routes to Celery workers"""
    
    try:
        from celery import Celery
        
        # Connect to Celery using environment variable
        import os
        redis_url = os.getenv('REDIS_URL', 'redis://localhost:6379')
        
        celery_app = Celery('windsurf_workers')
        celery_app.conf.broker_url = f'{redis_url}/1'
        celery_app.conf.result_backend = f'{redis_url}/2'
        
        # Submit to GPU worker
        task = celery_app.send_task(
            'workers.tasks.dino.detect_objects_task',
            args=[request],
            queue='gpu_0_worker'
        )
        
        # Wait for result
        result = task.get(timeout=30)
        return result
        
    except Exception as e:
        return {
            "success": False,
            "model": "GroundingDINO-Celery",
            "error": str(e)
        }

@router.post("/sam2/segment")
async def sam2_segment(
    request: Dict,
    current_user: DBUser = Depends(get_current_active_user)
):
    """SAM2 segmentation - routes to Celery workers"""
    
    try:
        from celery import Celery
        from io import BytesIO
        import base64
        
        # Connect to Celery using environment variable
        import os
        redis_url = os.getenv('REDIS_URL', 'redis://localhost:6379')
        
        celery_app = Celery('windsurf_workers')
        celery_app.conf.broker_url = f'{redis_url}/1'
        celery_app.conf.result_backend = f'{redis_url}/2'
        
        # Extract frame for SAM2 processing
        video_id = request.get('video_id')
        frame_number = request.get('frame_number')
        
        if not video_id or frame_number is None:
            raise HTTPException(status_code=400, detail="video_id and frame_number required")
        
        # Get video info from the injected videos_db
        from ..main import videos_db
        if video_id not in videos_db:
            raise HTTPException(status_code=404, detail="Video not found")
        
        video_info = videos_db[video_id]

        from .. import storage
        local_path = storage.ensure_local(video_id)
        video_path = str(local_path) if local_path else video_info.file_path

        # Extract frame (cv2 with ffmpeg fallback for AV1 etc.) → base64
        import base64
        from io import BytesIO
        from ..frames import extract_frame_image

        try:
            pil_image = extract_frame_image(video_path, frame_number)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        
        # Convert to base64
        buffer = BytesIO()
        pil_image.save(buffer, format='PNG')
        frame_base64 = base64.b64encode(buffer.getvalue()).decode('utf-8')
        
        # Extract SAM2 parameters
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
        
        # Submit to Celery worker
        task_data = {
            'frame_base64': frame_base64,
            'positive_prompts': positive_prompts,
            'negative_prompts': negative_prompts,
            'video_id': video_id,
            'frame_number': frame_number
        }
        
        # Send to GPU 0 worker
        task = celery_app.send_task(
            'workers.tasks.sam2.segment_frame_task',
            args=[task_data],
            queue='gpu_0_worker'
        )
        
        # Wait for result
        result = task.get(timeout=30)
        
        if result['success']:
            worker_result = result['result']
            return {
                "success": True,
                "model": "SAM2-Hiera-Tiny-Celery",
                "parameters": {
                    "positive_prompts": positive_prompts,
                    "negative_prompts": negative_prompts
                },
                "results": {
                    "bbox": worker_result.get('bbox'),
                    "center": worker_result.get('center'),
                    "score": worker_result.get('score'),
                    "mask_base64": worker_result.get('mask_base64'),
                    "mask_pixels": worker_result.get('mask_pixels', 0)
                }
            }
        else:
            return {
                "success": False,
                "model": "SAM2-Hiera-Tiny-Celery",
                "error": result.get('error', 'Unknown error')
            }
        
    except Exception as e:
        return {
            "success": False,
            "model": "SAM2-Hiera-Tiny-Celery",
            "error": str(e)
        }

@router.post("/classify")
async def classify_object(request: Dict):
    """Object classification using AI models"""
    
    try:
        from celery import Celery
        
        # Connect to Celery using environment variable
        import os
        redis_url = os.getenv('REDIS_URL', 'redis://localhost:6379')
        
        celery_app = Celery('windsurf_workers')
        celery_app.conf.broker_url = f'{redis_url}/1'
        celery_app.conf.result_backend = f'{redis_url}/2'
        
        # Submit to GPU worker
        task = celery_app.send_task(
            'workers.tasks.classification.classify_crop_task',
            args=[request],
            queue='gpu_0_worker'
        )
        
        # Wait for result
        result = task.get(timeout=30)
        return result
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }