"""
File naming and image utilities
"""

import os
import numpy as np
from PIL import Image, ImageDraw
from typing import List, Tuple

BBox = Tuple[int, int, int, int]
Point = Tuple[int, int]

def create_filename(video_id: str, timecode: str, frame_num: int, step: str, extension: str = "png") -> str:
    """Create standardized filename: video-id_timecode_framenum_step.ext"""
    clean_timecode = timecode.replace(':', '')
    return f"{video_id}_{clean_timecode}_{frame_num:03d}_{step}.{extension}"

def draw_bbox_and_dot(img: Image.Image, bbox: BBox, center: Point,
                      box_color=(255, 255, 0), box_width: int = 5,
                      dot_color=(0, 255, 0), dot_diameter: int = 30) -> Image.Image:
    """Draw bounding box and center dot on image."""
    out = img.copy()
    d = ImageDraw.Draw(out)
    d.rectangle(bbox, outline=box_color, width=box_width)
    cx, cy = center
    r = dot_diameter // 2
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=dot_color)
    return out

def annotate_many(img: Image.Image, bboxes: List[BBox], centers: List[Point] = None, 
                  box_color=(255, 255, 0), box_width: int = 5,
                  dot_color=(255, 255, 0), dot_diameter: int = 30) -> Image.Image:
    """Draw multiple bboxes and optionally centers on image with configurable colors."""
    out = img.copy()
    d = ImageDraw.Draw(out)
    
    # Always draw bboxes
    for bbox in bboxes:
        d.rectangle(bbox, outline=box_color, width=box_width)
    
    # Only draw centers if provided (for first frame detection, not tracking)
    if centers:
        for center in centers:
            cx, cy = center
            r = dot_diameter // 2
            d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=dot_color)
    
    return out

def annotate_bboxes_only(img: Image.Image, bboxes: List[BBox], 
                        box_color=(0, 255, 0), box_width: int = 3) -> Image.Image:
    """Draw only bboxes (for tracking where we don't have center points)."""
    return annotate_many(img, bboxes, centers=None, box_color=box_color, box_width=box_width)

def draw_colored_masks(img: Image.Image, masks: List[np.ndarray], 
                      bboxes: List[BBox] = None, centers: List[Point] = None,
                      colors: List[Tuple[int, int, int]] = None, 
                      opacity: float = 0.4) -> Image.Image:
    """Draw colored masks with transparency over image, plus bboxes and centers."""
    if colors is None:
        colors = [
            (255, 0, 0),    # Red
            (0, 255, 0),    # Green  
            (0, 0, 255),    # Blue
            (255, 255, 0),  # Yellow
            (255, 0, 255),  # Magenta
        ]
    
    # Convert PIL to numpy
    img_array = np.array(img)
    overlay = img_array.copy()
    
    for i, mask in enumerate(masks):
        color = colors[i % len(colors)]
        
        # Handle mask size mismatch by resizing mask to match image
        if mask.shape != img_array.shape[:2]:
            print(f"🔧 Resizing mask from {mask.shape} to {img_array.shape[:2]}")
            from PIL import Image as PILImage
            mask_pil = PILImage.fromarray((mask * 255).astype(np.uint8))
            mask_resized = mask_pil.resize((img_array.shape[1], img_array.shape[0]), PILImage.NEAREST)
            mask = (np.array(mask_resized) > 128).astype(bool)
        
        # Ensure mask is boolean
        if mask.dtype != bool:
            mask = mask.astype(bool)
        
        # Apply colored mask
        for c in range(3):
            overlay[mask, c] = color[c]
    
    # Blend original with overlay
    blended = (1 - opacity) * img_array + opacity * overlay
    result_img = Image.fromarray(blended.astype(np.uint8))
    
    # Add bboxes and centers on top
    if bboxes and centers:
        result_img = annotate_many(result_img, bboxes, centers)
    
    return result_img