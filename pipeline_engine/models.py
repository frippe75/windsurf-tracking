"""Model layer — the "smorgasbord" behind one uniform interface, decoupled from *where*
a model runs.

Three pieces:

* ``ModelHandle`` — the call contract: ``infer(**inputs) -> dict``.
* ``HANDLES`` — registry of handle *types* (e.g. ``openai-compat-http``), each a class
  constructed from a ``ModelConfig``. This is how a model is *served*.
* ``MODELS`` — maps a logical model name (what a pipeline references, e.g.
  ``"internvl3.5-8b"``) to a ``ModelConfig`` (or a pre-built instance, for local/fakes),
  and resolves it to a handle on demand.

The upshot: a pipeline says ``model: internvl3.5-8b`` and never learns whether that is a
lab GPU worker, a RunPod endpoint, or any OpenAI-compatible URL — that is pure config.
"""
from __future__ import annotations

from typing import Any, ClassVar, Protocol, runtime_checkable

from pydantic import BaseModel, ConfigDict, Field

from .errors import ModelError
from .registry import Registry


class ModelConfig(BaseModel):
    """How to reach/serve a model. No secret is ever stored inline — ``auth_env`` names
    an environment variable holding the API key, read at call time."""

    model_config = ConfigDict(extra="forbid")

    type: str  # handle type name, e.g. "openai-compat-http"
    model_name: str = ""  # id the endpoint expects (e.g. "OpenGVLab/InternVL3_5-8B"); blank for SAM
    #: what the model can do — consumers pick by capability, not by hardcoded name. e.g.
    #: "vlm-extract", "concept-segment" (text prompt), "segment-click", "detect", "embed".
    capabilities: list[str] = Field(default_factory=list)
    base_url: str | None = None
    auth_env: str | None = None  # name of env var holding the bearer token
    timeout_s: float = 60.0
    max_tokens: int = 1024
    temperature: float = 0.0
    strict_schema: bool = True  # send response_format as strict json_schema
    extra: dict[str, Any] = Field(default_factory=dict)  # merged into the request body


@runtime_checkable
class ModelHandle(Protocol):
    """A served model. Implementations lazy-import their transport/ML libs in ``infer``."""

    def infer(self, **inputs: Any) -> dict[str, Any]:
        ...


#: Registry of handle *types* (keyed by class-level ``name``), constructed from a ModelConfig.
HANDLES: "Registry[ModelHandle]" = Registry("pipeline_engine.model_handles")


class ModelRegistry:
    """Resolves a logical model name to a ``ModelHandle``.

    * ``configure(name, ModelConfig)`` — the normal path (lab/RunPod/BYOM endpoint).
    * ``register_instance(name, handle)`` — a pre-built handle (local worker, or a fake
      in tests).
    """

    def __init__(self) -> None:
        self._configs: dict[str, ModelConfig] = {}
        self._instances: dict[str, ModelHandle] = {}
        self._caps: dict[str, list[str]] = {}  # name -> capabilities

    def configure(self, name: str, config: ModelConfig) -> None:
        self._configs[name] = config
        self._caps[name] = list(config.capabilities)

    def register_instance(
        self, name: str, handle: ModelHandle, capabilities: list[str] | None = None
    ) -> None:
        self._instances[name] = handle
        if capabilities is not None:
            self._caps[name] = list(capabilities)

    def by_capability(self, capability: str) -> list[str]:
        """Registered model names that declare ``capability`` (sorted)."""
        return sorted(n for n, caps in self._caps.items() if capability in caps)

    def capabilities_of(self, name: str) -> list[str]:
        return list(self._caps.get(name, []))

    def get(self, name: str) -> ModelHandle:
        if name in self._instances:
            return self._instances[name]
        if name in self._configs:
            cfg = self._configs[name]
            try:
                handle_cls = HANDLES.get(cfg.type)
            except KeyError as exc:
                raise ModelError(
                    f"model '{name}' needs handle type '{cfg.type}' which is not registered "
                    f"(have: {HANDLES.names()})"
                ) from exc
            return handle_cls(cfg)  # type: ignore[call-arg]
        raise ModelError(
            f"no model '{name}' configured "
            f"(instances: {sorted(self._instances)}, configs: {sorted(self._configs)})"
        )

    def names(self) -> list[str]:
        return sorted(set(self._instances) | set(self._configs))

    def __contains__(self, name: object) -> bool:
        return name in self._instances or name in self._configs


#: The process-wide model registry. Populated by the app at startup (from settings/env)
#: and by tests. Empty by default — the engine ships no opinion about which models exist.
MODELS = ModelRegistry()
