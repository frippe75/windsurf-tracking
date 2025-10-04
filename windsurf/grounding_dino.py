"""
Grounding DINO sail detection
"""

import time
import tempfile
import os
import numpy as np
from PIL import Image
from typing import List, Tuple

try:
    from groundingdino.util.inference import load_model, load_image as gd_load_image, predict
    import torch
    GROUNDING_DINO_AVAILABLE = True
except ImportError:
    GROUNDING_DINO_AVAILABLE = False

BBox = Tuple[int, int, int, int]
Point = Tuple[int, int]

def detect_sails(img: Image.Image, confidence_threshold: float = 0.3) -> Tuple[List[BBox], List[Point]]:
    """Use Grounding DINO to detect windsurfing sails at target resolution."""
    if not GROUNDING_DINO_AVAILABLE:
        raise RuntimeError("Grounding DINO not available. Install with setup.sh --with-sam2")
    
    total_start = time.time()
    
    # Image is already at target resolution - no scaling needed!
    print(f"🔧 Processing DINO at target resolution: {img.size}")
    
    # Save PIL image to temp file for Grounding DINO
    with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as tmp:
        img.save(tmp.name, 'JPEG')
        temp_path = tmp.name
    
    try:
        # Check GPU and load model
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        
        model_start = time.time()
        model = load_model("groundingdino/config/GroundingDINO_SwinT_OGC.py", "weights/groundingdino_swint_ogc.pth")
        if torch.cuda.is_available():
            model = model.to(device)
        model_time = time.time() - model_start
        
        # Load image
        img_load_start = time.time()
        img_source, img_tensor = gd_load_image(temp_path)
        if torch.cuda.is_available() and hasattr(img_tensor, 'to'):
            img_tensor = img_tensor.to(device)
        img_load_time = time.time() - img_load_start
        
        # Detect with prompt
        inference_start = time.time()
        text_prompt = "windsurfing sail"
        boxes, logits, phrases = predict(
            model=model, 
            image=img_tensor, 
            caption=text_prompt, 
            box_threshold=confidence_threshold, 
            text_threshold=0.25
        )
        inference_time = time.time() - inference_start
        
        print(f"⏱️ DINO timing: Model={model_time:.2f}s, Load={img_load_time:.2f}s, Inference={inference_time:.2f}s")
        
        # Convert to target resolution coordinates (NO SCALING - already at target!)
        bboxes = []
        centers = []
        
        gd_h, gd_w = img_tensor.shape[1], img_tensor.shape[2]  # DINO processed size
        target_w, target_h = img.size  # Target resolution (same as input)
        
        print(f"🔧 Coordinates: DINO {gd_w}x{gd_h} → Target {target_w}x{target_h}")
        
        # Calculate scale factors (from DINO internal processing to target resolution)
        scale_x = target_w / gd_w
        scale_y = target_h / gd_h
        
        # Convert tensor to numpy if needed
        if hasattr(boxes, 'cpu'):
            boxes = boxes.cpu().numpy()
        
        for i, box in enumerate(boxes):
            # Grounding DINO returns [center_x, center_y, width, height] format
            cx, cy, w, h = box
            
            # Convert center-width-height to x1,y1,x2,y2 (normalized)
            x1, y1 = cx - w/2, cy - h/2
            x2, y2 = cx + w/2, cy + h/2
            
            # Convert normalized coordinates to target resolution pixels
            x1_px = int(x1 * gd_w * scale_x)
            y1_px = int(y1 * gd_h * scale_y)
            x2_px = int(x2 * gd_w * scale_x)
            y2_px = int(y2 * gd_h * scale_y)
            
            # Ensure coordinates are valid
            x1_px, x2_px = min(x1_px, x2_px), max(x1_px, x2_px)
            y1_px, y2_px = min(y1_px, y2_px), max(y1_px, y2_px)
            
            bbox = (x1_px, y1_px, x2_px, y2_px)
            center = ((x1_px + x2_px) // 2, (y1_px + y2_px) // 2)
            
            bboxes.append(bbox)
            centers.append(center)
            
            print(f"  Sail {i+1}: bbox={bbox}, center={center}")
        
        total_time = time.time() - total_start
        print(f"⏱️ DINO total: {total_time:.2f}s, found {len(bboxes)} sails")
        
        return bboxes, centers
        
    finally:
        try:
            os.unlink(temp_path)
        except:
            pass