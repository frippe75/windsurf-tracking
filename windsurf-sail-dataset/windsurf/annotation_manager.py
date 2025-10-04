"""
Annotation Manager - Handle click-prompts and frame annotations
Single source of truth for annotation data management
"""

from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass, asdict
from enum import Enum
import json
import logging

logger = logging.getLogger(__name__)


class PromptType(Enum):
    POSITIVE = "positive"
    NEGATIVE = "negative"


@dataclass
class ClickPrompt:
    """Single click prompt data"""
    x: int
    y: int
    type: PromptType
    sail_id: Optional[int] = None
    confidence: float = 1.0


@dataclass
class FrameAnnotation:
    """Complete annotation data for a single frame"""
    frame_number: int
    timestamp: float
    click_prompts: List[ClickPrompt]
    dino_detections: Optional[Dict] = None
    sam2_results: Optional[Dict] = None
    gpt5_analysis: Optional[Dict] = None
    filter_results: Optional[Dict] = None
    markers: List[str] = None
    events: List[str] = None
    
    def __post_init__(self):
        if self.markers is None:
            self.markers = []
        if self.events is None:
            self.events = []


class AnnotationManager:
    """Manages frame annotations and click-prompts"""
    
    def __init__(self):
        self.frame_annotations = {}  # frame_number -> FrameAnnotation
        self.sail_colors = {
            'sail_1': {'segment': (0, 200, 0, 100), 'bbox': (0, 150, 0), 'center': (0, 100, 0), 'marker': 'lightgreen'},
            'sail_2': {'segment': (0, 100, 200, 100), 'bbox': (0, 80, 160), 'center': (0, 60, 120), 'marker': 'lightblue'},
            'sail_3': {'segment': (200, 100, 0, 100), 'bbox': (160, 80, 0), 'center': (120, 60, 0), 'marker': 'lightcoral'},
            'sail_4': {'segment': (150, 0, 150, 100), 'bbox': (120, 0, 120), 'center': (90, 0, 90), 'marker': 'plum'},
            'sail_5': {'segment': (200, 200, 0, 100), 'bbox': (160, 160, 0), 'center': (120, 120, 0), 'marker': 'lightyellow'}
        }
    
    def get_or_create_annotation(self, frame_number: int, fps: float) -> FrameAnnotation:
        """Get or create frame annotation"""
        
        if frame_number not in self.frame_annotations:
            self.frame_annotations[frame_number] = FrameAnnotation(
                frame_number=frame_number,
                timestamp=frame_number / fps,
                click_prompts=[]
            )
        
        return self.frame_annotations[frame_number]
    
    def add_click_prompt(self, frame_number: int, x: int, y: int, 
                        prompt_type: PromptType, fps: float, sail_id: Optional[int] = None):
        """Add click prompt to frame"""
        
        annotation = self.get_or_create_annotation(frame_number, fps)
        
        prompt = ClickPrompt(
            x=x, y=y, 
            type=prompt_type, 
            sail_id=sail_id
        )
        
        annotation.click_prompts.append(prompt)
        annotation.events.append(f"CLICK: {prompt_type.value} at ({x}, {y})")
        
        logger.debug(f"Added {prompt_type.value} click prompt at ({x}, {y}) to frame {frame_number}")
    
    def get_positive_prompts(self, frame_number: int) -> List[Tuple[int, int]]:
        """Get positive click prompts for frame"""
        
        if frame_number not in self.frame_annotations:
            return []
        
        annotation = self.frame_annotations[frame_number]
        return [(p.x, p.y) for p in annotation.click_prompts if p.type == PromptType.POSITIVE]
    
    def get_negative_prompts(self, frame_number: int) -> List[Tuple[int, int]]:
        """Get negative click prompts for frame"""
        
        if frame_number not in self.frame_annotations:
            return []
        
        annotation = self.frame_annotations[frame_number]
        return [(p.x, p.y) for p in annotation.click_prompts if p.type == PromptType.NEGATIVE]
    
    def get_all_prompts_for_sam2(self, frame_number: int) -> Tuple[List[Tuple], List[int]]:
        """Get all prompts in SAM2 format (points, labels)"""
        
        positive = self.get_positive_prompts(frame_number)
        negative = self.get_negative_prompts(frame_number)
        
        all_points = positive + negative
        all_labels = [1] * len(positive) + [0] * len(negative)
        
        return all_points, all_labels
    
    def add_dino_detection(self, frame_number: int, fps: float, sail_count: int, 
                          bboxes: List, centers: List):
        """Store DINO detection results"""
        
        annotation = self.get_or_create_annotation(frame_number, fps)
        annotation.dino_detections = {
            'sail_count': sail_count,
            'bboxes': bboxes,
            'centers': centers,
            'timestamp': str(datetime.datetime.now())
        }
        annotation.events.append(f"DINO: {sail_count} sails")
    
    def add_sam2_results(self, frame_number: int, fps: float, masks: List, 
                        bboxes: List, centers: List):
        """Store SAM2 segmentation results"""
        
        annotation = self.get_or_create_annotation(frame_number, fps)
        annotation.sam2_results = {
            'mask_count': len(masks),
            'bboxes': bboxes,
            'centers': centers,
            'timestamp': str(datetime.datetime.now())
        }
        annotation.events.append(f"SAM2: {len(masks)} masks")
    
    def add_marker(self, frame_number: int, fps: float, marker_type: str):
        """Add marker to frame (START, STOP, SKIP)"""
        
        annotation = self.get_or_create_annotation(frame_number, fps)
        annotation.markers.append(marker_type)
        annotation.events.append(f"MARKER: {marker_type}")
    
    def get_annotated_frames(self) -> Dict[int, FrameAnnotation]:
        """Get all frames with annotations"""
        return self.frame_annotations.copy()
    
    def export_annotations(self, format_type: str = "native") -> Dict:
        """Export annotations in specified format"""
        
        if format_type == "native":
            return {
                'format': 'windsurf_native',
                'version': '1.0',
                'annotations': {
                    str(frame_num): asdict(annotation) 
                    for frame_num, annotation in self.frame_annotations.items()
                }
            }
        elif format_type == "coco":
            # TODO: Implement COCO format export
            raise NotImplementedError("COCO export not implemented yet")
        else:
            raise ValueError(f"Unsupported export format: {format_type}")
    
    def import_annotations(self, data: Dict):
        """Import annotations from exported data"""
        
        if data.get('format') == 'windsurf_native':
            for frame_num_str, annotation_dict in data['annotations'].items():
                frame_num = int(frame_num_str)
                
                # Reconstruct ClickPrompt objects
                click_prompts = []
                for prompt_dict in annotation_dict.get('click_prompts', []):
                    prompt = ClickPrompt(
                        x=prompt_dict['x'],
                        y=prompt_dict['y'],
                        type=PromptType(prompt_dict['type']),
                        sail_id=prompt_dict.get('sail_id'),
                        confidence=prompt_dict.get('confidence', 1.0)
                    )
                    click_prompts.append(prompt)
                
                # Reconstruct FrameAnnotation
                annotation = FrameAnnotation(
                    frame_number=annotation_dict['frame_number'],
                    timestamp=annotation_dict['timestamp'],
                    click_prompts=click_prompts,
                    dino_detections=annotation_dict.get('dino_detections'),
                    sam2_results=annotation_dict.get('sam2_results'),
                    gpt5_analysis=annotation_dict.get('gpt5_analysis'),
                    filter_results=annotation_dict.get('filter_results'),
                    markers=annotation_dict.get('markers', []),
                    events=annotation_dict.get('events', [])
                )
                
                self.frame_annotations[frame_num] = annotation
        else:
            raise ValueError(f"Unsupported import format: {data.get('format')}")


# Global annotation manager instance
annotation_manager = AnnotationManager()