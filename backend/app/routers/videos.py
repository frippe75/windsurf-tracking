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

def _register_video(video_data: dict):
    """Register extracted video metadata in videos_db and upload to S3.
    Shared by the upload route and the YouTube download job."""
    from datetime import datetime
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
    return video_info

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

        _register_video(video_data)

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

def _celery():
    """Celery client for dispatching to the cpu-worker (queue: cpu_worker)."""
    import os
    from celery import Celery
    redis_url = os.getenv('REDIS_URL', 'redis://localhost:6379')
    app = Celery('windsurf_workers')
    app.conf.broker_url = f'{redis_url}/1'
    app.conf.result_backend = f'{redis_url}/2'
    return app


@router.post("/download-youtube")
async def start_youtube_download(request: YouTubeDownloadRequest):
    """Dispatch a YouTube download to the cpu-worker (poll /download-youtube/{job_id}/status)"""

    import re
    import uuid
    from datetime import datetime

    youtube_regex = r'(?:https?://)?(?:www\.)?(?:youtube\.com/watch\?v=|youtu\.be/)([a-zA-Z0-9_-]{11})'
    if not re.match(youtube_regex, request.url):
        raise HTTPException(status_code=400, detail="Invalid YouTube URL")

    task = _celery().send_task(
        'windsurf.download_youtube',
        args=[request.url, request.quality],
        queue='cpu_worker'
    )

    job_id = f"dl-{str(uuid.uuid4())}"
    download_jobs_db[job_id] = {
        "job_id": job_id,
        "url": request.url,
        "status": "queued",
        "progress": 0,
        "task_id": task.id,
        "created_at": datetime.now().isoformat(),
    }
    return {
        "job_id": job_id,
        "status": "queued",
        "message": "YouTube download queued for cpu-worker"
    }

@router.get("/download-youtube/{job_id}/status")
async def get_download_status(job_id: str):
    """Get YouTube download status (live Celery task state merged into the job record)"""

    if job_id not in download_jobs_db:
        raise HTTPException(status_code=404, detail="Download job not found")

    job = download_jobs_db[job_id]
    task_id = job.get("task_id")
    if task_id and job.get("status") not in ("completed", "failed"):
        res = _celery().AsyncResult(task_id)
        if res.state == "PROGRESS" and isinstance(res.info, dict):
            job.update(status="downloading", **res.info)
        elif res.state == "SUCCESS":
            video_data = res.result
            # Register once (worker already uploaded to S3)
            if video_data["video_id"] not in videos_db:
                _register_video(video_data)
            job.update(
                status="completed",
                current_step="syncing",
                progress=100,
                video_id=video_data["video_id"],
                filename=video_data["filename"],
            )
        elif res.state == "FAILURE":
            job.update(status="failed", error=str(res.info)[:300])
        elif res.state == "STARTED":
            job.update(status="downloading", current_step="downloading")

    return job

@router.post("/{video_id}/scenes/detect")
async def detect_scenes_api(video_id: str):
    """Run scene detection via CPU workers"""
    
    if video_id not in videos_db:
        raise HTTPException(status_code=404, detail="Video not found")
    
    video_info = videos_db[video_id]
    
    try:
        # Dispatch to cpu-worker; ffmpeg-based scan of the full video
        task = _celery().send_task('windsurf.detect_scenes', args=[video_id], queue='cpu_worker')
        result = await asyncio.to_thread(task.get, 120)

        # Map segment output to the frontend's SceneDetectionResponse shape
        scenes = [
            {
                "scene_id": i + 1,
                "start_frame": seg["start_frame"],
                "end_frame": seg["end_frame"],
                "start_time": seg["start_time"],
                "end_time": seg["end_time"],
                "duration": seg["duration"],
                "quality": "unknown",
            }
            for i, seg in enumerate(result.get("segments", []))
        ]
        return {
            "video_id": video_id,
            "total_scenes": len(scenes),
            "detection_method": "ffmpeg overlapping segments (cpu-worker)",
            "threshold": 0,
            "scenes": scenes,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))