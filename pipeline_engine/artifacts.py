"""Typed artifacts — the contract every stage composes through.

This is the *only* place generality is invested (see docs/PIPELINE_ARCHITECTURE.md).
Artifacts are immutable pydantic models and carry references or base64 payloads, never
live handles — so the engine stays serialisable and app/storage-agnostic.
"""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class Artifact(BaseModel):
    """Base class for all pipeline artifacts. Frozen + strict by default."""

    model_config = ConfigDict(frozen=True, extra="forbid")


class Image(Artifact):
    """A frame/image, referenced by URI (resolved by IO in a stage, not the core)."""

    uri: str
    width: int
    height: int


class Point(Artifact):
    """A click prompt in native pixels. label: 1 = positive, 0 = negative."""

    x: float
    y: float
    label: int = 1


class BBox(Artifact):
    """Axis-aligned box in native pixels (top-left origin)."""

    x: float
    y: float
    w: float
    h: float


class Mask(Artifact):
    """A binary/grayscale mask as a base64 PNG, plus the box it lives in."""

    png_base64: str
    bbox: BBox


class Crop(Artifact):
    """A cropped (optionally background-suppressed) region as a base64 PNG."""

    png_base64: str
    source_bbox: BBox


class Label(Artifact):
    """A single classification result."""

    value: str
    score: float = 1.0


class Metadata(Artifact):
    """Free-form structured attributes (e.g. sail brand/model) + per-field confidence."""

    fields: dict[str, Any] = Field(default_factory=dict)
    confidence: dict[str, float] = Field(default_factory=dict)


class Embedding(Artifact):
    """A feature vector (e.g. CLIP/DINO), for k-NN / linear-probe stages."""

    vector: list[float]
    dim: int


class Track(Artifact):
    """An object's box across frames."""

    frames: list[tuple[int, BBox]]


class Detection(Artifact):
    """One instance from an open-vocab/concept prompt: box (+ optional mask/label/track)."""

    bbox: BBox
    score: float = 1.0
    label: str | None = None
    mask_base64: str | None = None
    track_id: int | None = None


class Detections(Artifact):
    """A set of instances (SAM3 concept prompt → all matching objects at once)."""

    items: list[Detection] = Field(default_factory=list)
    prompt: str | None = None


#: Registry of artifact types by class name — used for YAML `inputs:` type validation.
ARTIFACTS: dict[str, type[Artifact]] = {
    cls.__name__: cls
    for cls in (Image, Point, BBox, Mask, Crop, Label, Metadata, Embedding, Track,
                Detection, Detections)
}
