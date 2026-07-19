"""A tiny name->class registry with stdlib entry-point discovery.

Built-in implementations register via the ``@REGISTRY.register`` decorator (they are
imported eagerly by ``pipeline_engine`` on first use). Third-party plugins register by
declaring an entry point in the matching group, discovered lazily on the first miss.
No external dependency — this is all stdlib.
"""
from __future__ import annotations

import importlib.metadata as importlib_metadata
from typing import Generic, TypeVar

T = TypeVar("T")


class Registry(Generic[T]):
    def __init__(self, group: str) -> None:
        self._group = group
        self._items: dict[str, type[T]] = {}
        self._loaded_entry_points = False

    def register(self, cls: type[T]) -> type[T]:
        """Register ``cls`` under its class-level ``name``. Usable as a decorator."""
        name = getattr(cls, "name", None)
        if not name or not isinstance(name, str):
            raise ValueError(f"{cls!r} must set a non-empty class-level 'name'")
        self._items[name] = cls
        return cls

    def _load_entry_points(self) -> None:
        if self._loaded_entry_points:
            return
        self._loaded_entry_points = True
        try:
            eps = importlib_metadata.entry_points(group=self._group)
        except TypeError:  # pragma: no cover - Python <3.10 API shape
            eps = importlib_metadata.entry_points().get(self._group, [])
        for ep in eps:
            try:
                self.register(ep.load())
            except Exception:  # pragma: no cover - a broken plugin must not kill the core
                continue

    def get(self, name: str) -> type[T]:
        if name not in self._items:
            self._load_entry_points()
        if name not in self._items:
            raise KeyError(
                f"no '{name}' registered in group '{self._group}' (have: {self.names()})"
            )
        return self._items[name]

    def names(self) -> list[str]:
        self._load_entry_points()
        return sorted(self._items)

    def __contains__(self, name: object) -> bool:
        if isinstance(name, str) and name in self._items:
            return True
        self._load_entry_points()
        return name in self._items
