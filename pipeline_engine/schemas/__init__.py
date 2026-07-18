"""Structured-output schemas for extraction stages.

A schema is a plain pydantic model whose ``.model_json_schema()`` drives the VLM's
constrained/guided JSON decoding. They live in a small registry so a YAML pipeline can
reference one by name (``params: { schema: SailMeta }``).
"""
from __future__ import annotations

from pydantic import BaseModel

#: Extraction schemas by class name.
SCHEMAS: dict[str, type[BaseModel]] = {}


def register_schema(cls: type[BaseModel]) -> type[BaseModel]:
    SCHEMAS[cls.__name__] = cls
    return cls


from .sail import SailMeta  # noqa: E402  (register on package import)

__all__ = ["SCHEMAS", "register_schema", "SailMeta"]
