"""pipeline_engine — a self-contained, vendor-neutral pipeline engine for annotation
classification and metadata extraction.

Core depends only on pydantic + pyyaml + networkx. Heavy libraries (models, storage,
orchestrators) enter only as plugins, lazily. See docs/PIPELINE_ARCHITECTURE.md.
"""
from __future__ import annotations

from .artifacts import (
    ARTIFACTS,
    Artifact,
    BBox,
    Crop,
    Embedding,
    Image,
    Label,
    Mask,
    Metadata,
    Point,
    Track,
)
from .errors import ModelError, PipelineDefError, PipelineError, RunError
from .models import HANDLES, MODELS, ModelConfig, ModelHandle
from .pipeline import PipelineDef, StageRef
from .runner import RUNNERS, BuiltinRunner, Runner
from .stage import STAGES, RunContext, Stage

# Register the built-in stages + model handles (import-cheap; no ML libs pulled in).
from . import handles  # noqa: E402,F401
from . import plugins  # noqa: E402,F401

__all__ = [
    "ARTIFACTS",
    "Artifact",
    "BBox",
    "Crop",
    "Embedding",
    "Image",
    "Label",
    "Mask",
    "Metadata",
    "Point",
    "Track",
    "PipelineError",
    "PipelineDefError",
    "RunError",
    "ModelError",
    "MODELS",
    "HANDLES",
    "ModelConfig",
    "ModelHandle",
    "PipelineDef",
    "StageRef",
    "RUNNERS",
    "BuiltinRunner",
    "Runner",
    "STAGES",
    "Stage",
    "RunContext",
]
