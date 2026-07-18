"""Runners execute a validated pipeline. The built-in runner is the mandatory default.

Optional runners (e.g. a distributed/remote executor) register in ``RUNNERS`` as plugins
and only *add* options — the platform never requires one. (ClearML is NOT a runner: it's
a user's own dataset/export concern, external to this engine.) The built-in runner has no
external dependency beyond networkx and executes stages in topological order in-process
(a stage may itself dispatch to a worker via its injected model handle).
"""
from __future__ import annotations

from typing import Protocol, runtime_checkable

import networkx as nx

from .artifacts import Artifact
from .errors import RunError
from .pipeline import INPUT_NS, PipelineDef
from .registry import Registry
from .stage import STAGES, RunContext


@runtime_checkable
class Runner(Protocol):
    name: str

    def run(
        self,
        pipeline: PipelineDef,
        inputs: dict[str, Artifact],
        *,
        ctx: RunContext | None = None,
    ) -> dict[str, dict[str, Artifact]]:
        ...


class BuiltinRunner:
    """Default runner: topological, in-process, dependency-free."""

    name = "builtin"

    def run(
        self,
        pipeline: PipelineDef,
        inputs: dict[str, Artifact],
        *,
        ctx: RunContext | None = None,
    ) -> dict[str, dict[str, Artifact]]:
        ctx = ctx or RunContext()
        graph = pipeline.build()
        by_id = {s.id: s for s in pipeline.stages}

        # every declared pipeline input must be supplied
        missing_inputs = [n for n in pipeline.inputs if n not in inputs]
        if missing_inputs:
            raise RunError(f"pipeline '{pipeline.name}' missing inputs: {missing_inputs}")

        results: dict[str, dict[str, Artifact]] = {INPUT_NS: dict(inputs)}

        for sid in nx.topological_sort(graph):
            ref = by_id[sid]
            stage = STAGES.get(ref.uses)()

            resolved: dict[str, Artifact] = {}
            for in_name, wref in ref.wire.items():
                src, out = wref.split(".", 1)
                try:
                    resolved[in_name] = results[src][out]
                except KeyError as exc:
                    raise RunError(
                        f"stage '{sid}' input '{in_name}': cannot resolve '{wref}'"
                    ) from exc

            outs = stage.run(inputs=resolved, params=ref.params, ctx=ctx)

            # a stage must honour its declared output contract
            for oname, otype in stage.outputs.items():
                if oname not in outs:
                    raise RunError(
                        f"stage '{sid}' ({ref.uses}) did not return declared output '{oname}'"
                    )
                if not isinstance(outs[oname], otype):
                    raise RunError(
                        f"stage '{sid}' output '{oname}' is {type(outs[oname]).__name__}, "
                        f"expected {otype.__name__}"
                    )
            results[sid] = outs

        return results


#: All runners, keyed by ``name``. Built-in is registered eagerly.
RUNNERS: "Registry[Runner]" = Registry("pipeline_engine.runners")
RUNNERS.register(BuiltinRunner)
