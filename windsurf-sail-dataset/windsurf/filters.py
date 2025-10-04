"""
Individual filter functions for clip validation
Each filter returns (passed, confidence, reason, optional_data)
"""

import numpy as np
import cv2
from PIL import Image
from typing import Tuple, List, Dict, Any, Optional
from .detection_utils import analyze_frame_samples, ScrubConfig, FrameSample


def filter_sail_count(video_path: str, start_frame: int, end_frame: int, 
                     scrub_config: ScrubConfig) -> Tuple[bool, float, str, Optional[Dict]]:
    """
    Check if clip has appropriate number of sails (1-2) for tracking.
    
    Args:
        video_path: Path to source video
        start_frame: Starting frame of clip
        end_frame: Ending frame of clip
        scrub_config: Scrubbing configuration
        
    Returns:
        Tuple of (passed, confidence, reason, best_frame_data)
    """
    
    from .detection_utils import sample_frames_from_clip
    
    try:
        # Sample frames at scrub intervals
        frame_samples = sample_frames_from_clip(video_path, start_frame, end_frame, scrub_config)
        
        if not frame_samples:
            return False, 0.0, "No frames could be extracted", None
        
        # Analyze all samples for sail counts
        analysis = analyze_frame_samples(frame_samples)
        
        # Validation logic
        max_sails = analysis['max_sail_count']
        avg_sails = analysis['avg_sail_count']
        
        # Ideal: 1-2 sails consistently
        if 1 <= max_sails <= 2 and avg_sails >= 0.5:
            passed = True
            confidence = 0.9
            reason = f"Good sail count: avg={avg_sails:.1f}, max={max_sails}"
        elif max_sails == 0:
            passed = False  
            confidence = 0.1
            reason = "No sails detected in any frame"
        elif max_sails > 2:
            passed = False
            confidence = 0.3
            reason = f"Too many sails: max={max_sails} (complex scene)"
        else:
            passed = False
            confidence = 0.4
            reason = f"Inconsistent sail count: avg={avg_sails:.1f}, max={max_sails}"
        
        # Return best tracking frame if found
        best_frame = analysis.get('best_tracking_frame')
        
        return passed, confidence, reason, best_frame
        
    except Exception as e:
        return False, 0.0, f"Sail count filter failed: {e}", None


def filter_on_water(video_path: str, start_frame: int, end_frame: int,
                   scrub_config: ScrubConfig) -> Tuple[bool, float, str, Optional[Dict]]:
    """
    Check if clip shows windsurfing on water (not beach/interview).
    
    Args:
        video_path: Path to source video
        start_frame: Starting frame of clip
        end_frame: Ending frame of clip
        scrub_config: Scrubbing configuration
        
    Returns:
        Tuple of (passed, confidence, reason, water_analysis)
    """
    
    from .detection_utils import sample_frames_from_clip
    
    try:
        # Sample frames for water analysis
        frame_samples = sample_frames_from_clip(video_path, start_frame, end_frame, scrub_config)
        
        if not frame_samples:
            return False, 0.0, "No frames could be extracted", None
        
        water_percentages = []
        horizon_detections = []
        
        for sample in frame_samples:
            # Analyze water content
            water_pct = analyze_water_content(sample.frame)
            water_percentages.append(water_pct)
            
            # Detect horizon line (indicates water scenes)
            horizon_detected = detect_horizon_line(sample.frame)
            horizon_detections.append(horizon_detected)
        
        # Calculate metrics
        avg_water = np.mean(water_percentages)
        horizon_ratio = sum(horizon_detections) / len(horizon_detections)
        
        # Validation logic
        if avg_water > 0.4 and horizon_ratio > 0.6:
            passed = True
            confidence = min(0.9, avg_water + horizon_ratio * 0.3)
            reason = f"On water: {avg_water:.1%} water, {horizon_ratio:.1%} horizon"
        elif avg_water > 0.3:
            passed = True
            confidence = 0.7
            reason = f"Likely water: {avg_water:.1%} water detected"
        else:
            passed = False
            confidence = avg_water
            reason = f"Not on water: only {avg_water:.1%} water detected"
        
        water_analysis = {
            'avg_water_percentage': avg_water,
            'horizon_detection_ratio': horizon_ratio,
            'sample_count': len(frame_samples)
        }
        
        return passed, confidence, reason, water_analysis
        
    except Exception as e:
        return False, 0.0, f"Water filter failed: {e}", None


def analyze_water_content(frame: Image.Image) -> float:
    """
    Analyze what percentage of frame contains water.
    
    Args:
        frame: PIL Image to analyze
        
    Returns:
        Percentage of frame that appears to be water (0.0-1.0)
    """
    
    # Convert to numpy array for analysis
    frame_np = np.array(frame)
    
    # Simple water detection based on blue color dominance
    # Water typically has high blue channel values
    blue_channel = frame_np[:, :, 2].astype(float)
    total_intensity = np.sum(frame_np, axis=2).astype(float)
    
    # Calculate blue dominance (avoiding division by zero)
    blue_ratio = blue_channel / (total_intensity + 1e-6)
    
    # Water pixels typically have blue ratio > 0.4
    water_mask = blue_ratio > 0.4
    water_percentage = np.sum(water_mask) / water_mask.size
    
    return water_percentage


def detect_horizon_line(frame: Image.Image) -> bool:
    """
    Detect if frame contains a horizon line (indicates water scenes).
    
    Args:
        frame: PIL Image to analyze
        
    Returns:
        True if horizon line detected, False otherwise
    """
    
    # Convert to grayscale for edge detection
    frame_gray = np.array(frame.convert('L'))
    
    # Use Canny edge detection
    edges = cv2.Canny(frame_gray, 50, 150)
    
    # Use Hough line detection for horizontal lines
    lines = cv2.HoughLinesP(edges, 1, np.pi/180, threshold=50,
                           minLineLength=frame.width//4, maxLineGap=10)
    
    if lines is None:
        return False
    
    # Look for horizontal lines in middle third of frame
    h = frame.height
    horizon_lines = 0
    
    for line in lines:
        x1, y1, x2, y2 = line[0]
        
        # Check if line is roughly horizontal and in middle area
        if abs(y2 - y1) < 10 and h//3 < y1 < 2*h//3:
            horizon_lines += 1
    
    # Consider horizon detected if we find at least 2 horizontal lines
    return horizon_lines >= 2