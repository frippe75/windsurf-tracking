"""
Stage 2: Single Segment Processing Component
Takes one segment from Stage 1 and runs DINO + SAM2 tracking
"""

from typing import Dict, List, Any
import os
import sys

# Core windsurf imports
from .grounding_dino import detect_sails
from .sail_tracking import track_sails_in_video
from .youtube_utils import download_youtube_clip


def process_single_segment(segments_data: Dict, segment_index: int) -> Dict:
    """
    Process a single segment with DINO detection + SAM2 tracking.
    
    Args:
        segments_data: Complete Stage 1 output with all segments
        segment_index: Which segment to process (0-74)
        
    Returns:
        Tracking results for this segment
    """
    
    # Extract segment info
    segment = segments_data['segments'][segment_index]
    source_video = segments_data['source_video']
    
    print(f"Stage 2: Processing {segment['clip_id']}")
    print(f"  Frames: {segment['start_frame']}-{segment['end_frame']}")
    print(f"  Duration: {segment['duration']}s")
    
    try:
        # Step 1: Extract this specific segment as a clip
        # Use YouTube utils to extract the clip (works with local videos too)
        clip_start_time = segment['start_time']
        clip_duration = segment['duration']
        
        # For now, create a temporary clip (could optimize to use frame ranges directly)
        temp_clip_path = f"/tmp/{segment['clip_id']}.mp4"
        
        # Extract clip using ffmpeg (simplified approach)
        import subprocess
        cmd = [
            'ffmpeg', '-i', source_video['path'],
            '-ss', str(clip_start_time), 
            '-t', str(clip_duration),
            '-c', 'copy',  # Fast copy without re-encoding
            temp_clip_path, '-y'
        ]
        result = subprocess.run(cmd, capture_output=True)
        
        if result.returncode != 0:
            raise Exception(f"FFmpeg failed: {result.stderr}")
        
        print(f"  Extracted clip: {temp_clip_path}")
        
        # Step 2: Run existing Stage 2 pipeline on this clip
        # Import the working Stage 2 logic from stage2_processing
        from .stage2_processing import process_video_pipeline
        
        # Run the pipeline on this specific clip
        tracking_results = process_video_pipeline(
            temp_clip_path,
            output_dir=f"/tmp/{segment['clip_id']}_output"
        )
        
        # Step 3: Create segment results
        segment_results = {
            'clip_id': segment['clip_id'],
            'segment_index': segment_index,
            'start_frame': segment['start_frame'],
            'end_frame': segment['end_frame'],
            'processing_status': 'success',
            'tracking_results': tracking_results,
            'frames_processed': segment['end_frame'] - segment['start_frame']
        }
        
        print(f"  Completed: {segment['clip_id']}")
        
        # Cleanup temporary files
        if os.path.exists(temp_clip_path):
            os.remove(temp_clip_path)
        
        return segment_results
        
    except Exception as e:
        print(f"  Failed: {segment['clip_id']} - {e}")
        
        return {
            'clip_id': segment['clip_id'],
            'segment_index': segment_index,
            'processing_status': 'failed',
            'error': str(e)
        }


def process_multiple_segments(segments_data: Dict, segment_indices: List[int]) -> List[Dict]:
    """
    Process multiple segments (for batch processing).
    
    Args:
        segments_data: Complete Stage 1 output
        segment_indices: List of segment indices to process
        
    Returns:
        List of tracking results
    """
    
    results = []
    
    for i in segment_indices:
        if i < len(segments_data['segments']):
            result = process_single_segment(segments_data, i)
            results.append(result)
        else:
            print(f"Warning: Segment index {i} out of range")
    
    return results