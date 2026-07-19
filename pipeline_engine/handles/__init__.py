"""Built-in model handles. Importing this package registers them in ``HANDLES``.

Only *transport-generic*, dependency-light handles live here. Handles that need the
backend (e.g. a Celery ``local-worker`` handle) are registered by the app, not shipped in
the engine core — that keeps the boundary clean.
"""
from __future__ import annotations

from . import openai_compat, sam3_runpod  # noqa: F401  (register on import)

__all__ = ["openai_compat", "sam3_runpod"]
