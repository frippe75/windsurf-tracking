"""
Reusable detection utilities for clip validation and frame analysis
"""

import cv2
import numpy as np
from typing import List, Tuple, Dict, Optional
from PIL import Image
from dataclasses import dataclass


@dataclass
class ScrubConfig:
    """Configuration for clip scrubbing parameters"""
    scrub_interval: int = 25  # Frames between samples (1 second at 25fps)
    max_scrub_attempts: int = 5  # Maximum samples before giving up
    early_accept_threshold: float = 0.8  # Confidence to immediately accept
    early_reject_threshold: float = 0.2  # Confidence to immediately reject


@dataclass 
class FrameSample:
    """Single frame sample with metadata"""
    frame_offset: int  # Frame number within clip
    frame: Image.Image  # PIL Image
    timestamp: float  # Time offset in seconds


def extract_frame_at_offset(video_path: str, start_frame: int, frame_offset: int) -> Image.Image:
    """
    Extract a single frame from video at specific offset.
    
    Args:
        video_path: Path to video file
        start_frame: Starting frame of the clip
        frame_offset: Offset within the clip (0-based)
        
    Returns:
        PIL Image of the frame
    """
    
    target_frame = start_frame + frame_offset
    
    # Use OpenCV for efficient frame extraction
    cap = cv2.VideoCapture(video_path)
    cap.set(cv2.CAP_PROP_POS_FRAMES, target_frame)
    
    ret, frame = cap.read()
    cap.release()
    
    if not ret:
        raise ValueError(f"Could not extract frame {target_frame} from {video_path}")
    
    # Convert BGR to RGB and return as PIL Image
    frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    return Image.fromarray(frame_rgb)


def sample_frames_from_clip(video_path: str, start_frame: int, end_frame: int, 
                           scrub_config: ScrubConfig) -> List[FrameSample]:
    """
    Sample frames from a clip at scrub intervals.
    
    Args:
        video_path: Path to source video
        start_frame: Starting frame of clip
        end_frame: Ending frame of clip
        scrub_config: Scrubbing configuration
        
    Returns:
        List of sampled frames with metadata
    """
    
    clip_duration_frames = end_frame - start_frame
    samples = []
    
    for attempt in range(scrub_config.max_scrub_attempts):
        frame_offset = attempt * scrub_config.scrub_interval
        
        # Don't go beyond clip boundaries
        if frame_offset >= clip_duration_frames:
            break
        
        try:
            frame = extract_frame_at_offset(video_path, start_frame, frame_offset)
            timestamp = frame_offset / 25.0  # Assume 25fps for timestamp calculation
            
            sample = FrameSample(
                frame_offset=frame_offset,
                frame=frame,
                timestamp=timestamp
            )
            samples.append(sample)
            
        except ValueError as e:
            print(f"Warning: Could not extract frame at offset {frame_offset}: {e}")
            continue
    
    return samples


def detect_sails_in_frame(frame: Image.Image, confidence_threshold: float = 0.3) -> Tuple[int, List, List]:
    """
    Reusable DINO sail detection for single frame.
    
    Args:
        frame: PIL Image to analyze
        confidence_threshold: DINO detection threshold
        
    Returns:
        Tuple of (sail_count, bboxes, centers)
    """
    
    import sys
    sys.path.insert(0, '/home/frta/windsurf-sail-dataset/src')
    from grounding_dino import detect_sails
    
    try:
        bboxes, centers = detect_sails(frame, confidence_threshold)
        return len(centers), bboxes, centers
    
    except Exception as e:
        print(f"Warning: DINO detection failed: {e}")
        return 0, [], []


def analyze_frame_samples(frame_samples: List[FrameSample], 
                         confidence_threshold: float = 0.3) -> Dict:
    """
    Analyze multiple frame samples for validation criteria.
    
    Args:
        frame_samples: List of frames to analyze
        confidence_threshold: DINO detection threshold
        
    Returns:
        Analysis results with sail counts and best frames
    """
    
    analysis = {
        'sail_counts': [],
        'total_samples': len(frame_samples),
        'best_tracking_frame': None,
        'detection_details': []
    }
    
    for sample in frame_samples:
        sail_count, bboxes, centers = detect_sails_in_frame(sample.frame, confidence_threshold)
        
        analysis['sail_counts'].append(sail_count)
        analysis['detection_details'].append({
            'frame_offset': sample.frame_offset,
            'timestamp': sample.timestamp,
            'sail_count': sail_count,
            'bboxes': bboxes,
            'centers': centers
        })
        
        # Track best frame for tracking start (1-2 sails ideal)
        if 1 <= sail_count <= 2 and analysis['best_tracking_frame'] is None:
            analysis['best_tracking_frame'] = {
                'frame_offset': sample.frame_offset,
                'timestamp': sample.timestamp,
                'sail_count': sail_count,
                'centers': centers,
                'frame': sample.frame
            }
    
    # Calculate summary statistics
    if analysis['sail_counts']:
        analysis['avg_sail_count'] = np.mean(analysis['sail_counts'])
        analysis['max_sail_count'] = max(analysis['sail_counts'])
        analysis['min_sail_count'] = min(analysis['sail_counts'])
        analysis['sail_count_std'] = np.std(analysis['sail_counts'])
    
    return analysis