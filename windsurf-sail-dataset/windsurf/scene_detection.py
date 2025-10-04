"""
Pure scene detection logic - framework agnostic
"""

import subprocess
from pathlib import Path
from typing import List, Dict, Tuple
from dataclasses import dataclass


@dataclass
class VideoInfo:
    path: str
    name: str
    duration: float
    fps: float
    frame_count: int
    width: int = 640
    height: int = 360


@dataclass
class SceneSegment:
    clip_id: str
    start_frame: int
    end_frame: int
    start_time: float
    end_time: float
    duration: float


def get_video_info(video_path: str) -> VideoInfo:
    """Extract video metadata using ffprobe."""
    
    # Get duration
    cmd = ['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video_path]
    result = subprocess.run(cmd, capture_output=True, text=True)
    duration = float(result.stdout.strip())
    
    # Get frame rate
    cmd = ['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'csv=s=x:p=0', video_path]
    result = subprocess.run(cmd, capture_output=True, text=True)
    fps_str = result.stdout.strip()
    fps = eval(fps_str)  # Convert "24000/1001" to float
    
    # Get resolution
    cmd = ['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=s=x:p=0', video_path]
    result = subprocess.run(cmd, capture_output=True, text=True)
    width, height = map(int, result.stdout.strip().split('x'))
    
    frame_count = int(duration * fps)
    
    return VideoInfo(
        path=video_path,
        name=Path(video_path).stem,
        duration=duration,
        fps=fps,
        frame_count=frame_count,
        width=width,
        height=height
    )


def generate_overlapping_segments(video_info: VideoInfo, 
                                clip_duration: float = 8.0,
                                overlap_duration: float = 2.0,
                                min_duration: float = 3.0) -> List[SceneSegment]:
    """
    Generate overlapping clip segments for systematic coverage.
    """
    
    segments = []
    start_time = 0.0
    clip_counter = 1
    
    while start_time + min_duration <= video_info.duration:
        # Calculate end time
        end_time = min(start_time + clip_duration, video_info.duration)
        
        # Skip if resulting clip is too short
        if end_time - start_time < min_duration:
            break
        
        # Convert to frame numbers (critical for SAM2 compatibility)
        start_frame = int(start_time * video_info.fps)
        end_frame = int(end_time * video_info.fps)
        
        # Generate clip ID (timestamp-based for uniqueness)
        start_minutes = int(start_time // 60)
        start_seconds = int(start_time % 60)
        clip_id = f"{video_info.name}_{start_minutes:02d}{start_seconds:02d}_{clip_counter:03d}"
        
        segment = SceneSegment(
            clip_id=clip_id,
            start_frame=start_frame,
            end_frame=end_frame,
            start_time=start_time,
            end_time=end_time,
            duration=end_time - start_time
        )
        
        segments.append(segment)
        clip_counter += 1
        
        # Move to next clip with overlap
        start_time += (clip_duration - overlap_duration)
    
    return segments


def detect_scenes(video_path: str) -> Dict:
    """
    Main scene detection function - framework agnostic.
    """
    
    # Get video info
    video_info = get_video_info(video_path)
    
    # Generate segments
    segments = generate_overlapping_segments(video_info)
    
    # Create output format
    return {
        'stage1_version': '1.0',
        'source_video': {
            'path': video_info.path,
            'name': video_info.name,
            'duration': video_info.duration,
            'fps': video_info.fps,
            'frame_count': video_info.frame_count,
            'resolution': f"{video_info.width}x{video_info.height}"
        },
        'total_segments': len(segments),
        'segments': [
            {
                'clip_id': seg.clip_id,
                'start_frame': seg.start_frame,
                'end_frame': seg.end_frame,
                'start_time': seg.start_time,
                'end_time': seg.end_time,
                'duration': seg.duration
            }
            for seg in segments
        ]
    }