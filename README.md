# Windsurfing Sail Dataset Creator

A pipeline for creating YOLO object detection datasets of windsurfing sails using SAM2 (Segment Anything Model 2) and manual annotation.

## Overview

This project implements a semi-automated approach to curate windsurfing sail datasets:

1. **Manual Seeding**: Manually click on sails in a few key frames (2-5 frames)
2. **SAM2 Tracking**: Use SAM2 to segment and track the sail throughout the video
3. **YOLO Export**: Convert segmentation masks to bounding boxes in YOLO format

## Features

- Interactive manual annotation interface
- SAM2-powered object tracking across video frames
- Automatic conversion from masks to YOLO bounding boxes
- Train/validation/test split generation
- Visualization tools for quality checking
- Supports multiple annotation strategies (early, uniform, middle)

## Documentation

- [Dataset Lifecycle Architecture](docs/DATASET_ARCHITECTURE.md) — the dataset flywheel: content-addressed frame store, immutable versioned datasets, model lineage, on-prem serving (phases P1–P5).
- [Pipeline Architecture](docs/PIPELINE_ARCHITECTURE.md) — the `pipeline_engine` capability registry + model fleet (SAM2/SAM3/DINO/Claude/trained-YOLO), served local or external by config.
- [Deployment](docs/DEPLOYMENT.md) — GitOps/ArgoCD production deployment of `windsurf-prod`.
- [UX Architecture](docs/UX_ARCHITECTURE.md) — durable placement + progressive-disclosure framework every UI change follows.
- [Testing Requirements](docs/TESTING.md) — tests required on every change; coverage ratchets up, never down.
- [Refactor Debt](docs/REFACTOR_DEBT.md) — known technical debt.
- [Sprint Plan — Surfer Dataset](docs/SPRINT-PLAN-SURFER-DATASET.md) — parked planning notes.

## Installation

### Prerequisites

- Python 3.8+
- CUDA-capable GPU (recommended for SAM2)
- Git

### Setup

1. Clone this repository:
```bash
git clone <your-repo-url>
cd windsurf-sail-dataset
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Install SAM2:
```bash
# Clone SAM2 repository
git clone https://github.com/facebookresearch/segment-anything-2.git
cd segment-anything-2
pip install -e .
cd ..
```

4. Download SAM2 checkpoints:
```bash
mkdir checkpoints
cd checkpoints
# Download the checkpoint you want to use
wget https://dl.fbaipublicfiles.com/segment_anything_2/072824/sam2_hiera_large.pt
cd ..
```

## Quick Start

### Basic Usage

```python
from src.pipeline import SailDatasetPipeline

# Create pipeline
video_path = "path/to/windsurfing_video.mp4"
with SailDatasetPipeline(video_path, "output_dataset") as pipeline:
    # Run complete pipeline
    summary = pipeline.run_complete_pipeline(
        num_annotation_frames=5,      # Manually annotate 5 frames
        annotation_strategy="early",   # Focus on early video frames
        train_ratio=0.7,              # 70% training data
        val_ratio=0.2                 # 20% validation, 10% test
    )
    
    # Visualize results
    pipeline.visualize_results()
```

### Step-by-Step Usage

```python
from src.pipeline import SailDatasetPipeline

with SailDatasetPipeline(video_path) as pipeline:
    # 1. Setup
    pipeline.setup()
    
    # 2. Manual annotation
    annotations = pipeline.run_manual_annotation(num_frames=3)
    
    # 3. SAM2 tracking
    tracking_results = pipeline.run_sam2_tracking()
    
    # 4. Export YOLO dataset
    counts = pipeline.export_yolo_dataset()
```

## Manual Annotation Interface

The interactive annotation interface allows you to:

- **Click**: Click on the windsurfing sail to add annotation points
- **Done**: Complete annotation for current frame
- **Clear**: Clear all points and restart
- **Skip**: Skip current frame

### Tips for Good Annotations

1. Click on distinctive parts of the sail (edges, corners, center)
2. Add 2-5 points per sail for better SAM2 performance
3. Avoid clicking on background or other objects
4. Focus on frames where the sail is clearly visible

## Output Structure

```
output_directory/
├── yolo_dataset/
│   ├── images/
│   │   ├── train/
│   │   ├── val/
│   │   └── test/
│   ├── labels/
│   │   ├── train/
│   │   ├── val/
│   │   └── test/
│   └── dataset.yaml
├── manual_annotations.json
├── tracking_results.json
└── pipeline_summary.json
```

## Configuration

### Annotation Strategies

- **"early"**: Focus on first part of video (good for intro shots)
- **"uniform"**: Evenly distributed frames
- **"middle"**: Focus on middle section

### SAM2 Models

Supported model configurations:
- `sam2_hiera_tiny.yaml` (fastest, least accurate)
- `sam2_hiera_small.yaml`
- `sam2_hiera_base_plus.yaml`
- `sam2_hiera_large.yaml` (slowest, most accurate)

### Memory Considerations

- SAM2 can be memory intensive
- Pipeline automatically limits frames for tracking (max 1000)
- Reduce `max_frames` in `run_sam2_tracking()` if needed

## Training a YOLO Model

After generating the dataset, train a YOLO model:

```python
from ultralytics import YOLO

# Load a pretrained model
model = YOLO('yolov8n.pt')

# Train the model
results = model.train(
    data='output_dataset/yolo_dataset/dataset.yaml',
    epochs=100,
    imgsz=640,
    batch=16
)
```

## Advanced Usage

### Custom Video Processing

```python
from src.video_utils import VideoFrameExtractor

with VideoFrameExtractor("video.mp4") as extractor:
    # Get video info
    print(f"FPS: {extractor.fps}, Frames: {extractor.total_frames}")
    
    # Extract specific frame
    frame = extractor.get_frame(100)
    
    # Extract frame at timestamp
    frame = extractor.get_frame_at_time(30.5)  # 30.5 seconds
```

### Manual Annotation Only

```python
from src.annotation_interface import AnnotationSession
from src.video_utils import VideoFrameExtractor

with VideoFrameExtractor("video.mp4") as extractor:
    session = AnnotationSession(extractor, "annotations.json")
    
    # Suggest frames to annotate
    from src.annotation_interface import suggest_annotation_frames
    frames = suggest_annotation_frames(extractor, 5, "uniform")
    
    # Annotate interactively
    session.annotate_frames_interactively(frames)
```

### SAM2 Tracking Only

```python
from src.sam2_tracker import SAM2Tracker

tracker = SAM2Tracker()
tracker.initialize_video_tracking(video_frames)

# Add object from points
obj_id = tracker.add_sail_from_points(frame_idx=0, points=[(100, 200), (150, 250)])

# Track across video
results = tracker.propagate_tracking()
```

## Troubleshooting

### Common Issues

1. **SAM2 Import Error**: Make sure SAM2 is properly installed and checkpoints downloaded
2. **CUDA Out of Memory**: Reduce video frame count or use smaller SAM2 model
3. **Poor Tracking**: Add more annotation points or choose different frames
4. **Empty Annotations**: Make sure to click "Done" after selecting points

### Performance Tips

1. Use GPU for SAM2 (significantly faster)
2. Start with smaller videos for testing
3. Use "early" strategy for videos with clear sail shots at beginning
4. Annotate frames where sail is clearly visible and unoccluded

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Citation

If you use this pipeline in your research, please cite:

```bibtex
@software{windsurf_sail_dataset,
  title={Windsurfing Sail Dataset Creator},
  author={Your Name},
  year={2025},
  url={https://github.com/yourusername/windsurf-sail-dataset}
}
```

## Acknowledgments

- [SAM2](https://github.com/facebookresearch/sam2) by Meta AI
- [Ultralytics YOLO](https://github.com/ultralytics/ultralytics)
- OpenCV and PyTorch communities