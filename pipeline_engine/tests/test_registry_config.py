"""Generic model registry: capabilities, by_capability, declarative loading."""
from __future__ import annotations

from pathlib import Path

import pipeline_engine as pe
from pipeline_engine.config import load_models, load_models_yaml
from pipeline_engine.models import HANDLES, MODELS


def test_handles_registered():
    for h in ("openai-compat-http", "sam3-runpod", "sam2-http", "sam3-runpod-track", "anthropic", "yolo-http"):
        assert h in HANDLES.names()


def test_load_models_and_by_capability():
    data = {"models": [
        {"name": "vlm-x", "type": "openai-compat-http", "capabilities": ["vlm-extract"],
         "model_name": "m", "base_url": "http://x/v1"},
        {"name": "seg3", "type": "sam3-runpod", "capabilities": ["concept-segment", "segment-click"],
         "base_url": "https://api.runpod.ai/v2/a"},
        {"name": "seg2", "type": "sam2-http", "capabilities": ["segment-click"],
         "base_url": "http://b/api/ai/sam2"},
    ]}
    names = load_models(data)
    try:
        assert set(names) == {"vlm-x", "seg3", "seg2"}
        assert MODELS.by_capability("vlm-extract") == ["vlm-x"]
        assert MODELS.by_capability("concept-segment") == ["seg3"]
        assert MODELS.by_capability("segment-click") == ["seg2", "seg3"]  # sorted
        assert set(MODELS.capabilities_of("seg3")) == {"concept-segment", "segment-click"}
        # names resolve to the right handle types (serving is config)
        assert MODELS.get("seg3").__class__.__name__ == "Sam3RunpodHandle"
        assert MODELS.get("seg2").__class__.__name__ == "Sam2HttpHandle"
    finally:
        for n in names:
            MODELS._configs.pop(n, None)
            MODELS._caps.pop(n, None)


def test_example_yaml_loads():
    p = Path(pe.__file__).parent / "models.example.yaml"
    names = load_models_yaml(p)
    try:
        assert MODELS.by_capability("vlm-extract") == ["qwen3-vl"]
        assert MODELS.by_capability("concept-segment") == ["sam3"]
        assert MODELS.by_capability("segment-click") == ["sam2-local", "sam3"]
        assert MODELS.by_capability("concept-track") == ["sam3-video"]
        assert MODELS.by_capability("metadata-extract") == ["claude"]
        assert MODELS.by_capability("detect") == ["trained-yolo"]
        assert MODELS.get("sam3-video").__class__.__name__ == "Sam3RunpodTrackHandle"
        assert MODELS.get("claude").__class__.__name__ == "AnthropicHandle"
        assert MODELS.get("trained-yolo").__class__.__name__ == "YoloHttpHandle"
    finally:
        for n in names:
            MODELS._configs.pop(n, None)
            MODELS._caps.pop(n, None)
