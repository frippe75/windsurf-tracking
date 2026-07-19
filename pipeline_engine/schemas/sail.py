"""Sail brand/model extraction schema (worked example #1)."""
from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field

from . import register_schema


class SailBrand(str, Enum):
    neilpryde = "NeilPryde"
    duotone = "Duotone"
    severne = "Severne"
    north = "North"
    goya = "Goya"
    point7 = "Point-7"
    loft = "Loft"
    other = "other"
    unknown = "unknown"


@register_schema
class SailMeta(BaseModel):
    """Structured metadata read off a windsurf sail.

    ``unknown`` is a first-class value so the model can decline instead of guessing.
    The enum constrains ``brand`` to a known gazetteer (+ other/unknown escape hatches).
    """

    brand: SailBrand = Field(description="Sail brand printed/visible on the sail")
    model: str | None = Field(default=None, description="Model/series name, e.g. 'Warp' or 'Blade'")
    size_m2: float | None = Field(default=None, description="Sail size in square metres")
    sail_number: str | None = Field(default=None, description="Registration/sail number, if visible")
    primary_colors: list[str] = Field(default_factory=list, description="Dominant colours")
