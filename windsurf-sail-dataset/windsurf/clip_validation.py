"""
Clip validation orchestrator - runs multiple filters to determine tracking viability
"""

from typing import Dict, List, Tuple, Optional, Callable
from .detection_utils import ScrubConfig
from .filters import filter_sail_count, filter_on_water


class ClipValidator:
    """Orchestrates multiple validation filters for clip assessment"""
    
    def __init__(self, scrub_config: Optional[ScrubConfig] = None):
        """
        Initialize validator with scrubbing configuration.
        
        Args:
            scrub_config: Frame sampling configuration
        """
        self.scrub_config = scrub_config or ScrubConfig()
        
        # Default filter set (can be customized)
        self.filters = [
            filter_sail_count,
            filter_on_water
        ]
    
    def validate_clip(self, video_path: str, start_frame: int, end_frame: int) -> Dict:
        """
        Run all validation filters on a clip.
        
        Args:
            video_path: Path to source video
            start_frame: Starting frame of clip
            end_frame: Ending frame of clip
            
        Returns:
            Comprehensive validation results
        """
        
        print(f"Validating clip: frames {start_frame}-{end_frame}")
        
        validation_results = {
            'clip_info': {
                'video_path': video_path,
                'start_frame': start_frame,
                'end_frame': end_frame,
                'duration_frames': end_frame - start_frame
            },
            'scrub_config': {
                'scrub_interval': self.scrub_config.scrub_interval,
                'max_attempts': self.scrub_config.max_scrub_attempts
            },
            'filter_results': {},
            'overall_decision': 'PENDING'
        }
        
        # Run each filter
        all_passed = True
        total_confidence = 0.0
        best_tracking_data = None
        
        for filter_func in self.filters:
            filter_name = filter_func.__name__
            
            try:
                passed, confidence, reason, extra_data = filter_func(
                    video_path, start_frame, end_frame, self.scrub_config
                )
                
                validation_results['filter_results'][filter_name] = {
                    'passed': passed,
                    'confidence': confidence,
                    'reason': reason,
                    'extra_data': extra_data
                }
                
                print(f"  {filter_name}: {'PASS' if passed else 'FAIL'} (conf={confidence:.2f}) - {reason}")
                
                # Track overall decision
                if not passed:
                    all_passed = False
                
                total_confidence += confidence
                
                # Collect best tracking frame info
                if extra_data and 'best_tracking_frame' in str(extra_data):
                    best_tracking_data = extra_data
                
                # Early exit if confidence is very low
                if confidence < self.scrub_config.early_reject_threshold:
                    print(f"  Early reject: {filter_name} confidence {confidence:.2f} < {self.scrub_config.early_reject_threshold}")
                    break
                    
            except Exception as e:
                print(f"  {filter_name}: ERROR - {e}")
                validation_results['filter_results'][filter_name] = {
                    'passed': False,
                    'confidence': 0.0,
                    'reason': f"Filter error: {e}",
                    'extra_data': None
                }
                all_passed = False
        
        # Calculate overall metrics
        num_filters = len(validation_results['filter_results'])
        avg_confidence = total_confidence / num_filters if num_filters > 0 else 0.0
        
        # Make final decision
        if all_passed and avg_confidence > 0.6:
            decision = 'ACCEPT'
        elif avg_confidence < 0.3:
            decision = 'REJECT'
        else:
            decision = 'UNCERTAIN'
        
        validation_results.update({
            'overall_decision': decision,
            'overall_confidence': avg_confidence,
            'filters_passed': sum(1 for r in validation_results['filter_results'].values() if r['passed']),
            'total_filters': num_filters,
            'best_tracking_frame': best_tracking_data
        })
        
        print(f"  DECISION: {decision} (confidence={avg_confidence:.2f})")
        
        return validation_results
    
    def add_filter(self, filter_func: Callable) -> None:
        """Add a custom filter function to the validation pipeline"""
        self.filters.append(filter_func)
    
    def remove_filter(self, filter_name: str) -> None:
        """Remove a filter by function name"""
        self.filters = [f for f in self.filters if f.__name__ != filter_name]


def validate_clip_for_tracking(video_path: str, start_frame: int, end_frame: int,
                              scrub_config: Optional[ScrubConfig] = None) -> Dict:
    """
    Convenience function for single clip validation.
    
    Args:
        video_path: Path to source video
        start_frame: Starting frame of clip
        end_frame: Ending frame of clip
        scrub_config: Optional scrubbing configuration
        
    Returns:
        Validation results dictionary
    """
    
    validator = ClipValidator(scrub_config)
    return validator.validate_clip(video_path, start_frame, end_frame)


def validate_multiple_clips(segments_data: Dict, scrub_config: Optional[ScrubConfig] = None) -> Dict:
    """
    Validate multiple clips from Stage 1 output.
    
    Args:
        segments_data: Complete Stage 1 output with all segments
        scrub_config: Optional scrubbing configuration
        
    Returns:
        Validation summary with accepted/rejected clips
    """
    
    validator = ClipValidator(scrub_config)
    source_video = segments_data['source_video']['path']
    
    results = {
        'total_clips': len(segments_data['segments']),
        'validated_clips': [],
        'accepted_clips': [],
        'rejected_clips': [],
        'uncertain_clips': []
    }
    
    print(f"Validating {results['total_clips']} clips...")
    
    for i, segment in enumerate(segments_data['segments']):
        print(f"\\nClip {i+1}/{results['total_clips']}: {segment['clip_id']}")
        
        validation = validator.validate_clip(
            source_video,
            segment['start_frame'], 
            segment['end_frame']
        )
        
        # Add segment info to validation
        validation['segment'] = segment
        validation['segment_index'] = i
        
        results['validated_clips'].append(validation)
        
        # Categorize by decision
        decision = validation['overall_decision']
        if decision == 'ACCEPT':
            results['accepted_clips'].append(validation)
        elif decision == 'REJECT':
            results['rejected_clips'].append(validation)
        else:
            results['uncertain_clips'].append(validation)
    
    # Summary statistics
    results['acceptance_rate'] = len(results['accepted_clips']) / results['total_clips']
    results['rejection_rate'] = len(results['rejected_clips']) / results['total_clips']
    
    print(f"\\nValidation Summary:")
    print(f"  Accepted: {len(results['accepted_clips'])}/{results['total_clips']} ({results['acceptance_rate']:.1%})")
    print(f"  Rejected: {len(results['rejected_clips'])}/{results['total_clips']} ({results['rejection_rate']:.1%})")
    print(f"  Uncertain: {len(results['uncertain_clips'])}/{results['total_clips']}")
    
    return results