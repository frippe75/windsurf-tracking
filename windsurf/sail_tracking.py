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
        
        print(f"🔧 Initializing Facebook SAM2 {model_size} on {device}")
        
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
    
    def add_sail_points(self, frame_idx: int, sail_points: List[Point], object_ids: List[int] = None):
        """
        Add clickable points for sails on a specific frame
        
        Args:
            frame_idx: Frame index (0-based)
            sail_points: List of (x, y) points on sails 
            object_ids: Optional object IDs (defaults to 1, 2, 3...)
        """
        
        if object_ids is None:
            object_ids = list(range(1, len(sail_points) + 1))
        
        print(f"🎯 Adding {len(sail_points)} sail points on frame {frame_idx}")
        
        all_masks = []
        
        for obj_id, point in zip(object_ids, sail_points):
            # Add point for this sail object
            # Points should be in video resolution coordinates
            points = np.array([point], dtype=np.float32)
            labels = np.array([1], dtype=np.int32)  # 1 = foreground
            
            print(f"  Sail {obj_id}: Adding point {point}")
            
            # Get video dimensions
            video_H = self.inference_state["video_height"]
            video_W = self.inference_state["video_width"]
            
            # The points should be in VIDEO resolution, not SAM2 internal resolution!
            # SAM2 handles the transformation internally
            video_points = np.array([[points[0][0], points[0][1]]], dtype=np.float32)  # Shape: (1, 2) for single point
            print(f"    Point in video coords: {video_points[0]} (video is {video_W}×{video_H})")
            
            # Add the point and get initial mask
            # Pass points in VIDEO coordinates - SAM2 handles transformation
            _, out_obj_ids, out_mask_logits = self.predictor.add_new_points_or_box(
                inference_state=self.inference_state,
                frame_idx=frame_idx,
                obj_id=obj_id,
                points=video_points,
                labels=labels,
                clear_old_points=True,
                normalize_coords=True  # Let SAM2 normalize the coordinates
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
    
    def track_sails(self, start_frame_idx: int = 0):
        """
        Propagate sail tracking across the entire video
        
        Args:
            start_frame_idx: Frame to start propagation from
            
        Returns:
            Dictionary with tracking results per frame
        """
        
        print(f"🚀 Starting sail tracking propagation from frame {start_frame_idx}")
        
        results = {}
        frame_masks = {}
        
        # Propagate forward
        print("  ➡️ Forward propagation...")
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
        
        # Propagate backward
        print("  ⬅️ Backward propagation...")
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
                    print(f"    Frame {frame_idx}, Sail {obj_ids[obj_idx]}: bbox={bbox}, area={mask_area}")
            
            results[frame_idx] = {
                "object_ids": list(obj_ids),
                "bboxes": frame_bboxes,
                "centers": frame_centers
            }
            frame_masks[frame_idx] = frame_sail_masks
        
        print(f"✅ Tracking complete: {len(results)} frames processed")
        
        return results, frame_masks


def track_objects_in_video(video_path: str, center_points: List[Point], 
                          initial_frame: int = 0, model_size: str = "base_plus") -> Tuple[Dict, Dict, List]:
    """
    Track objects in video using Facebook SAM2 with point prompting
    
    Args:
        video_path: Path to video file
        center_points: List of (x, y) clickable points on objects (in video resolution)
        initial_frame: Frame index where points are provided
        model_size: SAM2 model size (tiny, small, base_plus, large)
        
    Returns:
        Tuple of (tracking_results, frame_masks, scaled_points)
    """
    
    print(f"🚀 Facebook SAM2 video tracking with {len(center_points)} object points...")
    
    track_start = time.time()
    
    # Initialize tracker
    tracker = FacebookSAM2Tracker(model_size=model_size)
    
    # Load video
    num_frames, video_width, video_height = tracker.initialize_video(video_path)
    
    # Important: center_points should already be in video resolution
    # If they're in target resolution, scale them here
    from resolution_manager import resolution_manager
    target_width, target_height = resolution_manager.target_size
    
    # Check if we need to scale points
    if target_width != video_width or target_height != video_height:
        print(f"🔧 Scaling points from {target_width}x{target_height} to {video_width}x{video_height}")
        scale_x = video_width / target_width
        scale_y = video_height / target_height
        
        scaled_points = []
        for point in center_points:
            scaled_x = int(point[0] * scale_x)
            scaled_y = int(point[1] * scale_y) 
            scaled_points.append([scaled_x, scaled_y])
            print(f"  📍 {point} → [{scaled_x}, {scaled_y}]")
    else:
        scaled_points = [[int(p[0]), int(p[1])] for p in center_points]
        print(f"  📍 Points already in video resolution")
    
    # Add sail points on initial frame
    print(f"📌 Adding points to frame {initial_frame} (of {num_frames} total frames)")
    initial_masks = tracker.add_sail_points(initial_frame, scaled_points)
    
    # Run tracking propagation
    frame_results, frame_masks = tracker.track_sails(start_frame_idx=initial_frame)
    
    track_time = time.time() - track_start
    print(f"⏱️ Facebook SAM2 tracking completed in {track_time:.2f}s")
    
    # Format results for compatibility with existing pipeline
    json_results = {
        "total_frames": num_frames,
        "objects_detected": len(center_points),
        "frame_results": frame_results,
        "tracking_time": track_time,
        "model": f"facebook/sam2-{model_size}",
        "video_resolution": [video_width, video_height],
        "initial_frame": initial_frame
    }
    
    return json_results, frame_masks, scaled_points


# Backward compatibility alias
def track_sails_in_video(video_path: str, center_points: List[Point], 
                         initial_frame: int = 0, model_size: str = "base_plus") -> Tuple[Dict, Dict, List]:
    """
    DEPRECATED: Use track_objects_in_video() instead.
    Backward compatibility wrapper for existing code.
    """
    print("⚠️ WARNING: track_sails_in_video() is deprecated. Use track_objects_in_video() instead.")
    return track_objects_in_video(video_path, center_points, initial_frame, model_size)


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
    
    # Track objects
    results, masks, scaled = track_objects_in_video(
        video_path, 
        sail_points,
        initial_frame=0,
        model_size="base_plus"
    )
    
    print(f"\nResults: {results['total_frames']} frames, {results['objects_detected']} objects")
    print(f"Tracking time: {results['tracking_time']:.2f}s")
    
    return results, masks


if __name__ == "__main__":
    print("Facebook SAM2 tracking module ready")
    print("Use track_objects_in_video() to track objects with point prompting")