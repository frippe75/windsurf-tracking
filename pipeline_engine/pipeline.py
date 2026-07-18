"""Pipeline definition: YAML -> pydantic -> validated networkx DAG.

A definition names its stages, wires each stage input to either a pipeline input
(``@input.<name>``) or an upstream ``<stage_id>.<output>``. ``build`` fully validates
the graph *before* execution: unknown stage types, unknown/mismatched wires, missing
inputs, artifact-type incompatibilities, and cycles are all caught here.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import networkx as nx
from pydantic import BaseModel, Field

from .artifacts import ARTIFACTS
from .errors import PipelineDefError
from .stage import STAGES

#: Namespace for references to pipeline-level inputs, e.g. "@input.image".
INPUT_NS = "@input"


class StageRef(BaseModel):
    """One stage instance in a pipeline."""

    id: str
    uses: str
    params: dict[str, Any] = Field(default_factory=dict)
    #: input_name -> "stage_id.output" or "@input.name"
    wire: dict[str, str] = Field(default_factory=dict)


class PipelineDef(BaseModel):
    name: str
    #: input_name -> artifact type name (for validation + documentation)
    inputs: dict[str, str] = Field(default_factory=dict)
    stages: list[StageRef]

    # ---- loading ---------------------------------------------------------------
    @classmethod
    def from_yaml(cls, text: str) -> "PipelineDef":
        import yaml  # local import keeps yaml optional for callers that only build in code

        return cls.model_validate(yaml.safe_load(text))

    @classmethod
    def from_yaml_path(cls, path: str | Path) -> "PipelineDef":
        return cls.from_yaml(Path(path).read_text())

    # ---- validation / graph ----------------------------------------------------
    @staticmethod
    def _split_ref(ref: str) -> tuple[str, str]:
        if "." not in ref:
            raise PipelineDefError(
                f"bad wire ref '{ref}' (want 'stage_id.output' or '@input.name')"
            )
        src, out = ref.split(".", 1)
        return src, out

    def build(self) -> nx.DiGraph:
        """Validate the definition and return an executable DAG."""
        ids = [s.id for s in self.stages]
        if len(set(ids)) != len(ids):
            raise PipelineDefError(f"pipeline '{self.name}' has duplicate stage ids")

        # declared pipeline inputs must name real artifact types
        for in_name, type_name in self.inputs.items():
            if type_name not in ARTIFACTS:
                raise PipelineDefError(
                    f"pipeline input '{in_name}' has unknown artifact type '{type_name}' "
                    f"(have: {sorted(ARTIFACTS)})"
                )

        by_id = {s.id: s for s in self.stages}
        g = nx.DiGraph()
        for s in self.stages:
            if s.uses not in STAGES:
                raise PipelineDefError(
                    f"stage '{s.id}' uses unknown stage type '{s.uses}' "
                    f"(have: {STAGES.names()})"
                )
            g.add_node(s.id, ref=s)

        for s in self.stages:
            stage_cls = STAGES.get(s.uses)
            for in_name, ref in s.wire.items():
                if in_name not in stage_cls.inputs:
                    raise PipelineDefError(
                        f"stage '{s.id}' ({s.uses}) has no input '{in_name}' "
                        f"(inputs: {list(stage_cls.inputs)})"
                    )
                src, out = self._split_ref(ref)
                want = stage_cls.inputs[in_name]

                if src == INPUT_NS:
                    declared = self.inputs.get(out)
                    if declared is None:
                        raise PipelineDefError(
                            f"stage '{s.id}' wires '{in_name}' to undeclared pipeline "
                            f"input '@input.{out}' (declare it under 'inputs:')"
                        )
                    got = ARTIFACTS[declared]
                    if not issubclass(got, want):
                        raise PipelineDefError(
                            f"type mismatch at '{s.id}.{in_name}': needs {want.__name__}, "
                            f"pipeline input '{out}' is {got.__name__}"
                        )
                    continue

                if src not in by_id:
                    raise PipelineDefError(
                        f"stage '{s.id}' wire '{in_name}' references unknown stage '{src}'"
                    )
                up_cls = STAGES.get(by_id[src].uses)
                if out not in up_cls.outputs:
                    raise PipelineDefError(
                        f"stage '{s.id}' wire '{in_name}' references '{src}.{out}' but "
                        f"'{src}' ({by_id[src].uses}) has no output '{out}' "
                        f"(outputs: {list(up_cls.outputs)})"
                    )
                got = up_cls.outputs[out]
                if not issubclass(got, want):
                    raise PipelineDefError(
                        f"type mismatch at '{s.id}.{in_name}': needs {want.__name__}, "
                        f"'{src}.{out}' produces {got.__name__}"
                    )
                g.add_edge(src, s.id, input=in_name, output=out)

        # every declared stage input must be wired
        for s in self.stages:
            stage_cls = STAGES.get(s.uses)
            missing = [n for n in stage_cls.inputs if n not in s.wire]
            if missing:
                raise PipelineDefError(
                    f"stage '{s.id}' ({s.uses}) is missing wired inputs: {missing}"
                )

        if not nx.is_directed_acyclic_graph(g):
            raise PipelineDefError(
                f"pipeline '{self.name}' has a cycle: {nx.find_cycle(g)}"
            )
        return g
