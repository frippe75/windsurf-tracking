"""Engine error types. Kept trivial and dependency-free."""
from __future__ import annotations


class PipelineError(Exception):
    """Base for all engine errors."""


class PipelineDefError(PipelineError):
    """A pipeline definition is invalid (bad wiring, unknown stage, cycle, type mismatch)."""


class RunError(PipelineError):
    """A failure while executing a pipeline (unresolved ref, bad stage output)."""


class ModelError(PipelineError):
    """A model handle failed (transport, auth, or an unparseable/invalid response)."""
