"""
Video Manager - Single source of truth for video operations
Handles video metadata extraction, frame extraction, and file management
"""

import os
import cv2
import uuid
from pathlib import Path
from typing import Dict, Optional, Tuple
from PIL import Image
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


class VideoManager:
    """Manages video files, metadata extraction, and frame operations"""
    
    def __init__(self, upload_dir: str = "uploads"):
        self.upload_dir = Path(upload_dir)
        self.upload_dir.mkdir(exist_ok=True)
        
    def save_uploaded_video(self, filename: str, file_content: bytes) -> Dict:
        """
        Save uploaded video file and extract metadata
        
        Args:
            filename: Original filename
            file_content: Video file bytes
            
        Returns:
            Video metadata dictionary
        """
        
        # Validate file extension
        video_extensions = {'.mp4', '.avi', '.mov', '.mkv', '.webm', '.m4v'}
        file_extension = Path(filename).suffix.lower()
        
        if file_extension not in video_extensions:
            raise ValueError(f"Unsupported file type: {file_extension}. Supported: {video_extensions}")
        
        # Generate unique video ID and save file
        video_id = str(uuid.uuid4())
        file_path = self.upload_dir / f"{video_id}{file_extension}"
        
        try:
            # Save file
            with open(file_path, "wb") as f:
                f.write(file_content)
            
            # Extract metadata
            metadata = self.extract_video_metadata(str(file_path))
            metadata.update({
                'video_id': video_id,
                'filename': filename,
                'file_path': str(file_path)
            })
            
            logger.info(f"Video saved: {video_id} ({filename})")
            return metadata
            
        except Exception as e:
            # Cleanup on error
            if file_path.exists():
                file_path.unlink()
            raise Exception(f"Video processing failed: {e}")
    
    def extract_video_metadata(self, video_path: str) -> Dict:
        """
        Extract video metadata using OpenCV
        
        Args:
            video_path: Path to video file
            
        Returns:
            Video metadata dictionary
        """
        
        cap = cv2.VideoCapture(video_path)
        
        if not cap.isOpened():
            raise ValueError(f"Cannot open video: {video_path}")
        
        try:
            fps = cap.get(cv2.CAP_PROP_FPS)
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            duration = total_frames / fps if fps > 0 else 0
            
            metadata = {
                'duration': duration,
                'fps': fps,
                'width': width,
                'height': height,
                'total_frames': total_frames,
                'resolution': f"{width}x{height}"
            }
            
            logger.debug(f"Video metadata: {metadata}")
            return metadata
            
        finally:
            cap.release()
    
    def extract_frame(self, video_path: str, frame_number: int, 
                     resize: Optional[Tuple[int, int]] = None) -> Image.Image:
        """
        Extract specific frame as PIL Image
        
        Args:
            video_path: Path to video file
            frame_number: Frame number to extract
            resize: Optional (width, height) for resizing
            
        Returns:
            PIL Image of the frame
        """
        
        cap = cv2.VideoCapture(video_path)
        
        if not cap.isOpened():
            raise ValueError(f"Cannot open video: {video_path}")
        
        try:
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            
            if frame_number < 0 or frame_number >= total_frames:
                raise ValueError(f"Frame {frame_number} out of range (0-{total_frames-1})")
            
            # Extract frame
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
            ret, frame = cap.read()
            
            if not ret:
                raise ValueError(f"Could not extract frame {frame_number}")
            
            # Convert to RGB and PIL Image
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            pil_frame = Image.fromarray(frame_rgb)
            
            # Resize if requested
            if resize:
                pil_frame = pil_frame.resize(resize, Image.LANCZOS)
            
            logger.debug(f"Extracted frame {frame_number} from {video_path}")
            return pil_frame
            
        finally:
            cap.release()
    
    def frame_to_png_bytes(self, frame: Image.Image) -> bytes:
        """
        Convert PIL Image to PNG bytes for API response
        
        Args:
            frame: PIL Image
            
        Returns:
            PNG bytes
        """
        
        import io
        
        img_buffer = io.BytesIO()
        frame.save(img_buffer, format='PNG')
        img_buffer.seek(0)
        
        return img_buffer.read()
    
    def delete_video(self, video_path: str):
        """
        Delete video file and cleanup
        
        Args:
            video_path: Path to video file to delete
        """
        
        try:
            file_path = Path(video_path)
            if file_path.exists():
                file_path.unlink()
                logger.info(f"Video deleted: {video_path}")
            else:
                logger.warning(f"Video file not found: {video_path}")
                
        except Exception as e:
            logger.error(f"Video deletion failed: {e}")
            raise


# Global video manager instance
video_manager = VideoManager()


# Convenience functions for easy import
def save_uploaded_video(filename: str, file_content: bytes) -> Dict:
    """Convenience function for video upload"""
    return video_manager.save_uploaded_video(filename, file_content)


def extract_frame(video_path: str, frame_number: int, resize: Optional[Tuple[int, int]] = None) -> Image.Image:
    """Convenience function for frame extraction"""
    return video_manager.extract_frame(video_path, frame_number, resize)


def extract_video_metadata(video_path: str) -> Dict:
    """Convenience function for metadata extraction"""
    return video_manager.extract_video_metadata(video_path)