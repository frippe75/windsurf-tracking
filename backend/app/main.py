"""
FastAPI Backend for Windsurf Dataset Web UI
Clean, modular architecture following FastAPI best practices
"""

import os
import sys
import logging
from pathlib import Path
from typing import Dict
from datetime import datetime

# Setup debug logging
debug_logger = logging.getLogger("windsurf_debug")
debug_logger.setLevel(logging.DEBUG)
debug_handler = logging.FileHandler("/tmp/windsurf_debug.log")
debug_handler.setFormatter(logging.Formatter('%(asctime)s - %(levelname)s - %(message)s'))
debug_logger.addHandler(debug_handler)

# Add windsurf package to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

# FastAPI imports
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

# App imports
from .database import get_db, SessionLocal
from .api_models import VideoInfo

# Router imports
from .routers import auth, projects, videos, ai, tracking, export

# Global storage (TODO: migrate to proper dependency injection)
videos_db: Dict[str, VideoInfo] = {}
download_jobs_db = {}

# Version reflects the deployed build: CI injects APP_VERSION=<commit sha>
# (backend/Dockerfile ARG). Falls back to "dev" for local runs.
APP_VERSION = os.getenv("APP_VERSION", "dev")

# Create FastAPI app
app = FastAPI(
    title="Windsurf Dataset API",
    description="Clean, modular API for windsurf video annotation",
    version=APP_VERSION
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://labelbee.tclab.org",
        "http://localhost:3000",
        "http://localhost:5173",
        "*" if os.getenv("ENV") == "development" else ""
    ],
    allow_origin_regex=r"https://.*\.lovable\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Inject dependencies into router modules
projects.videos_db = videos_db
videos.videos_db = videos_db
videos.download_jobs_db = download_jobs_db
# tracking jobs now live in the `jobs` table (routers.tracking uses the DB session)
export.videos_db = videos_db

# Register routers
app.include_router(auth.router)
app.include_router(projects.router)
app.include_router(videos.router)
app.include_router(ai.router)
app.include_router(tracking.router)
app.include_router(export.router)

@app.get("/")
async def root():
    """API health check"""
    return {
        "message": "Windsurf Dataset API",
        "version": APP_VERSION,
        "status": "healthy",
        "architecture": "modular"
    }

@app.on_event("startup")
async def startup_event():
    """Initialize application on startup"""
    
    print("\n" + "="*60)
    print("🚀 WINDSURF DATASET API v2.0 - MODULAR")
    print("="*60)
    
    # Restore video database from uploads
    await restore_video_database()
    
    print("📖 Documentation:")
    print("   Swagger UI: http://localhost:8000/docs")
    print("   ReDoc:      http://localhost:8000/redoc")
    print("\n📡 Available Routes:")
    
    # Print all routes organized by category
    video_routes = []
    project_routes = []
    ai_routes = []
    tracking_routes = []
    other_routes = []
    
    for route in app.routes:
        if hasattr(route, 'methods') and hasattr(route, 'path'):
            methods = ', '.join(route.methods)
            path = route.path
            
            if '/videos' in path:
                video_routes.append(f"   {methods:<8} {path}")
            elif '/projects' in path:
                project_routes.append(f"   {methods:<8} {path}")
            elif '/ai' in path:
                ai_routes.append(f"   {methods:<8} {path}")
            elif '/tracking' in path:
                tracking_routes.append(f"   {methods:<8} {path}")
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
    
    if project_routes:
        print("\n📁 Project Management:")
        for route in sorted(project_routes):
            print(route)
    
    if ai_routes:
        print("\n🤖 AI Models:")
        for route in sorted(ai_routes):
            print(route)
    
    if tracking_routes:
        print("\n🎯 Object Tracking:")
        for route in sorted(tracking_routes):
            print(route)
    
    print("\n" + "="*60)
    print("✅ Clean API Ready")
    print("="*60 + "\n")

async def restore_video_database():
    """Restore video database from S3 (canonical) or the local uploads dir"""

    from . import storage

    if storage.enabled():
        try:
            print("🔄 Restoring video database from S3...")
            from .routers.videos import video_info_from_s3_meta
            restored = 0
            for item in storage.list_videos():
                try:
                    videos_db[item["video_id"]] = video_info_from_s3_meta(
                        item["video_id"], item["metadata"], item["last_modified"])
                    restored += 1
                except Exception as e:
                    print(f"⚠️ Skipping {item['video_id']}: {e}")
            print(f"✅ Restored {restored} videos from S3")
            return
        except Exception as e:
            print(f"⚠️ S3 restore failed ({e}); falling back to local scan")

    try:
        import cv2

        print("🔄 Restoring video database from uploads...")
        
        upload_dir = Path(__file__).parent.parent / "uploads"
        video_files = list(upload_dir.glob("*.mp4")) + list(upload_dir.glob("*.webm"))
        
        restored_count = 0
        for video_file in video_files:
            try:
                video_id = video_file.stem
                
                # Extract metadata using OpenCV directly
                cap = cv2.VideoCapture(str(video_file))
                if not cap.isOpened():
                    print(f"⚠️ Could not open {video_file.name}")
                    continue
                
                fps = cap.get(cv2.CAP_PROP_FPS)
                frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
                width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
                height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
                duration = frame_count / fps if fps > 0 else 0
                
                cap.release()
                
                video_info = VideoInfo(
                    id=video_id,
                    filename=video_file.name,
                    file_path=str(video_file),
                    duration=duration,
                    fps=fps,
                    width=width,
                    height=height,
                    total_frames=frame_count,
                    upload_date=datetime.fromtimestamp(video_file.stat().st_mtime),
                    status="ready"
                )
                
                videos_db[video_id] = video_info
                restored_count += 1
                
            except Exception as e:
                print(f"⚠️ Failed to restore {video_file.name}: {e}")
                continue
        
        print(f"✅ Restored {restored_count} videos")
        
    except Exception as e:
        print(f"⚠️ Video restoration failed: {e}")

if __name__ == "__main__":
    print("🔧 Initializing Clean Windsurf API...")
    
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=False,
        log_level="info"
    )