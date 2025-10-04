"""
Real scene detection using PySceneDetect
Single source of truth for scene boundary detection
"""

from typing import List, Dict, Tuple
from dataclasses import dataclass
import logging

logger = logging.getLogger(__name__)


@dataclass
class DetectedScene:
    """Scene boundary data"""
    scene_id: int
    start_frame: int
    end_frame: int
    start_time: float
    end_time: float
    duration: float
    quality: str = "unknown"  # unknown, good, bad


class SceneDetector:
    """Real scene detection using PySceneDetect"""
    
    def __init__(self, threshold: float = 30.0, min_scene_length: int = 15):
        """
        Initialize scene detector
        
        Args:
            threshold: Scene change sensitivity (higher = fewer scenes)
            min_scene_length: Minimum scene duration in frames
        """
        self.threshold = threshold
        self.min_scene_length = min_scene_length
    
    def detect_scenes(self, video_path: str) -> List[DetectedScene]:
        """
        Detect real scene boundaries using PySceneDetect
        
        Args:
            video_path: Path to video file
            
        Returns:
            List of detected scenes with boundaries
        """
        
        try:
            from scenedetect import detect, ContentDetector
            import cv2
            
            logger.info(f"Running PySceneDetect on {video_path}")
            
            # Get video info for frame conversion
            cap = cv2.VideoCapture(video_path)
            fps = cap.get(cv2.CAP_PROP_FPS)
            cap.release()
            
            # Run PySceneDetect
            scene_list = detect(
                video_path, 
                ContentDetector(threshold=self.threshold)
            )
            
            logger.info(f"PySceneDetect found {len(scene_list)} scenes")
            
            # Convert to internal format
            detected_scenes = []
            for i, (start_time, end_time) in enumerate(scene_list):
                start_seconds = start_time.get_seconds()
                end_seconds = end_time.get_seconds()
                duration = end_seconds - start_seconds
                
                # Convert to frame numbers
                start_frame = int(start_seconds * fps)
                end_frame = int(end_seconds * fps)
                
                scene = DetectedScene(
                    scene_id=i + 1,
                    start_frame=start_frame,
                    end_frame=end_frame,
                    start_time=start_seconds,
                    end_time=end_seconds,
                    duration=duration
                )
                detected_scenes.append(scene)
            
            logger.info(f"Scene detection complete: {len(detected_scenes)} scenes")
            return detected_scenes
            
        except Exception as e:
            logger.error(f"Scene detection failed: {e}")
            raise


def detect_scenes_api_format(video_path: str) -> Dict:
    """
    Detect scenes and return in API-friendly format
    
    Args:
        video_path: Path to video file
        
    Returns:
        API response with scenes data
    """
    
    detector = SceneDetector()
    scenes = detector.detect_scenes(video_path)
    
    return {
        'total_scenes': len(scenes),
        'scenes': [
            {
                'scene_id': scene.scene_id,
                'start_frame': scene.start_frame,
                'end_frame': scene.end_frame, 
                'start_time': scene.start_time,
                'end_time': scene.end_time,
                'duration': scene.duration,
                'quality': scene.quality
            }
            for scene in scenes
        ],
        'detection_method': 'PySceneDetect ContentDetector',
        'threshold': detector.threshold
    }