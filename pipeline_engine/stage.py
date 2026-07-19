"""Stage protocol + the global stage registry.

A Stage is a named, typed, pluggable step. It declares its input/output artifact
*types* as class-level dicts so the pipeline can be validated before it runs. Heavy
work (models, IO) is done inside ``run`` and lazily imported there — never at module
load — so importing a stage never drags in torch/PIL/etc.
"""
from __future__ import annotations

from typing import Any, ClassVar, Protocol, runtime_checkable

from .artifacts import Artifact
from .registry import Registry


class RunContext:
    """Opaque, app-agnostic per-run context handed to every stage.

    ``extra`` carries injected capabilities (e.g. an ``load_image`` callable, a model
    client) so stages stay decoupled from storage and app code.
    """

    def __init__(self, run_id: str = "local", extra: dict[str, Any] | None = None) -> None:
        self.run_id = run_id
        self.extra: dict[str, Any] = extra or {}


@runtime_checkable
class Stage(Protocol):
    name: ClassVar[str]
    inputs: ClassVar[dict[str, type[Artifact]]]
    outputs: ClassVar[dict[str, type[Artifact]]]

    def run(
        self,
        *,
        inputs: dict[str, Artifact],
        params: dict[str, Any],
        ctx: RunContext,
    ) -> dict[str, Artifact]:
        ...


#: All stage implementations, keyed by ``name``.
STAGES: "Registry[Stage]" = Registry("pipeline_engine.stages")
