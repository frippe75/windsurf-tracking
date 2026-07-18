"""Built-in stages. Importing this package registers them in ``STAGES``.

Kept import-cheap: each stage lazy-imports its heavy libs (Pillow, model stacks) inside
``run``, so importing the plugins does not pull in torch/PIL/etc.
"""
from __future__ import annotations

from . import crop_mask, segment, vlm_extract  # noqa: F401  (register on import)

__all__ = ["crop_mask", "segment", "vlm_extract"]
