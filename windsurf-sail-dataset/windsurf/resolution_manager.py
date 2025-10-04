"""
Centralized resolution management for the entire pipeline
"""

import os
from PIL import Image
from typing import Tuple

def get_target_resolution() -> Tuple[int, int]:
    """Get target resolution from environment variables."""
    width = int(os.getenv('TARGET_WIDTH', '1280'))
    height = int(os.getenv('TARGET_HEIGHT', '720'))
    return (width, height)

class ResolutionManager:
    """Centralized resolution management for the entire pipeline."""
    
    def __init__(self):
        self.target_width, self.target_height = get_target_resolution()
        self.target_size = (self.target_width, self.target_height)
        
        print(f"🎯 Target resolution: {self.target_width}x{self.target_height}")
    
    def standardize_image(self, img: Image.Image, method=Image.Resampling.LANCZOS) -> Image.Image:
        """Scale any input image to target resolution with aspect ratio preservation."""
        if img.size == self.target_size:
            return img
        
        # Calculate scaling to fit within target size while preserving aspect ratio
        img_ratio = img.width / img.height
        target_ratio = self.target_width / self.target_height
        
        if img_ratio > target_ratio:
            # Image is wider - scale by width
            new_width = self.target_width
            new_height = int(self.target_width / img_ratio)
        else:
            # Image is taller - scale by height  
            new_height = self.target_height
            new_width = int(self.target_height * img_ratio)
        
        # Resize to calculated dimensions
        scaled_img = img.resize((new_width, new_height), method)
        
        # Create target size image with black padding if needed
        if (new_width, new_height) != self.target_size:
            target_img = Image.new('RGB', self.target_size, (0, 0, 0))
            
            # Center the scaled image
            x_offset = (self.target_width - new_width) // 2
            y_offset = (self.target_height - new_height) // 2
            target_img.paste(scaled_img, (x_offset, y_offset))
            
            print(f"🔧 Scaled {img.size} → {new_width}x{new_height} → padded to {self.target_size}")
            return target_img
        else:
            print(f"🔧 Scaled {img.size} → {self.target_size}")
            return scaled_img
    
    def get_scaling_info(self, original_size: Tuple[int, int]) -> dict:
        """Get scaling information for debugging."""
        return {
            "original_size": original_size,
            "target_size": self.target_size,
            "scale_x": self.target_width / original_size[0],
            "scale_y": self.target_height / original_size[1]
        }

# Global resolution manager instance
resolution_manager = ResolutionManager()