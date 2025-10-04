#!/usr/bin/env python3
"""
CLEAN main pipeline - modular and working
"""

import argparse
import os
import json
import numpy as np
import torch
from PIL import ImageDraw

from youtube_utils import extract_video_id, download_youtube_clip, extract_frames_from_video
from grounding_dino import detect_sails
# from sam2_tracking import track_sails_in_video  # Old Ultralytics version
from sam2_facebook_tracking import track_sails_in_video  # New Facebook SAM2 with point prompting
from file_utils import create_filename, annotate_many, annotate_bboxes_only, draw_colored_masks
from sail_orientation_analyzer import SailOrientationAnalyzer, analyze_sail_tracking_results
import config

def process_video_pipeline(youtube_url: str, start_time: str, duration: int, 
                          frame_skip: int = 5, output_dir: str = "out") -> None:
    """Complete video processing pipeline."""
    
    # Setup
    video_id = extract_video_id(youtube_url)
    os.makedirs(output_dir, exist_ok=True)
    
    print(f"🎬 Video Pipeline: {video_id}, {start_time} for {duration}s, every {frame_skip} frames")
    
    # Step 1: Download video with caching
    video_path = download_youtube_clip(youtube_url, start_time, duration)
    
    # Step 2: Extract frames
    frames = extract_frames_from_video(video_path, frame_skip)
    print(f"📊 Processing {len(frames)} frames")
    
    # Step 3: Detect sails in first frame with Grounding DINO  
    print("🔍 Step 1: Grounding DINO detection on frame 1...")
    first_frame = frames[0]  # Already at target resolution from YouTube utils
    
    print(f"🎯 First frame at target resolution: {first_frame.size}")
    
    initial_bboxes, initial_centers = detect_sails(first_frame)
    
    if not initial_centers:
        print("❌ No sails detected in first frame")
        return
    
    print(f"✅ Found {len(initial_centers)} sails at: {initial_centers}")
    
    # Step 3A: Save DINO detection with configurable first frame colors
    frame1_dino_file = create_filename(video_id, start_time, 1, "01_dino")
    dino_img = annotate_many(
        first_frame, initial_bboxes, initial_centers,
        box_color=config.FIRST_FRAME_BBOX_COLOR,
        box_width=config.FIRST_FRAME_BBOX_WIDTH,
        dot_color=config.FIRST_FRAME_CIRCLE_COLOR,
        dot_diameter=config.FIRST_FRAME_CIRCLE_DIAMETER
    )
    dino_img.save(os.path.join(output_dir, frame1_dino_file))
    print(f"💾 Step 1: {frame1_dino_file} (at target resolution {first_frame.size})")
    
    # Step 3B: SAM2 refinement on first frame
    print("🎯 Step 2: SAM2 refinement on frame 1...")
    
    try:
        from sam2.sam2_image_predictor import SAM2ImagePredictor
        
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        sam2_predictor = SAM2ImagePredictor.from_pretrained("facebook/sam2-hiera-large", device=device)
        sam2_predictor.set_image(np.array(first_frame))
        
        refined_masks = []
        corrected_centers = []
        
        for i, center in enumerate(initial_centers):
            # SAM2 segmentation using center point
            mask_output, scores, _ = sam2_predictor.predict(
                point_coords=np.array([center]),
                point_labels=np.array([1]),
                multimask_output=True,
            )
            
            mask = mask_output[np.argmax(scores)]
            refined_masks.append(mask)
            
            # ALWAYS find a point INSIDE the mask - don't trust the original point!
            y_indices, x_indices = np.where(mask)
            if len(x_indices) > 0:
                # Pick the CENTER of the mask as the most reliable point
                center_y = int(y_indices.mean())
                center_x = int(x_indices.mean())
                corrected_center = (center_x, center_y)
                print(f"  Sail {i+1}: Using mask center at ({center_x}, {center_y})")
                corrected_centers.append(corrected_center)
            else:
                print(f"  Sail {i+1}: No mask found, using original")
                corrected_centers.append(center)  # Fallback
        
        # Step 3C: Save SAM2 refinement with configurable mask color
        frame1_sam2_file = create_filename(video_id, start_time, 1, "02_sam2")
        sam2_img = draw_colored_masks(
            first_frame, refined_masks, initial_bboxes, initial_centers, 
            colors=[config.SAM2_MASK_COLOR], opacity=config.SAM2_MASK_OPACITY
        )
        sam2_img.save(os.path.join(output_dir, frame1_sam2_file))
        print(f"💾 Step 2: {frame1_sam2_file}")
        
        # Step 3D: Save smart correction (yellow bbox + corrected center color-coded)
        frame1_smart_file = create_filename(video_id, start_time, 1, "03_smart")
        
        # Draw with color-coded centers
        smart_img = first_frame.copy()
        d = ImageDraw.Draw(smart_img)
        
        for bbox, orig_center, corr_center in zip(initial_bboxes, initial_centers, corrected_centers):
            # Yellow bbox
            d.rectangle(bbox, outline=(255, 255, 0), width=5)
            
            # Color-coded center dot
            cx, cy = corr_center
            r = config.FIRST_FRAME_CIRCLE_DIAMETER // 2
            if orig_center == corr_center:
                # Unchanged center color
                d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=config.UNCHANGED_CENTER_COLOR)
            else:
                # Corrected center color
                d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=config.CORRECTED_CENTER_COLOR)
        
        smart_img.save(os.path.join(output_dir, frame1_smart_file))
        print(f"💾 Step 3: {frame1_smart_file}")
        
        # Use corrected centers for tracking
        final_centers = corrected_centers
        
    except Exception as e:
        print(f"⚠️ SAM2 refinement failed: {e}, using DINO centers")
        final_centers = initial_centers
    
    # Step 4: SAM2 video tracking using corrected centers with Facebook SAM2
    print("🎯 Step 4: Facebook SAM2 video tracking with point prompting...")
    
    try:
        # Use Facebook SAM2 with point prompting on first frame
        tracking_results, frame_masks, scaled_tracking_points = track_sails_in_video(
            video_path, 
            final_centers,
            initial_frame=0,  # Start tracking from first frame where we have points
            model_size="tiny"  # Can be: tiny, small, base_plus, large
        )
        
        print(f"✅ Tracked across {tracking_results['total_frames']} frames")
        
        # Step 5: Save tracking results with ACTUAL SAM2 masks and bboxes
        frame_results = tracking_results['frame_results']
        
        # DEBUG: Check alignment
        print(f"\n🔍 DEBUG ALIGNMENT CHECK:")
        print(f"  Extracted frames: {len(frames)} frames")
        print(f"  Frame skip: {frame_skip}")
        print(f"  SAM2 tracked frames: {len(frame_results)} frames")
        print(f"  Expected video frame indices: {[i*frame_skip for i in range(len(frames))]}")
        
        for frame_idx in range(len(frames)):
            # CRITICAL: Map extracted frame index to actual video frame number
            video_frame_idx = frame_idx * frame_skip
            print(f"\n📍 Extracted frame {frame_idx} → Video frame {video_frame_idx}")
            
            # Check if we have SAM2 data for this ACTUAL video frame
            if video_frame_idx in frame_results:
                # Get ACTUAL tracking results from SAM2
                frame_bboxes = frame_results[video_frame_idx]['bboxes']
                frame_centers = frame_results[video_frame_idx]['centers']
                masks = frame_masks.get(video_frame_idx, [])
                print(f"  ✓ Found SAM2 data: bbox={frame_bboxes[0] if frame_bboxes else None}, mask_exists={len(masks)>0}")
                
                if frame_bboxes and masks:  # Only save if we have actual SAM2 match
                    # Save tracking file: Green mask + green bbox + show actual tracking point
                    frame_file = create_filename(video_id, start_time, frame_idx + 1, "04_tracked")
                    
                    print(f"    🖼️ PNG frame {frame_idx+1} ← Extracted frame {frame_idx} ← Video frame {video_frame_idx} ← SAM2 mask {video_frame_idx}")
                    
                    # Draw mask overlay with bbox
                    tracked_img = draw_colored_masks(
                        frames[frame_idx], masks, frame_bboxes, centers=None,
                        colors=[config.TRACK_MASK_COLOR], opacity=config.TRACK_MASK_OPACITY
                    )
                    
                    # Add tracking point visualization (where SAM2 is actually looking)
                    d = ImageDraw.Draw(tracked_img)
                    
                    # Scale the tracking point back to target resolution for display
                    for scaled_point in scaled_tracking_points:
                        # Scale from video coordinates to target coordinates for display  
                        from resolution_manager import resolution_manager
                        target_w, target_h = resolution_manager.target_size
                        display_x = int(scaled_point[0] * target_w / 640)
                        display_y = int(scaled_point[1] * target_h / 360)
                        
                        # Draw white circle with black border to show where SAM2 is tracking
                        r = 8
                        d.ellipse((display_x - r - 2, display_y - r - 2, display_x + r + 2, display_y + r + 2), fill=(0, 0, 0))  # Black border
                        d.ellipse((display_x - r, display_y - r, display_x + r, display_y + r), fill=(255, 255, 255))  # White center
                    
                    tracked_img.save(os.path.join(output_dir, frame_file))
                    print(f"💾 Saved: {frame_file} (green mask + bbox + tracking point)")
                else:
                    print(f"  ⚠️ No valid SAM2 mask/bbox data")
            else:
                print(f"  ❌ NO SAM2 data for video frame {video_frame_idx}!")
        
        # Step 6: Analyze sail orientation for brand identification candidates
        print(f"\n🔍 Step 6: Analyzing sail orientation for brand identification...")
        analyzer = analyze_sail_tracking_results(frame_masks, frames)
        analyzer.print_summary()
        
        # Save complete results
        results_file = os.path.join(output_dir, f"{video_id}_{start_time.replace(':', '')}_results.json")
        with open(results_file, 'w') as f:
            json.dump(tracking_results, f, indent=2)
        
        print(f"💾 Complete results: {results_file}")
        print(f"🎉 Pipeline complete: {tracking_results['total_frames']} frames, {tracking_results['sails_detected']} sails")
        
    except Exception as e:
        print(f"❌ SAM2 tracking failed: {e}")
        raise

def main():
    parser = argparse.ArgumentParser(description="Windsurfing sail video processing pipeline")
    parser.add_argument("--image", required=True, help="YouTube URL")
    parser.add_argument("--youtube-time", default="00:37", help="Start timecode")
    parser.add_argument("--clip-duration", type=int, default=10, help="Clip duration in seconds")
    parser.add_argument("--frame-skip", type=int, default=5, help="Process every Nth frame")
    parser.add_argument("--outdir", default="out", help="Output directory")
    parser.add_argument("--verbose", action="store_true", help="Verbose output")
    
    args = parser.parse_args()
    
    try:
        process_video_pipeline(
            args.image, 
            args.youtube_time, 
            args.clip_duration,
            args.frame_skip,
            args.outdir
        )
    except Exception as e:
        print(f"❌ Pipeline failed: {e}")
        if args.verbose:
            import traceback
            traceback.print_exc()

if __name__ == "__main__":
    main()