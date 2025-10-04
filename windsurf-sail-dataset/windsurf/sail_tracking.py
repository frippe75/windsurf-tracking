"""
SAM2 Facebook video tracking implementation using point prompting
Replaces Ultralytics implementation with proper Facebook SAM2 video predictor
"""

import os
import time
import numpy as np
import torch
from typing import List, Tuple, Dict
from pathlib import Path

# Import Facebook SAM2
import sys
sys.path.append('/home/frta/windsurf-sail-dataset/facebook-sam2')
from sam2.build_sam import build_sam2_video_predictor

BBox = Tuple[int, int, int, int]
Point = Tuple[int, int]

def extract_video_segment_for_tracking(video_path: str, start_frame: int, end_frame: int) -> str:
    """Extract video segment for SAM2 tracking to avoid memory issues"""
    
    import tempfile
    import subprocess
    import cv2
    
    # Get video FPS
    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS)
    cap.release()
    
    # Create temporary segment video  
    temp_dir = tempfile.mkdtemp()
    segment_filename = f"tracking_segment_{start_frame}_{end_frame}.mp4"
    segment_path = os.path.join(temp_dir, segment_filename)
    
    # Calculate time offsets
    start_time = start_frame / fps
    duration = (end_frame - start_frame) / fps
    
    print(f"🎬 Extracting video segment: frames {start_frame}-{end_frame} ({duration:.2f}s)")
    
    # Use ffmpeg to extract segment with re-encoding (SAM2 compatible)
    cmd = [
        'ffmpeg', '-i', video_path,
        '-ss', str(start_time),
        '-t', str(duration), 
        '-c:v', 'libx264',  # Re-encode with compatible codec
        '-c:a', 'aac',      # Re-encode audio
        segment_path, '-y'
    ]
    
    result = subprocess.run(cmd, capture_output=True, text=True)
    
    if result.returncode != 0:
        raise Exception(f"FFmpeg segment extraction failed: {result.stderr}")
    
    print(f"✅ Segment extracted: {segment_path}")
    
    return segment_path

class FacebookSAM2Tracker:
    """Facebook SAM2 video tracker using point prompting"""
    
    def __init__(self, model_size="base_plus", device=None):
        """Initialize the Facebook SAM2 video predictor"""
        
        # Model configurations
        checkpoints = {
            "tiny": "/home/frta/windsurf-sail-dataset/facebook-sam2/checkpoints/sam2.1_hiera_tiny.pt",
            "small": "/home/frta/windsurf-sail-dataset/facebook-sam2/checkpoints/sam2.1_hiera_small.pt", 
            "base_plus": "/home/frta/windsurf-sail-dataset/facebook-sam2/checkpoints/sam2.1_hiera_base_plus.pt",
            "large": "/home/frta/windsurf-sail-dataset/facebook-sam2/checkpoints/sam2.1_hiera_large.pt"
        }
        
        configs = {
            "tiny": "configs/sam2.1/sam2.1_hiera_t.yaml",
            "small": "configs/sam2.1/sam2.1_hiera_s.yaml",
            "base_plus": "configs/sam2.1/sam2.1_hiera_b+.yaml",
            "large": "configs/sam2.1/sam2.1_hiera_l.yaml"
        }
        
        if device is None:
            if torch.cuda.is_available():
                device = torch.device("cuda")
            else:
                device = torch.device("cpu")
        
        print(f"🔧 Loading model: Facebook SAM2 Video Predictor ({model_size}) on {device} - SAIL TRACKING")
        
        checkpoint = checkpoints.get(model_size)
        model_cfg = configs.get(model_size)
        
        if not os.path.exists(checkpoint):
            raise FileNotFoundError(f"Checkpoint not found: {checkpoint}")
        
        # Build the video predictor
        self.predictor = build_sam2_video_predictor(
            model_cfg, 
            checkpoint, 
            device=device
        )
        self.device = device
        self.inference_state = None
        
    def initialize_video(self, video_path: str):
        """Initialize tracking state for a video"""
        
        print(f"🔧 Loading model: SAM2 Video State for {video_path} - SAIL TRACKING")
        print(f"📹 Initializing video: {video_path}")
        
        # Initialize inference state
        self.inference_state = self.predictor.init_state(
            video_path,
            offload_video_to_cpu=False,  # Keep on GPU for speed
            offload_state_to_cpu=False
        )
        
        num_frames = self.inference_state["num_frames"]
        video_height = self.inference_state["video_height"] 
        video_width = self.inference_state["video_width"]
        
        print(f"✅ Video loaded: {num_frames} frames, {video_width}x{video_height}")
        
        return num_frames, video_width, video_height
    
    def add_object_prompts(self, frame_idx: int, objects_data: List[Dict]):
        """
        Add prompts for multiple objects on a specific frame
        
        Args:
            frame_idx: Frame index (0-based)
            objects_data: List of objects with prompts
                [{"object_id": 1, "positive_points": [(x,y)], "negative_points": [(x,y)]}]
        """
        
        print(f"🎯 Adding {len(objects_data)} objects on frame {frame_idx}")
        
        all_masks = []
        
        for obj_data in objects_data:
            obj_id = obj_data['object_id']
            positive_points = obj_data.get('positive_points', [])
            negative_points = obj_data.get('negative_points', [])
            
            if not positive_points:
                print(f"  Object {obj_id}: SKIPPED (no positive points)")
                continue
                
            # Combine positive and negative points
            all_points = positive_points + negative_points
            all_labels = [1] * len(positive_points) + [0] * len(negative_points)
            
            print(f"  Object {obj_id}: Adding {len(positive_points)} positive + {len(negative_points)} negative points")
            
            # Convert to numpy arrays
            video_points = np.array(all_points, dtype=np.float32)
            labels = np.array(all_labels, dtype=np.int32)
            
            video_H = self.inference_state["video_height"] 
            video_W = self.inference_state["video_width"]
            
            print(f"    Points: {video_points} (video is {video_W}×{video_H})")
            
            # Add prompts for this object
            _, out_obj_ids, out_mask_logits = self.predictor.add_new_points_or_box(
                inference_state=self.inference_state,
                frame_idx=frame_idx,
                obj_id=obj_id,
                points=video_points,
                labels=labels,
                clear_old_points=True,
                normalize_coords=True
            )
            
            # Convert logits to binary masks with different thresholds
            mask_raw = out_mask_logits.cpu().numpy()
            mask = (mask_raw > 0.0)
            all_masks.append(mask[0, 0])  # First object, first mask
            
            # Debug mask info
            mask_pixels = np.sum(mask[0, 0])
            max_val = np.max(mask_raw)
            min_val = np.min(mask_raw)
            print(f"    Initial mask: {mask_pixels} pixels (logits: min={min_val:.2f}, max={max_val:.2f})")
        
        return all_masks
    
    def track_sails(self, start_frame_idx: int = 0, progress_callback=None):
        """
        Propagate sail tracking across the entire video
        
        Args:
            start_frame_idx: Frame to start propagation from
            progress_callback: Optional async function for progress updates
            
        Returns:
            Dictionary with tracking results per frame
        """
        
        print(f"🚀 Starting sail tracking propagation from frame {start_frame_idx}")
        
        results = {}
        frame_masks = {}
        
        # Get total frames for progress calculation
        total_frames = self.inference_state["num_frames"]
        
        # Propagate forward
        print("  ➡️ Forward propagation...")
        forward_frames = []
        for frame_idx, obj_ids, video_res_masks in self.predictor.propagate_in_video(
            self.inference_state,
            start_frame_idx=start_frame_idx,
            reverse=False
        ):
            # Convert masks to binary
            binary_masks = (video_res_masks > 0.0).cpu().numpy()
            
            # Store results
            frame_bboxes = []
            frame_centers = []
            frame_sail_masks = []
            
            for obj_idx, mask in enumerate(binary_masks):
                mask = mask[0]  # Remove channel dimension
                frame_sail_masks.append(mask)
                
                # Get bounding box from mask
                y_indices, x_indices = np.where(mask)
                if len(x_indices) > 0:
                    x1, x2 = int(x_indices.min()), int(x_indices.max())
                    y1, y2 = int(y_indices.min()), int(y_indices.max())
                    bbox = (x1, y1, x2, y2)
                    center = ((x1 + x2) // 2, (y1 + y2) // 2)
                    
                    frame_bboxes.append(bbox)
                    frame_centers.append(center)
                    
                    mask_area = np.sum(mask)
                    
                    # Debug: Check mask and video dimensions
                    if frame_idx <= 1:  # Only log for first 2 frames
                        mask_height, mask_width = mask.shape
                        video_H = self.inference_state["video_height"]
                        video_W = self.inference_state["video_width"]
                        print(f"    🔍 Frame {frame_idx}: mask={mask_width}×{mask_height}, video={video_W}×{video_H}, bbox={bbox}")
                    
                    # Get mask confidence from logits for tracking quality assessment
                    mask_logits = video_res_masks[obj_idx][0].cpu().numpy()
                    avg_confidence = np.mean(mask_logits[mask]) if mask_area > 0 else np.min(mask_logits)
                    
                    print(f"    Frame {frame_idx}, Sail {obj_ids[obj_idx]}: bbox={bbox}, area={mask_area}, conf={avg_confidence:.2f}")
                else:
                    # No mask detected - tracking may have failed
                    obj_id = obj_ids[obj_idx] if obj_idx < len(obj_ids) else "unknown"
                    print(f"    Frame {frame_idx}, Sail {obj_id}: NO MASK (tracking lost)")
            
            results[frame_idx] = {
                "object_ids": list(obj_ids),
                "bboxes": frame_bboxes,
                "centers": frame_centers
            }
            frame_masks[frame_idx] = frame_sail_masks
            forward_frames.append(frame_idx)
            
            # Send progress update if callback provided
            if progress_callback:
                percentage = (len(forward_frames) / total_frames) * 100  # Real progress based on actual frames
                import asyncio
                asyncio.create_task(progress_callback(frame_idx, percentage, "tracking"))
        
        # Propagate backward
        print("  ⬅️ Backward propagation...")
        backward_frames = []
        for frame_idx, obj_ids, video_res_masks in self.predictor.propagate_in_video(
            self.inference_state,
            start_frame_idx=start_frame_idx,
            reverse=True
        ):
            # Skip if already processed in forward pass
            if frame_idx in results:
                continue
                
            # Convert masks to binary
            binary_masks = (video_res_masks > 0.0).cpu().numpy()
            
            # Store results
            frame_bboxes = []
            frame_centers = []
            frame_sail_masks = []
            
            for obj_idx, mask in enumerate(binary_masks):
                mask = mask[0]  # Remove channel dimension
                frame_sail_masks.append(mask)
                
                # Get bounding box from mask
                y_indices, x_indices = np.where(mask)
                if len(x_indices) > 0:
                    x1, x2 = int(x_indices.min()), int(x_indices.max())
                    y1, y2 = int(y_indices.min()), int(y_indices.max())
                    bbox = (x1, y1, x2, y2)
                    center = ((x1 + x2) // 2, (y1 + y2) // 2)
                    
                    frame_bboxes.append(bbox)
                    frame_centers.append(center)
                    
                    mask_area = np.sum(mask)
                    
                    # Debug: Check mask and video dimensions (backward pass)
                    if frame_idx <= 1:  # Only log for first 2 frames
                        mask_height, mask_width = mask.shape
                        video_H = self.inference_state["video_height"]
                        video_W = self.inference_state["video_width"]
                        print(f"    🔍 Frame {frame_idx} (backward): mask={mask_width}×{mask_height}, video={video_W}×{video_H}, bbox={bbox}")
                    
                    print(f"    Frame {frame_idx}, Sail {obj_ids[obj_idx]}: bbox={bbox}, area={mask_area}")
            
            results[frame_idx] = {
                "object_ids": list(obj_ids),
                "bboxes": frame_bboxes,
                "centers": frame_centers
            }
            frame_masks[frame_idx] = frame_sail_masks
            backward_frames.append(frame_idx)
            
            # Send progress update for backward pass
            if progress_callback:
                total_processed = len(forward_frames) + len(backward_frames)
                percentage = (total_processed / total_frames) * 100  # Real combined progress
                import asyncio
                asyncio.create_task(progress_callback(frame_idx, percentage, "tracking"))
        
        print(f"✅ Tracking complete: {len(results)} frames processed")
        print(f"    Forward frames: {forward_frames[:10]}{'...' if len(forward_frames) > 10 else ''}")
        print(f"    Results keys: {list(results.keys())[:10]}{'...' if len(results) > 10 else ''}")
        
        return results, frame_masks


def track_objects_in_video(video_path: str, objects_data: List[Dict] = None, center_points: List[Point] = None,
                          initial_frame: int = 0, end_frame: int = None, model_size: str = "base_plus", device_id: int = None, progress_callback=None) -> Tuple[Dict, Dict, List]:
    """
    Track objects in video using Facebook SAM2 with point prompting
    
    Args:
        video_path: Path to video file
        objects_data: List of object prompts [{"object_id": 1, "positive_points": [(x,y)], "negative_points": [(x,y)]}]
        center_points: DEPRECATED - use objects_data instead
        initial_frame: Frame index where prompts are provided
        end_frame: Last frame to track
        model_size: SAM2 model size (tiny, small, base_plus, large)
        
    Returns:
        Tuple of (tracking_results, frame_masks, objects_data)
    """
    
    # Handle both old and new API formats
    if objects_data is None and center_points is not None:
        # Backward compatibility - convert old format
        objects_data = []
        for i, point in enumerate(center_points):
            objects_data.append({
                "object_id": i + 1,
                "positive_points": [point],
                "negative_points": []
            })
        print("⚠️ Using deprecated center_points format - upgrade to objects_data")
    
    if objects_data is None:
        raise ValueError("Must provide either objects_data or center_points")
    
    print(f"🚀 Facebook SAM2 video tracking with {len(objects_data)} objects...")
    
    track_start = time.time()
    
    # Extract video segment to avoid loading entire video into memory
    if end_frame is None:
        # Default to 100 frames if no end frame specified
        segment_end_frame = initial_frame + 100
    else:
        # Use the exact end frame specified by the job
        segment_end_frame = end_frame
    
    segment_video_path = extract_video_segment_for_tracking(video_path, initial_frame, segment_end_frame)
    
    # Initialize tracker
    tracker = FacebookSAM2Tracker(model_size=model_size)
    
    # Load segmented video (much smaller)
    num_frames, video_width, video_height = tracker.initialize_video(segment_video_path)
    
    # Add object prompts on frame 0 (since we extracted a segment starting from initial_frame)
    segment_initial_frame = 0  # Always start at frame 0 for segments
    print(f"📌 Adding prompts to frame {segment_initial_frame} (of {num_frames} total frames in segment)")
    initial_masks = tracker.add_object_prompts(segment_initial_frame, objects_data)
    
    # Run tracking propagation from segment frame 0
    frame_results, frame_masks = tracker.track_sails(start_frame_idx=segment_initial_frame, progress_callback=progress_callback)
    
    track_time = time.time() - track_start
    print(f"⏱️ Facebook SAM2 tracking completed in {track_time:.2f}s")
    
    # Remap frame numbers back to original video frame numbers
    remapped_frame_results = {}
    remapped_frame_masks = {}
    for segment_frame_idx, frame_data in frame_results.items():
        original_frame_idx = initial_frame + segment_frame_idx
        remapped_frame_results[original_frame_idx] = frame_data
        
        # Also remap frame_masks to same numbering
        if segment_frame_idx in frame_masks:
            remapped_frame_masks[original_frame_idx] = frame_masks[segment_frame_idx]
    
    # Format results for compatibility with existing pipeline
    json_results = {
        "total_frames": num_frames,
        "objects_detected": len(objects_data),
        "frame_results": remapped_frame_results,  # Use remapped frame numbers
        "tracking_time": track_time,
        "model": f"facebook/sam2-{model_size}",
        "video_resolution": [video_width, video_height],
        "initial_frame": initial_frame
    }
    
    return json_results, remapped_frame_masks, objects_data


# Backward compatibility alias
def track_sails_in_video(video_path: str, center_points: List[Point], 
                         initial_frame: int = 0, model_size: str = "base_plus") -> Tuple[Dict, Dict, List]:
    """
    DEPRECATED: Use track_objects_in_video() instead.
    Backward compatibility wrapper for existing code.
    """
    print("⚠️ WARNING: track_sails_in_video() is deprecated. Use track_objects_in_video() instead.")
    results, frame_masks, objects_data = track_objects_in_video(video_path, center_points=center_points, 
                                                               initial_frame=initial_frame, model_size=model_size)
    return results, frame_masks, center_points  # Return original center_points for compatibility


# Test function
def test_facebook_sam2():
    """Test Facebook SAM2 tracking"""
    
    # Example usage
    video_path = "/path/to/video.mp4"
    
    # Clickable points on sails (in video coordinates)
    sail_points = [
        [320, 180],  # Sail 1 center point
        [480, 200],  # Sail 2 center point
    ]
    
    # Track sails
    results, masks, scaled = track_sails_in_video(
        video_path, 
        sail_points,
        initial_frame=0,
        model_size="base_plus"
    )
    
    print(f"\nResults: {results['total_frames']} frames, {results['sails_detected']} sails")
    print(f"Tracking time: {results['tracking_time']:.2f}s")
    
    return results, masks


if __name__ == "__main__":
    print("Facebook SAM2 tracking module ready")
    print("Use track_sails_in_video() to track sails with point prompting")