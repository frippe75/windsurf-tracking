"""
Frame specification parser for test data
Supports flexible syntax: 864, 864,900,936, 864-1056, 864-1056:25, etc.
"""

from typing import List, Union


def parse_frame_spec(frame_spec: Union[str, int]) -> List[int]:
    """
    Parse flexible frame specification into list of frame numbers.
    
    Supported formats:
    - Single frame: 864 or "864"
    - Multiple frames: "864,900,936"
    - Frame range: "864-1056" 
    - Range with step: "864-1056:25"
    - Mixed: "100,200,500-600:10,800"
    
    Args:
        frame_spec: Frame specification string or integer
        
    Returns:
        List of frame numbers
    """
    
    if isinstance(frame_spec, int):
        return [frame_spec]
    
    if isinstance(frame_spec, str):
        frame_spec = frame_spec.strip()
    else:
        raise ValueError(f"Invalid frame spec type: {type(frame_spec)}")
    
    frames = []
    
    # Split by comma for multiple specifications
    parts = frame_spec.split(',')
    
    for part in parts:
        part = part.strip()
        
        if '-' in part and ':' in part:
            # Range with step: "864-1056:25"
            range_part, step_str = part.split(':')
            start_str, end_str = range_part.split('-')
            start_frame = int(start_str)
            end_frame = int(end_str)
            step = int(step_str)
            
            frames.extend(range(start_frame, end_frame + 1, step))
            
        elif '-' in part:
            # Simple range: "864-1056"
            start_str, end_str = part.split('-')
            start_frame = int(start_str)
            end_frame = int(end_str)
            
            frames.extend(range(start_frame, end_frame + 1))
            
        else:
            # Single frame: "864"
            frames.append(int(part))
    
    # Remove duplicates and sort
    frames = sorted(list(set(frames)))
    
    return frames


def parse_test_scenario_frames(test_scenario: dict) -> List[int]:
    """
    Parse frames from test scenario configuration.
    
    Args:
        test_scenario: Test scenario dict from YAML
        
    Returns:
        List of frame numbers to test
    """
    
    frame_spec = test_scenario.get('frames')
    if frame_spec is None:
        raise ValueError(f"No 'frames' specified in test scenario: {test_scenario.get('test_id', 'unknown')}")
    
    return parse_frame_spec(frame_spec)


def extract_frames_for_testing(video_path: str, frame_numbers: List[int]) -> List[dict]:
    """
    Extract specific frames from video for testing.
    
    Args:
        video_path: Path to video file
        frame_numbers: List of frame numbers to extract
        
    Returns:
        List of frame data dictionaries
    """
    
    import cv2
    from PIL import Image
    
    extracted_frames = []
    
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"Could not open video: {video_path}")
    
    for frame_num in frame_numbers:
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_num)
        ret, frame = cap.read()
        
        if ret:
            # Convert to PIL Image
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            pil_image = Image.fromarray(frame_rgb)
            
            extracted_frames.append({
                'frame_number': frame_num,
                'timestamp': frame_num / 24.0,  # Assuming 24fps
                'image': pil_image
            })
        else:
            print(f"Warning: Could not extract frame {frame_num}")
    
    cap.release()
    
    return extracted_frames


# Test the parser
if __name__ == "__main__":
    print("Testing frame specification parser:")
    
    test_specs = [
        864,                    # Single frame
        "864,900,936",         # Multiple frames
        "864-1056",            # Range
        "864-1056:25",         # Range with step
        "100,200,500-600:10,800"  # Mixed specification
    ]
    
    for spec in test_specs:
        frames = parse_frame_spec(spec)
        print(f"  {spec} → {len(frames)} frames: {frames[:5]}{'...' if len(frames) > 5 else ''}")
    
    print("\\nFrame parser working correctly!")