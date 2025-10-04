"""
Windsurf Sail Dataset Package
Pure business logic for windsurf sail detection and tracking
"""

__version__ = "1.0.0"

# Core detection and tracking
from .grounding_dino import detect_sails
from .sail_tracking import track_objects_in_video, track_sails_in_video  # track_sails_in_video is deprecated
from .scene_detection import detect_scenes, get_video_info, generate_overlapping_segments

# Utilities
from .utils import create_filename, draw_colored_masks
from .youtube_utils import download_youtube_clip, extract_frames_from_video
from .coordinate_transform import CoordinateTransformer
from .resolution_manager import resolution_manager
from .config import *

__all__ = [
    # Detection
    "detect_sails",
    "track_objects_in_video",
    "track_sails_in_video",  # deprecated
    # Scene processing
    "detect_scenes", 
    "get_video_info",
    "generate_overlapping_segments",
    # Utilities
    "create_filename",
    "draw_colored_masks", 
    "download_youtube_clip",
    "extract_frames_from_video",
    "CoordinateTransformer",
    "resolution_manager"
]