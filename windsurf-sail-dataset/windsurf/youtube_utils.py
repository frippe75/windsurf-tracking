"""
YouTube video handling with caching
"""

import os
import subprocess
import tempfile
from pathlib import Path
from PIL import Image
from typing import List

def extract_video_id(youtube_url: str) -> str:
    """Extract video ID from YouTube URL."""
    if 'youtube.com/watch' in youtube_url:
        return youtube_url.split('v=')[1].split('&')[0]
    elif 'youtu.be/' in youtube_url:
        return youtube_url.split('youtu.be/')[1].split('?')[0]
    return "unknown"

def get_cache_path(youtube_url: str, start_time: str, duration: int) -> str:
    """Generate cache path for video clip."""
    video_id = extract_video_id(youtube_url)
    clean_time = start_time.replace(':', '')
    cache_dir = "./cache"
    os.makedirs(cache_dir, exist_ok=True)
    return os.path.join(cache_dir, f"{video_id}_{clean_time}_{duration}s.mp4")

def download_youtube_clip(youtube_url: str, start_time: str, duration: int) -> str:
    """Download entire YouTube video, then trim the clip we need."""
    video_id = extract_video_id(youtube_url)
    cache_dir = "./cache"
    os.makedirs(cache_dir, exist_ok=True)
    
    # Full video path
    full_video_path = os.path.join(cache_dir, f"{video_id}_full.mp4")
    
    # Check if we have the full video
    if not os.path.exists(full_video_path):
        print(f"📥 Downloading full video {video_id}...")
        subprocess.run([
            'yt-dlp', '-f', 'best[height<=720]',
            '-o', full_video_path, youtube_url
        ], check=True, capture_output=True)
        print(f"✅ Downloaded full video: {full_video_path}")
    else:
        print(f"📦 Using cached full video: {full_video_path}")
    
    # Trim the specific clip we need
    clip_path = get_cache_path(youtube_url, start_time, duration)
    
    if os.path.exists(clip_path):
        print(f"📦 Using cached clip: {clip_path}")
        return clip_path
    
    print(f"✂️ Trimming clip: {start_time} for {duration}s from full video...")
    # Re-encode to ensure video stream is included properly
    subprocess.run([
        'ffmpeg', '-i', full_video_path, '-ss', start_time, '-t', str(duration),
        '-c:v', 'libx264', '-c:a', 'aac', '-y', clip_path
    ], check=True, capture_output=True)
    
    print(f"✅ Trimmed clip: {clip_path}")
    return clip_path

def extract_frames_from_video(video_path: str, frame_skip: int = 5) -> List[Image.Image]:
    """Extract frames from video file and scale to target resolution."""
    from resolution_manager import resolution_manager
    
    frames = []
    
    with tempfile.TemporaryDirectory() as temp_dir:
        frame_pattern = os.path.join(temp_dir, "frame_%04d.jpg")
        
        print(f"🎞️ Extracting frames every {frame_skip} frames...")
        # Extract frames by frame number, not FPS (to match SAM2's indexing)
        if frame_skip == 1:
            # Extract all frames
            cmd = [
                'ffmpeg', '-i', video_path,
                frame_pattern, '-y'
            ]
        else:
            # Extract every Nth frame using select filter
            cmd = [
                'ffmpeg', '-i', video_path,
                '-vf', f'select=not(mod(n\\,{frame_skip}))',
                '-vsync', 'vfr',
                frame_pattern, '-y'
            ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            print(f"FFmpeg stderr: {result.stderr}")
            raise subprocess.CalledProcessError(result.returncode, cmd)
        
        frame_files = sorted([f for f in os.listdir(temp_dir) if f.startswith('frame_')])
        for frame_file in frame_files:
            frame = Image.open(os.path.join(temp_dir, frame_file)).convert('RGB')
            # Standardize to target resolution immediately
            standardized_frame = resolution_manager.standardize_image(frame)
            frames.append(standardized_frame)
    
    print(f"✅ Extracted {len(frames)} frames at {resolution_manager.target_size}")
    return frames