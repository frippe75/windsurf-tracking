"""Declarative model-fleet registration.

Register every AI model (VLM, SAM2, SAM3, detectors, encoders, ...) from one declarative
source so adding a model is a config row, not code. Consumers then pick models by
*capability* (``MODELS.by_capability("concept-segment")``), never by hardcoded name.

    load_models_yaml("models.yaml")   # {models: [{name, type, capabilities, base_url, ...}]}
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from .models import MODELS, ModelConfig


def load_models(data: dict[str, Any]) -> list[str]:
    """Register models from ``{"models": [ {name, type, capabilities, ...}, ... ]}``.

    Each entry's fields (minus ``name``) are the ``ModelConfig``. Returns the names.
    """
    registered: list[str] = []
    for entry in data.get("models", []) or []:
        entry = dict(entry)
        name = entry.pop("name", None)
        if not name:
            raise ValueError(f"model entry missing 'name': {entry!r}")
        MODELS.configure(name, ModelConfig(**entry))
        registered.append(name)
    return registered


def load_models_yaml(path: str | Path) -> list[str]:
    import yaml

    return load_models(yaml.safe_load(Path(path).read_text()) or {})
