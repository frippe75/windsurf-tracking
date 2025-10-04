"""
AI Models Manager - Persistent model loading and inference
Single source of truth for DINO, GPT-5, and SAM2 models
"""

import os
import sys
import torch
import numpy as np
from typing import List, Tuple, Dict, Optional
from PIL import Image
import logging

logger = logging.getLogger(__name__)


class ModelManager:
    """Manages persistent AI model instances for low-latency inference"""
    
    def __init__(self):
        self.models = {}
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        logger.info(f"ModelManager initialized on device: {self.device}")
    
    def load_dino_model(self):
        """Load DINO detection model (lazy loading)"""
        
        if 'dino' not in self.models:
            print("🔧 Loading model: DINO Detection Model")
            try:
                # Use working DINO from src
                original_cwd = os.getcwd()
                os.chdir('/home/frta/windsurf-sail-dataset')
                sys.path.insert(0, '/home/frta/windsurf-sail-dataset/src')
                
                from grounding_dino import detect_sails
                
                # Test model load
                test_image = Image.new('RGB', (640, 360), color='blue')
                detect_sails(test_image, confidence_threshold=0.3)  # Trigger model load
                
                self.models['dino'] = detect_sails
                logger.info("DINO model loaded successfully")
                
                os.chdir(original_cwd)
                
            except Exception as e:
                logger.error(f"Failed to load DINO model: {e}")
                raise
    
    def load_sam2_image_model(self):
        """Load SAM2 image predictor (lazy loading)"""
        
        if 'sam2_image' not in self.models:
            print("🔧 Loading model: SAM2 Image Predictor (Hiera-Tiny)")
            try:
                from sam2.sam2_image_predictor import SAM2ImagePredictor
                
                # Use local cached model
                sam2_predictor = SAM2ImagePredictor.from_pretrained(
                    "facebook/sam2-hiera-tiny", 
                    device=self.device
                )
                
                self.models['sam2_image'] = sam2_predictor
                logger.info("SAM2 image predictor loaded successfully")
                
            except Exception as e:
                logger.error(f"Failed to load SAM2 image model: {e}")
                raise
    
    def load_sam2_video_model(self):
        """Load SAM2 video predictor (lazy loading)"""
        
        if 'sam2_video' not in self.models:
            print("🔧 Loading model: SAM2 Video Predictor (Hiera-Tiny) - AI MODELS MANAGER")
            try:
                # Change to facebook-sam2 directory for relative paths
                original_cwd = os.getcwd()
                os.chdir('/home/frta/windsurf-sail-dataset/facebook-sam2')
                
                from sam2.build_sam import build_sam2_video_predictor
                
                config_path = "configs/sam2.1/sam2.1_hiera_t.yaml"
                checkpoint_path = "checkpoints/sam2.1_hiera_tiny.pt"
                
                sam2_tracker = build_sam2_video_predictor(
                    config_path, 
                    checkpoint_path, 
                    device=self.device
                )
                
                self.models['sam2_video'] = sam2_tracker
                logger.info("SAM2 video tracker loaded successfully")
                
                os.chdir(original_cwd)
                
            except Exception as e:
                logger.error(f"Failed to load SAM2 video model: {e}")
                raise
    
    def get_dino_model(self):
        """Get DINO model (load if needed)"""
        if 'dino' not in self.models:
            self.load_dino_model()
        return self.models['dino']
    
    def get_sam2_image_model(self):
        """Get SAM2 image model (load if needed)"""
        if 'sam2_image' not in self.models:
            self.load_sam2_image_model()
        return self.models['sam2_image']
    
    def get_sam2_video_model(self):
        """Get SAM2 video model (load if needed)"""
        if 'sam2_video' not in self.models:
            self.load_sam2_video_model()
        return self.models['sam2_video']
    
    def detect_sails_in_frame(self, frame: Image.Image, confidence_threshold: float = 0.3) -> Tuple[int, List, List]:
        """
        Detect sails using DINO model
        
        Returns:
            Tuple of (sail_count, bboxes, centers)
        """
        
        detect_sails = self.get_dino_model()
        
        try:
            bboxes, centers = detect_sails(frame, confidence_threshold)
            return len(centers), bboxes, centers
        except Exception as e:
            logger.error(f"DINO detection failed: {e}")
            return 0, [], []
    
    def segment_frame_with_prompts(self, frame: Image.Image, positive_points: List[Tuple], 
                                  negative_points: List[Tuple] = None) -> Dict:
        """
        Segment frame using SAM2 with positive/negative prompts
        
        Args:
            frame: PIL Image
            positive_points: List of (x, y) positive click points
            negative_points: List of (x, y) negative click points
            
        Returns:
            Segmentation results with masks, bboxes, centers
        """
        
        sam2_predictor = self.get_sam2_image_model()
        
        if negative_points is None:
            negative_points = []
        
        try:
            # Set image
            img_array = np.array(frame)
            sam2_predictor.set_image(img_array)
            
            # Combine prompts
            all_points = positive_points + negative_points
            all_labels = [1] * len(positive_points) + [0] * len(negative_points)
            
            if not all_points:
                return {'success': False, 'error': 'No click points provided'}
            
            # Run segmentation
            mask_output, scores, logits = sam2_predictor.predict(
                point_coords=np.array(all_points),
                point_labels=np.array(all_labels),
                multimask_output=True
            )
            
            # Find best mask that contains a positive click
            best_mask = None
            best_score = -1
            
            for mask, score in zip(mask_output, scores):
                # Check if mask contains any positive clicks
                for pos_point in positive_points:
                    if mask[pos_point[1], pos_point[0]]:  # Contains click
                        if score > best_score:
                            best_mask = mask
                            best_score = score
                            break
            
            # Fallback to highest score
            if best_mask is None:
                best_mask = mask_output[np.argmax(scores)]
            
            # Calculate bbox and center
            y_indices, x_indices = np.where(best_mask)
            if len(x_indices) > 0:
                x1, x2 = int(x_indices.min()), int(x_indices.max())
                y1, y2 = int(y_indices.min()), int(y_indices.max())
                bbox = (x1, y1, x2, y2)
                center = (int(x_indices.mean()), int(y_indices.mean()))
            else:
                bbox = None
                center = None
            
            return {
                'success': True,
                'mask': best_mask,
                'bbox': bbox,
                'center': center,
                'score': float(best_score),
                'positive_points': positive_points,
                'negative_points': negative_points
            }
            
        except Exception as e:
            logger.error(f"SAM2 segmentation failed: {e}")
            return {'success': False, 'error': str(e)}


# Global model manager instance (singleton)
model_manager = ModelManager()


# Convenience functions for easy import
def detect_sails_in_frame(frame: Image.Image, confidence_threshold: float = 0.3) -> Tuple[int, List, List]:
    """Convenience function for DINO detection"""
    return model_manager.detect_sails_in_frame(frame, confidence_threshold)


def segment_frame_with_prompts(frame: Image.Image, positive_points: List[Tuple], 
                              negative_points: List[Tuple] = None) -> Dict:
    """Convenience function for SAM2 segmentation"""
    return model_manager.segment_frame_with_prompts(frame, positive_points, negative_points)


def preload_all_models():
    """Preload all AI models for immediate response"""
    logger.info("Preloading all AI models...")
    print("🔧 Loading model: BACKEND STARTUP - Loading all models")
    
    model_manager.load_dino_model()
    model_manager.load_sam2_image_model()
    # DON'T preload video model - tracking jobs will load their own
    # model_manager.load_sam2_video_model()
    print("🔧 Loading model: BACKEND STARTUP - Skipping SAM2 Video (loaded per tracking job)")
    
    logger.info("Backend models preloaded successfully (DINO + SAM2 Image only)")