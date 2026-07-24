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


def _probe_fps(video_path: str) -> float:
    """Read fps from the video file (cv2, ffprobe fallback). Defaults to 30 if unknown."""
    try:
        import cv2

        cap = cv2.VideoCapture(video_path)
        fps = cap.get(cv2.CAP_PROP_FPS)
        cap.release()
        if fps and fps > 0:
            return float(fps)
    except Exception:
        pass
    try:
        import subprocess

        out = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
             "stream=r_frame_rate", "-of", "default=nk=1:nw=1", video_path],
            capture_output=True, text=True, timeout=30,
        ).stdout.strip()
        if "/" in out:
            num, den = out.split("/")
            if float(den):
                return float(num) / float(den)
    except Exception:
        pass
    return 30.0


@celery_app.task(bind=True, name="windsurf.export_dataset")
def export_dataset_task(self, project_id: str, sink_name=None, val_fraction: float = 0.2, clearml_project=None):
    """Build a YOLO dataset for a project and publish it via a sink — runs on the cpu-worker so
    the heavy frame extraction + zip never touches the web pod. Returns {sink, stats, result}."""
    import re
    import shutil
    import tempfile
    from pathlib import Path

    from . import storage
    from .database import DBAnnotation, DBAnnotationClass, DBProject, SessionLocal
    from .export import generator, sinks

    db = SessionLocal()
    try:
        project = db.query(DBProject).filter(DBProject.id == project_id).first()
        if not project:
            raise RuntimeError("project not found")
        sink = sinks.get_sink(sink_name)
        if sink is None:
            raise RuntimeError(f"sink {sink_name!r} unavailable ({list(sinks.available_sinks())})")

        video_id = str(project.video_id)
        self.update_state(state="PROGRESS", meta={"current_step": "fetching video", "progress": 5})
        local = storage.ensure_local(video_id)
        if not local:
            raise RuntimeError("video file unavailable for frame export")
        fps = _probe_fps(str(local))

        classes = (db.query(DBAnnotationClass)
                   .filter(DBAnnotationClass.project_id == project_id)
                   .order_by(DBAnnotationClass.created_at).all())
        annotations = db.query(DBAnnotation).filter(DBAnnotation.project_id == project_id).all()
        if not annotations:
            raise RuntimeError("project has no annotations to export")

        tmp = Path(tempfile.mkdtemp(prefix="yolo-export-"))
        try:
            self.update_state(state="PROGRESS", meta={"current_step": "extracting frames", "progress": 15})

            # Per-image progress (extraction spans 15→80%); throttle to integer-% changes so we
            # don't hammer the Celery/Redis result backend on every frame.
            last = {"pct": -1}

            def on_frame(done, total):
                pct = 15 + int(done / max(1, total) * 65)
                if pct != last["pct"] or done == total:
                    last["pct"] = pct
                    self.update_state(state="PROGRESS", meta={
                        "current_step": "extracting frames", "progress": pct,
                        "images_done": done, "images_total": total,
                    })

            # Frames go through the content-addressed store: extracted+persisted once, reused by
            # every later export/version (no ffmpeg re-decode on repeat runs). See DATASET_ARCHITECTURE.md.
            from .datasets.frames.extractor import default_extractor
            from .datasets.frames.store import S3FrameStore

            _store = S3FrameStore()
            _extractor = default_extractor()

            def frame_provider(frame_number):
                return _store.get_or_materialize(
                    video_id, frame_number, source_path=str(local), fps=fps, extractor=_extractor,
                )

            stats = generator.build_yolo_dataset(
                tmp, frame_provider, video_id[:8], annotations, classes, val_fraction,
                progress_cb=on_frame,
            )
            if stats.images == 0:
                raise RuntimeError("no exportable boxes (need class_id + bbox on annotations)")
            self.update_state(state="PROGRESS", meta={"current_step": "packaging", "progress": 85})
            safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", f"{project.name}-{project_id[:8]}")
            result = sink.publish(tmp, {"project_id": project_id, "name": safe, "clearml_project": clearml_project})
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

        return {
            "sink": sink.name,
            "stats": {
                "images": stats.images, "labels": stats.labels, "boxes": stats.boxes,
                "skipped": stats.skipped, "classes": stats.classes, "splits": stats.splits,
            },
            "result": result,
        }
    finally:
        db.close()
