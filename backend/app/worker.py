"""
Celery worker tasks (queue: cpu_worker).

Runs in the windsurf-prod-cpu-worker deployment using the SAME annotation-api
image as the backend, so tasks share the storage layer (S3) and the windsurf
package. Videos land in S3 (canonical); the backend registers them in its
in-memory videos_db when it observes task completion via the status endpoint.

Start: celery -A app.worker worker --queues=cpu_worker
"""

import os
from celery import Celery

redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")

celery_app = Celery(
    "windsurf_workers",
    broker=f"{redis_url}/1",
    backend=f"{redis_url}/2",
)
celery_app.conf.task_track_started = True


@celery_app.task(bind=True, name="windsurf.download_youtube")
def download_youtube_task(self, url: str, quality: str = "720p"):
    """Download a YouTube video, register metadata, upload to S3.
    Returns the video_data dict from save_uploaded_video."""
    import tempfile
    import shutil
    from pathlib import Path
    import yt_dlp

    tmpdir = tempfile.mkdtemp(prefix="ytdl-")

    def hook(d):
        if d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            if total:
                self.update_state(state="PROGRESS", meta={
                    "current_step": "downloading",
                    "progress": round(d.get("downloaded_bytes", 0) / total * 100, 1),
                })

    try:
        height = {"480p": 480, "720p": 720, "1080p": 1080}.get(quality or "720p", 720)
        opts = {
            # Prefer H.264 (avc1): OpenCV can't decode AV1, which YouTube now
            # serves widely. Fall back to any mp4, then anything.
            "format": (
                f"bv*[height<={height}][vcodec^=avc1]+ba[ext=m4a]/"
                f"b[height<={height}][vcodec^=avc1]/"
                f"bv*[height<={height}][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b"
            ),
            "merge_output_format": "mp4",
            "outtmpl": f"{tmpdir}/%(title).100B.%(ext)s",
            "restrictfilenames": True,  # S3 metadata rejects non-ASCII
            "noplaylist": True,
            "quiet": True,
            "progress_hooks": [hook],
        }
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.extract_info(url, download=True)

        files = list(Path(tmpdir).glob("*.mp4"))
        if not files:
            raise RuntimeError("yt-dlp produced no mp4 output")

        self.update_state(state="PROGRESS", meta={"current_step": "syncing", "progress": 100})

        # Extract metadata + write to local cache dir, then canonical S3 copy
        from windsurf.video_manager import save_uploaded_video
        from . import storage

        video_data = save_uploaded_video(files[0].name, files[0].read_bytes())
        if storage.enabled():
            from datetime import datetime
            storage.upload_video(video_data["video_id"], video_data["file_path"], {
                "filename": video_data["filename"],
                "duration": video_data["duration"],
                "fps": video_data["fps"],
                "width": video_data["width"],
                "height": video_data["height"],
                "total_frames": video_data["total_frames"],
                "upload_date": datetime.now().isoformat(),
            })
        return video_data
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


@celery_app.task(name="windsurf.detect_scenes")
def detect_scenes_task(video_id: str):
    """Scene detection (ffmpeg-based). Fetches the video from S3 if needed."""
    from . import storage
    from windsurf.scene_detection import detect_scenes

    local = storage.ensure_local(video_id)
    if not local:
        raise RuntimeError(f"Video {video_id} not available locally or in S3")
    return detect_scenes(str(local))
