#!/bin/bash
# Windsurfing Sail Dataset - Complete Setup Script
# This script sets up everything needed for the pipeline

set -e  # Exit on any error

echo "🏄 Windsurfing Sail Dataset Setup"
echo "=================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}✓${NC} $1"
}

print_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

# Check if we're in the right directory
if [ ! -f "requirements.txt" ]; then
    print_error "requirements.txt not found. Please run this script from the project root directory."
    exit 1
fi

# Parse command line arguments
INSTALL_SAM2=false
INSTALL_CUDA=false
SKIP_VENV=false
VENV_NAME="windsurf_env"

while [[ $# -gt 0 ]]; do
    case $1 in
        --with-sam2)
            INSTALL_SAM2=true
            shift
            ;;
        --with-cuda)
            INSTALL_CUDA=true
            shift
            ;;
        --skip-venv)
            SKIP_VENV=true
            shift
            ;;
        --venv-name)
            VENV_NAME="$2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --with-sam2     Install SAM2 for full pipeline functionality"
            echo "  --with-cuda     Install CUDA-enabled PyTorch (requires NVIDIA GPU)"
            echo "  --skip-venv     Skip virtual environment creation (use system Python)"
            echo "  --venv-name     Name for virtual environment (default: windsurf_env)"
            echo "  -h, --help      Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0                    # Basic installation"
            echo "  $0 --with-sam2       # Full installation with SAM2"
            echo "  $0 --with-sam2 --with-cuda  # Full installation with CUDA support"
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

print_info "Setup configuration:"
print_info "- Install SAM2: $INSTALL_SAM2"
print_info "- Install CUDA: $INSTALL_CUDA"
print_info "- Skip venv: $SKIP_VENV"
print_info "- Venv name: $VENV_NAME"
echo ""

# Check Python version
print_info "Checking Python installation..."
if ! command -v python3 &> /dev/null; then
    print_error "Python 3 is not installed. Please install Python 3.8+ first."
    exit 1
fi

PYTHON_VERSION=$(python3 -c 'import sys; print(".".join(map(str, sys.version_info[:2])))')
print_status "Found Python $PYTHON_VERSION"

# Check if Python version is adequate
if python3 -c 'import sys; exit(0 if sys.version_info >= (3, 8) else 1)'; then
    print_status "Python version is adequate (3.8+)"
else
    print_error "Python 3.8+ is required. Found $PYTHON_VERSION"
    exit 1
fi

# Create virtual environment
if [ "$SKIP_VENV" = false ]; then
    if [ -d "$VENV_NAME" ]; then
        print_status "Virtual environment '$VENV_NAME' already exists"
    else
        print_info "Creating virtual environment..."
        python3 -m venv "$VENV_NAME"
        print_status "Created virtual environment: $VENV_NAME"
    fi
    
    # Activate virtual environment
    source "$VENV_NAME/bin/activate"
    print_status "Activated virtual environment"
    
    # Upgrade pip only if needed
    current_pip=$(pip --version | cut -d' ' -f2)
    print_info "Current pip version: $current_pip"
    pip install --upgrade pip > /dev/null 2>&1
    print_status "Pip check/upgrade complete"
else
    print_warning "Skipping virtual environment creation"
fi

# Install basic requirements
print_info "Installing basic requirements..."
pip install -r test_requirements.txt
pip install pyyaml
print_status "Basic requirements installed"

# Install PyTorch
if [ "$INSTALL_CUDA" = true ]; then
    print_info "Installing PyTorch with CUDA support..."
    pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
    print_status "PyTorch with CUDA installed"
elif [ "$INSTALL_SAM2" = true ]; then
    print_info "Installing PyTorch (CPU version)..."
    pip install torch torchvision
    print_status "PyTorch installed"
fi

# Install SAM2 if requested
if [ "$INSTALL_SAM2" = true ]; then
    # Check if SAM2 is already installed
    if python -c "import sam2" 2>/dev/null; then
        print_status "SAM2 already installed"
    else
        print_info "Installing SAM2..."
        
        # Clone SAM2 repository only if it doesn't exist
        if [ ! -d "sam2" ]; then
            git clone https://github.com/facebookresearch/sam2.git
        else
            print_status "sam2 directory already exists"
        fi
        
        cd sam2
        # Install SAM2
        pip install -e .
        cd ..
        print_status "SAM2 installed"
    fi
    
    # Download checkpoints
    mkdir -p checkpoints
    cd checkpoints
    
    # Download the large model checkpoint only if missing
    if [ ! -f "sam2_hiera_large.pt" ]; then
        print_info "Downloading sam2_hiera_large.pt (this may take a while)..."
        wget -q --show-progress https://dl.fbaipublicfiles.com/segment_anything_2/072824/sam2_hiera_large.pt
        print_status "Downloaded sam2_hiera_large.pt"
    else
        print_status "sam2_hiera_large.pt already exists"
    fi
    
    cd ..
fi

# Install Grounding DINO if SAM2 is requested
if [ "$INSTALL_SAM2" = true ]; then
    # Check if Grounding DINO is already installed
    if python -c "from groundingdino.util.inference import load_model" 2>/dev/null; then
        print_status "Grounding DINO already installed"
    else
        print_info "Installing Grounding DINO..."
        
        # Try pip install first
        pip install groundingdino-py
        
        # Clone repository only if it doesn't exist
        if [ ! -d "GroundingDINO" ]; then
            git clone https://github.com/IDEA-Research/GroundingDINO.git
        else
            print_status "GroundingDINO directory already exists"
        fi
        
        cd GroundingDINO
        # Install from source
        pip install -e .
        cd ..
        print_status "Grounding DINO installed"
    fi
    
    # Setup weights and config directories
    mkdir -p weights
    mkdir -p groundingdino/config
    
    # Download weights only if missing
    if [ ! -f "weights/groundingdino_swint_ogc.pth" ]; then
        print_info "Downloading groundingdino_swint_ogc.pth (this may take a while)..."
        cd weights
        wget -q --show-progress https://github.com/IDEA-Research/GroundingDINO/releases/download/v0.1.0-alpha/groundingdino_swint_ogc.pth
        cd ..
        print_status "Downloaded groundingdino_swint_ogc.pth"
    else
        print_status "groundingdino_swint_ogc.pth already exists"
    fi
    
    # Download config file if missing
    if [ ! -f "groundingdino/config/GroundingDINO_SwinT_OGC.py" ]; then
        print_info "Downloading Grounding DINO config..."
        wget -q -O groundingdino/config/GroundingDINO_SwinT_OGC.py https://raw.githubusercontent.com/IDEA-Research/GroundingDINO/main/groundingdino/config/GroundingDINO_SwinT_OGC.py
        print_status "Grounding DINO config downloaded"
    else
        print_status "Grounding DINO config already exists"
    fi
fi

# Install additional requirements if SAM2 is installed
if [ "$INSTALL_SAM2" = true ]; then
    print_info "Installing additional requirements for full pipeline..."
    pip install ultralytics jupyter ipywidgets
    print_status "Additional requirements installed"
fi

# Run tests
print_info "Running system tests..."
if python3 test_fixed.py > /dev/null 2>&1; then
    print_status "All tests passed!"
else
    print_warning "Some tests failed. Running verbose test..."
    python3 test_fixed.py
fi

# Create activation script
print_info "Creating activation script..."
cat > activate_env.sh << 'EOF'
#!/bin/bash
# Activate the windsurfing sail dataset environment

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ -d "windsurf_env" ]; then
    source windsurf_env/bin/activate
    echo "✓ Activated windsurfing sail dataset environment"
    echo "📁 Working directory: $(pwd)"
    echo ""
    echo "Available commands:"
    echo "  python3 test_fixed.py                    # Test system"
    echo "  python3 demo_manual_annotation.py <video> # Manual annotation demo"
    if [ -d "sam2" ]; then
        echo "  python3 example_usage.py               # Full pipeline with SAM2"
    fi
    echo ""
else
    echo "❌ Virtual environment not found. Run setup.sh first."
fi
EOF

chmod +x activate_env.sh
print_status "Created activation script: activate_env.sh"

# Create pipeline script for automation
print_info "Creating pipeline automation script..."
cat > run_pipeline.sh << 'EOF'
#!/bin/bash
# Automated pipeline runner for CI/CD

set -e

# Parse arguments
VIDEO_PATH=""
OUTPUT_DIR="pipeline_output"
NUM_FRAMES=3
STRATEGY="early"
WITH_SAM2=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --video)
            VIDEO_PATH="$2"
            shift 2
            ;;
        --output)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        --frames)
            NUM_FRAMES="$2"
            shift 2
            ;;
        --strategy)
            STRATEGY="$2"
            shift 2
            ;;
        --with-sam2)
            WITH_SAM2=true
            shift
            ;;
        *)
            echo "Usage: $0 --video <path> [--output <dir>] [--frames <n>] [--strategy <strategy>] [--with-sam2]"
            exit 1
            ;;
    esac
done

if [ -z "$VIDEO_PATH" ]; then
    echo "❌ Video path is required"
    echo "Usage: $0 --video <path> [options]"
    exit 1
fi

# Activate environment
source windsurf_env/bin/activate

# Run pipeline
if [ "$WITH_SAM2" = true ] && [ -d "sam2" ]; then
    echo "🚀 Running full pipeline with SAM2..."
    python3 -c "
from src.pipeline import SailDatasetPipeline
import sys

try:
    with SailDatasetPipeline('$VIDEO_PATH', '$OUTPUT_DIR') as pipeline:
        summary = pipeline.run_complete_pipeline(
            num_annotation_frames=$NUM_FRAMES,
            annotation_strategy='$STRATEGY'
        )
        print('✅ Pipeline completed successfully!')
        print(f'📊 Summary: {summary}')
except Exception as e:
    print(f'❌ Pipeline failed: {e}')
    sys.exit(1)
"
else
    echo "🏄 Running manual annotation pipeline..."
    python3 demo_manual_annotation.py "$VIDEO_PATH" --num-frames "$NUM_FRAMES" --strategy "$STRATEGY"
fi

echo "✅ Pipeline completed! Output in: $OUTPUT_DIR"
EOF

chmod +x run_pipeline.sh
print_status "Created pipeline automation script: run_pipeline.sh"

# Summary
echo ""
echo "🎉 Setup completed successfully!"
echo "================================"
print_status "Virtual environment: $VENV_NAME"
print_status "Basic requirements: Installed"
if [ "$INSTALL_SAM2" = true ]; then
    print_status "SAM2: Installed with checkpoints"
else
    print_info "SAM2: Not installed (use --with-sam2 for full functionality)"
fi

echo ""
echo "📋 Next Steps:"
echo "1. Activate environment: source activate_env.sh"
echo "2. Test system: python3 test_fixed.py"
echo "3. Try demo: python3 demo_manual_annotation.py your_video.mp4"

if [ "$INSTALL_SAM2" = true ]; then
    echo "4. Run full pipeline: python3 example_usage.py"
fi

echo ""
echo "🤖 For automation/CI:"
echo "  ./run_pipeline.sh --video <path> [options]"
echo ""
print_status "Setup complete! 🚀"