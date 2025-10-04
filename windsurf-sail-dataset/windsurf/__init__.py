"""
Windsurf Sail Dataset Package
Pure business logic for windsurf sail detection and tracking
"""

__version__ = "1.0.0"

# Import main components
from .scene_detection import detect_scenes, get_video_info, generate_overlapping_segments
from .sail_tracking import track_sails_in_video  
from .utils import create_filename, draw_colored_masks

__all__ = [
    "detect_scenes",
    "get_video_info",
    "generate_overlapping_segments", 
    "track_sails_in_video",
    "create_filename",
    "draw_colored_masks"
]