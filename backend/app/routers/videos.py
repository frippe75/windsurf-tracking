"""
Video management endpoints
"""

from fastapi import APIRouter, HTTPException, UploadFile, File, Depends
from fastapi.responses import StreamingResponse
from pathlib import Path
from typing import Optional
import asyncio

from ..api_models import YouTubeDownloadRequest
from ..auth import get_current_active_user
from ..database import DBUser
from .. import storage

router = APIRouter(prefix="/api/videos", tags=["videos"])

# These will be injected from main
videos_db = {}
download_jobs_db = {}

@router.post("/upload")
async def upload_video(
    file: UploadFile = File(...),
    current_user: DBUser = Depends(get_current_active_user)
):
    """Upload video file and extract metadata"""
    
    try:
        from windsurf.video_manager import save_uploaded_video
        from datetime import datetime
        
        # Read file content
        content = await file.read()
        
        # Use windsurf library for all logic
        video_data = save_uploaded_video(file.filename, content)
        
        # Store in database
        from ..api_models import VideoInfo
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

        # Canonical copy to S3 (local file stays as processing cache)
        if storage.enabled():
            storage.upload_video(video_data['video_id'], video_data['file_path'], {
                "filename": video_data['filename'],
                "duration": video_data['duration'],
                "fps": video_data['fps'],
                "width": video_data['width'],
                "height": video_data['height'],
                "total_frames": video_data['total_frames'],
                "upload_date": video_info.upload_date.isoformat(),
            })

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

@router.get("")
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

@router.get("/exists")
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

@router.get("/{video_id}")
async def get_video_info(video_id: str):
    """Get detailed video information"""
    
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

@router.get("/{video_id}/frame/{frame_number}")
async def get_frame(video_id: str, frame_number: int, width: Optional[int] = None, height: Optional[int] = None):
    """Extract specific frame as image"""
    
    if video_id not in videos_db:
        raise HTTPException(status_code=404, detail="Video not found")
    
    video_info = videos_db[video_id]
    
    local_path = storage.ensure_local(video_id) or Path(video_info.file_path)

    try:
        import cv2
        import io
        from PIL import Image

        # Extract frame using OpenCV directly
        cap = cv2.VideoCapture(str(local_path))
        if not cap.isOpened():
            raise HTTPException(status_code=500, detail="Could not open video file")
        
        # Set frame position
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
        
        ret, frame = cap.read()
        cap.release()
        
        if not ret:
            raise HTTPException(status_code=400, detail=f"Could not extract frame {frame_number}")
        
        # Convert BGR to RGB
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        
        # Convert to PIL Image
        pil_image = Image.fromarray(frame_rgb)
        
        # Resize if requested
        if width and height:
            pil_image = pil_image.resize((width, height), Image.Resampling.LANCZOS)
        
        # Convert to PNG bytes
        png_buffer = io.BytesIO()
        pil_image.save(png_buffer, format='PNG')
        png_buffer.seek(0)
        
        return StreamingResponse(
            png_buffer,
            media_type="image/png",
            headers={"Cache-Control": "max-age=3600"}
        )
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Frame extraction failed: {str(e)}")

@router.get("/{video_id}/stream-url")
async def get_stream_url(video_id: str):
    """Presigned S3 URL for direct, seekable browser playback (RGW honors Range)"""

    if video_id not in videos_db:
        raise HTTPException(status_code=404, detail="Video not found")

    if not storage.enabled():
        # Legacy fallback: frontend should use /download
        return {"url": f"/api/videos/{video_id}/download", "presigned": False}

    video_info = videos_db[video_id]
    return {
        "url": storage.presigned_url(video_id, video_info.filename),
        "presigned": True,
        "expires_in": storage.PRESIGN_EXPIRY
    }

@router.get("/{video_id}/download")
async def download_video_file(video_id: str):
    """Download complete video file for frontend caching"""

    if video_id not in videos_db:
        raise HTTPException(status_code=404, detail="Video not found")

    video_info = videos_db[video_id]
    video_path = storage.ensure_local(video_id) or Path(video_info.file_path)

    if not video_path.exists():
        raise HTTPException(status_code=404, detail="Video file not found on disk")
    
    # Stream video file
    def video_stream():
        with open(video_path, 'rb') as video_file:
            while True:
                chunk = video_file.read(8192)
                if not chunk:
                    break
                yield chunk
    
    file_size = video_path.stat().st_size
    
    return StreamingResponse(
        video_stream(),
        media_type="video/mp4",
        headers={
            "Content-Length": str(file_size),
            "Content-Disposition": f'attachment; filename="{video_info.filename}"',
            "Cache-Control": "public, max-age=3600",
            "Accept-Ranges": "bytes"
        }
    )

@router.delete("/{video_id}")
async def delete_video(video_id: str):
    """Delete video and cleanup files"""
    
    if video_id not in videos_db:
        raise HTTPException(status_code=404, detail="Video not found")
    
    video_info = videos_db[video_id]
    
    try:
        from windsurf.video_manager import video_manager

        # Use windsurf library for cleanup
        video_manager.delete_video(video_info.file_path)

        # Remove canonical S3 copy
        storage.delete_video(video_id)

        # Remove from database
        del videos_db[video_id]
        
        return {"message": f"Video {video_id} deleted successfully"}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/download-youtube")
async def start_youtube_download(request: YouTubeDownloadRequest):
    """Start YouTube download via Celery CPU workers"""
    
    try:
        from celery import Celery
        import re
        import uuid
        from datetime import datetime
        
        # Validate YouTube URL
        youtube_regex = r'(?:https?://)?(?:www\.)?(?:youtube\.com/watch\?v=|youtu\.be/)([a-zA-Z0-9_-]{11})'
        if not re.match(youtube_regex, request.url):
            raise HTTPException(status_code=400, detail="Invalid YouTube URL")
        
        # Connect to Celery using environment variable
        import os
        redis_url = os.getenv('REDIS_URL', 'redis://localhost:6379')
        
        celery_app = Celery('windsurf_workers')
        celery_app.conf.broker_url = f'{redis_url}/1'
        celery_app.conf.result_backend = f'{redis_url}/2'
        
        # Generate download job ID
        job_id = f"dl-{str(uuid.uuid4())}"
        
        # Submit to CPU worker
        task = celery_app.send_task(
            'workers.tasks.downloads.download_youtube_task',
            args=[{"url": request.url, "quality": request.quality, "format": request.format}],
            queue='cpu_worker'
        )
        
        # Store job info
        download_jobs_db[job_id] = {
            "job_id": job_id,
            "url": request.url,
            "status": "queued",
            "task_id": task.id,
            "created_at": datetime.now().isoformat()
        }
        
        return {
            "job_id": job_id,
            "status": "queued", 
            "message": "YouTube download queued for CPU worker"
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/download-youtube/{job_id}/status")
async def get_download_status(job_id: str):
    """Get YouTube download status"""
    
    if job_id not in download_jobs_db:
        raise HTTPException(status_code=404, detail="Download job not found")
    
    return download_jobs_db[job_id]

@router.post("/{video_id}/scenes/detect")
async def detect_scenes_api(video_id: str):
    """Run scene detection via CPU workers"""
    
    if video_id not in videos_db:
        raise HTTPException(status_code=404, detail="Video not found")
    
    video_info = videos_db[video_id]
    
    try:
        from celery import Celery
        
        # Connect to Celery using environment variable
        import os
        redis_url = os.getenv('REDIS_URL', 'redis://localhost:6379')
        
        celery_app = Celery('windsurf_workers')
        celery_app.conf.broker_url = f'{redis_url}/1'
        celery_app.conf.result_backend = f'{redis_url}/2'
        
        # Submit to CPU worker
        task = celery_app.send_task(
            'workers.tasks.video.detect_scenes_task',
            args=[{"video_path": video_info.file_path}],
            queue='cpu_worker'
        )
        
        # Wait for result
        result = task.get(timeout=120)
        
        if result['success']:
            return {
                "video_id": video_id,
                **result['scenes_data']
            }
        else:
            raise HTTPException(status_code=500, detail=result['error'])
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))