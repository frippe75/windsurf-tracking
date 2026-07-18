"""Guardrail: the engine core must stay dependency-light and app-agnostic.

No module in ``pipeline_engine`` may import — at *module load time* — an ML stack, the
backend app, an orchestrator, or storage. Heavy libs are allowed only lazily (inside
functions), which this test permits by not descending into function bodies.
"""
from __future__ import annotations

import ast
from pathlib import Path

import pipeline_engine

ROOT = Path(pipeline_engine.__file__).parent

FORBIDDEN_ROOTS = {
    "app",          # the backend application
    "torch", "transformers", "vllm", "lmdeploy", "ultralytics",  # ML stacks
    "cv2", "PIL", "numpy",                                        # heavy vision libs
    "celery", "fastapi", "sqlalchemy", "clearml", "boto3",       # infra / orchestrators
}


def _module_level_import_roots(tree: ast.AST) -> list[str]:
    """Collect top-level import roots, NOT descending into function bodies."""
    roots: list[str] = []

    def visit(node: ast.AST) -> None:
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue  # lazy imports inside functions are allowed
            if isinstance(child, ast.Import):
                roots.extend(a.name.split(".")[0] for a in child.names)
            elif isinstance(child, ast.ImportFrom):
                if child.level == 0 and child.module:  # absolute import only
                    roots.append(child.module.split(".")[0])
            else:
                visit(child)

    visit(tree)
    return roots


def test_core_has_no_heavy_or_app_imports():
    offenders: dict[str, set[str]] = {}
    for path in ROOT.rglob("*.py"):
        if "tests" in path.parts:
            continue
        tree = ast.parse(path.read_text(), filename=str(path))
        bad = set(_module_level_import_roots(tree)) & FORBIDDEN_ROOTS
        if bad:
            offenders[str(path.relative_to(ROOT))] = bad
    assert not offenders, f"module-level forbidden imports found: {offenders}"
