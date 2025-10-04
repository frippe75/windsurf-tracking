"""
Configuration settings using environment variables
"""

import os
from typing import Tuple

def get_color_from_env(env_var: str, default_color: str) -> Tuple[int, int, int]:
    """Convert color name from environment to RGB tuple."""
    color_name = os.getenv(env_var, default_color).upper()
    
    color_map = {
        'RED': (255, 0, 0),
        'GREEN': (0, 255, 0),
        'BLUE': (0, 0, 255),
        'YELLOW': (255, 255, 0),
        'MAGENTA': (255, 0, 255),
        'CYAN': (0, 255, 255),
        'ORANGE': (255, 128, 0),
        'WHITE': (255, 255, 255),
        'BLACK': (0, 0, 0),
    }
    
    return color_map.get(color_name, color_map[default_color])

def get_int_from_env(env_var: str, default_value: int) -> int:
    """Get integer value from environment variable."""
    try:
        return int(os.getenv(env_var, str(default_value)))
    except ValueError:
        return default_value

# First frame annotations (DINO detection)
FIRST_FRAME_BBOX_COLOR = get_color_from_env('FIRST_FRAME_BBOX_COLOR', 'YELLOW')
FIRST_FRAME_CIRCLE_COLOR = get_color_from_env('FIRST_FRAME_CIRCLE_COLOR', 'YELLOW')
FIRST_FRAME_BBOX_WIDTH = get_int_from_env('FIRST_FRAME_BBOX_WIDTH', 5)
FIRST_FRAME_CIRCLE_DIAMETER = get_int_from_env('FIRST_FRAME_CIRCLE_DIAMETER', 30)

# SAM2 refinement masks
SAM2_MASK_COLOR = get_color_from_env('SAM2_MASK_COLOR', 'RED')
SAM2_MASK_OPACITY = float(os.getenv('SAM2_MASK_OPACITY', '0.3'))

# Tracking annotations (SAM2 video tracking)
TRACK_MASK_COLOR = get_color_from_env('TRACK_MASK_COLOR', 'GREEN')
TRACK_BBOX_COLOR = get_color_from_env('TRACK_BBOX_COLOR', 'GREEN')
TRACK_CIRCLE_COLOR = get_color_from_env('TRACK_CIRCLE_COLOR', 'GREEN')
TRACK_BBOX_WIDTH = get_int_from_env('TRACK_BBOX_WIDTH', 3)
TRACK_CIRCLE_DIAMETER = get_int_from_env('TRACK_CIRCLE_DIAMETER', 20)
TRACK_MASK_OPACITY = float(os.getenv('TRACK_MASK_OPACITY', '0.4'))

# Smart correction
CORRECTED_CENTER_COLOR = get_color_from_env('CORRECTED_CENTER_COLOR', 'GREEN')
UNCHANGED_CENTER_COLOR = get_color_from_env('UNCHANGED_CENTER_COLOR', 'YELLOW')

# Resolution settings
TARGET_WIDTH = get_int_from_env('TARGET_WIDTH', 1280)
TARGET_HEIGHT = get_int_from_env('TARGET_HEIGHT', 720)

print(f"🎨 Config loaded:")
print(f"   Target resolution: {TARGET_WIDTH}x{TARGET_HEIGHT}")
print(f"   First frame: bbox={FIRST_FRAME_BBOX_COLOR}, circle={FIRST_FRAME_CIRCLE_COLOR}")
print(f"   SAM2 mask: {SAM2_MASK_COLOR} (opacity={SAM2_MASK_OPACITY})")
print(f"   Tracking: bbox={TRACK_BBOX_COLOR}, circle={TRACK_CIRCLE_COLOR}, mask={TRACK_MASK_COLOR}")
print(f"   Smart correction: unchanged={UNCHANGED_CENTER_COLOR}, corrected={CORRECTED_CENTER_COLOR}")