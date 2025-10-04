"""
Proper coordinate transformation between all systems in the pipeline
"""

import numpy as np
from typing import Tuple, List

class CoordinateTransformer:
    """Handle all coordinate transformations in the pipeline"""
    
    def __init__(self, target_size=(1280, 720), video_size=(640, 360), sam2_size=1024):
        self.target_w, self.target_h = target_size
        self.video_w, self.video_h = video_size
        self.sam2_size = sam2_size
        
        # Calculate SAM2 video internal padding
        aspect = self.video_w / self.video_h
        if aspect > 1:  # Wider than tall
            self.sam2_scale = sam2_size / self.video_w
            self.sam2_content_h = int(self.video_h * self.sam2_scale)
            self.sam2_content_w = sam2_size
            self.sam2_pad_top = (sam2_size - self.sam2_content_h) // 2
            self.sam2_pad_left = 0
        else:  # Taller than wide
            self.sam2_scale = sam2_size / self.video_h
            self.sam2_content_w = int(self.video_w * self.sam2_scale)
            self.sam2_content_h = sam2_size
            self.sam2_pad_top = 0
            self.sam2_pad_left = (sam2_size - self.sam2_content_w) // 2
            
        print(f"📐 Coordinate Transformer initialized:")
        print(f"  Target: {self.target_w}×{self.target_h}")
        print(f"  Video: {self.video_w}×{self.video_h}")
        print(f"  SAM2: {sam2_size}×{sam2_size} (content: {self.sam2_content_w}×{self.sam2_content_h})")
        print(f"  SAM2 padding: top={self.sam2_pad_top}, left={self.sam2_pad_left}")
    
    def target_to_video(self, point: Tuple[int, int]) -> Tuple[int, int]:
        """Transform from target resolution to video resolution"""
        scale_x = self.video_w / self.target_w
        scale_y = self.video_h / self.target_h
        return (int(point[0] * scale_x), int(point[1] * scale_y))
    
    def video_to_target(self, point: Tuple[int, int]) -> Tuple[int, int]:
        """Transform from video resolution to target resolution"""
        scale_x = self.target_w / self.video_w
        scale_y = self.target_h / self.video_h
        return (int(point[0] * scale_x), int(point[1] * scale_y))
    
    def video_to_sam2(self, point: Tuple[int, int]) -> Tuple[float, float]:
        """Transform from video coords to SAM2 1024×1024 coords WITH PADDING"""
        x = point[0] * self.sam2_scale + self.sam2_pad_left
        y = point[1] * self.sam2_scale + self.sam2_pad_top
        return (x, y)
    
    def target_to_sam2(self, point: Tuple[int, int]) -> Tuple[float, float]:
        """Transform from target coords to SAM2 1024×1024 coords"""
        # First to video
        video_point = self.target_to_video(point)
        # Then to SAM2
        return self.video_to_sam2(video_point)
    
    def sam2_to_video(self, point: Tuple[float, float]) -> Tuple[int, int]:
        """Transform from SAM2 1024×1024 coords back to video coords"""
        x = (point[0] - self.sam2_pad_left) / self.sam2_scale
        y = (point[1] - self.sam2_pad_top) / self.sam2_scale
        return (int(x), int(y))
    
    def sam2_to_target(self, point: Tuple[float, float]) -> Tuple[int, int]:
        """Transform from SAM2 coords back to target coords"""
        video_point = self.sam2_to_video(point)
        return self.video_to_target(video_point)


# Test the transformer
if __name__ == "__main__":
    transformer = CoordinateTransformer()
    
    # Test with the problematic point
    target_point = (708, 232)
    print(f"\nTest point in target: {target_point}")
    
    video_point = transformer.target_to_video(target_point)
    print(f"→ Video coords: {video_point}")
    
    sam2_point = transformer.target_to_sam2(target_point)
    print(f"→ SAM2 coords: {sam2_point}")
    
    # Compare with naive approach
    naive_x = video_point[0] / 640 * 1024
    naive_y = video_point[1] / 360 * 1024
    print(f"Naive approach would give: ({naive_x:.1f}, {naive_y:.1f})")
    print(f"Difference: Y off by {sam2_point[1] - naive_y:.1f} pixels")