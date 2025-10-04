# Quick Start Guide

## Immediate Testing (No SAM2 needed)

1. **Setup Environment**
```bash
python3 -m venv windsurf_env
source windsurf_env/bin/activate
pip install -r test_requirements.txt pyyaml
```

2. **Test the System**
```bash
python3 test_fixed.py
```
Should show: `🎉 All basic tests passed!`

3. **Try Manual Annotation** (with your own video)
```bash
python3 demo_manual_annotation.py your_video.mp4
```

## What You'll Get

### Manual Annotation Demo
- Interactive interface to click on sails
- Automatic YOLO dataset generation
- Works with any MP4 video
- No AI dependencies needed

### Output Structure
```
annotation_demo_output/
├── manual_annotations.json    # Your click points
└── yolo_dataset/
    ├── images/train/          # Extracted frames
    ├── labels/train/          # YOLO format labels
    └── dataset.yaml           # Training config
```

## Full Pipeline (With SAM2)

For the complete tracking pipeline:

1. **Install SAM2**
```bash
git clone https://github.com/facebookresearch/sam2.git
cd sam2
pip install -e .
```

2. **Download Checkpoints**
```bash
mkdir checkpoints
cd checkpoints
wget https://dl.fbaipublicfiles.com/segment_anything_2/072824/sam2_hiera_large.pt
```

3. **Run Complete Pipeline**
```bash
python3 example_usage.py
```

## Testing Tips

- **Start Small**: Use short videos (30-60 seconds) for testing
- **Good Lighting**: Choose videos with clear sail visibility  
- **Early Frames**: Use `--strategy early` for videos with good opening shots
- **Multiple Points**: Click 2-5 points per sail for better results

## Troubleshooting

- **`No module named 'yaml'`** → Run: `pip install pyyaml`
- **Video won't load** → Try converting to MP4: `ffmpeg -i input.mov output.mp4`
- **Annotation window won't show** → Check if you have display/X11 forwarding
- **Memory issues** → Use shorter videos or reduce frame count

## Next Steps

1. ✅ **Test basic functionality** → `python3 test_fixed.py`
2. ✅ **Try manual annotation** → `python3 demo_manual_annotation.py video.mp4`
3. 🔄 **Install SAM2** → Full tracking pipeline
4. 🎯 **Train YOLO model** → Use generated dataset

Your pipeline is ready to use! 🚀