"""The metadata-draft eval harness: prove the scorer offline with fake models, and offer a
gated live run against a real one.

The point of the harness is to catch a *bad* model. So we test both directions: a
domain-aware fake passes; a fake that ignores the domain (leaks "weather" everywhere)
fails the anti-leak / relevance checks. No network in the default suite.
"""
from __future__ import annotations

import os

import pytest

from pipeline_engine.evals.metadata import (
    CASES,
    DRAFT_SCHEMA,
    build_draft_prompt,
    excludes_all,
    mentions_any,
    run_case,
    run_eval,
    well_formed,
)
from pipeline_engine.models import MODELS


class DomainAwareFake:
    """A stand-in 'good' model: reads the prompt and answers with domain-fit categorical
    fields, so it should pass every case."""

    def infer(self, *, prompt: str = "", json_schema=None, **_):
        p = prompt.lower()
        if "tumor" in p or "histology" in p:
            fields = [
                {"key": "stain_type", "scope": "scene", "type": "enum", "values": ["he", "ihc"]},
                {"key": "tissue_type", "scope": "scene", "type": "enum", "values": ["epithelial", "stromal"]},
                {"key": "magnification", "scope": "scene", "type": "enum", "values": ["10x", "40x"]},
                {"key": "tumor_grade", "scope": "instance", "type": "enum", "values": ["low", "high"]},
            ]
        elif "traffic" in p or "pedestrian" in p:
            fields = [
                {"key": "weather", "scope": "scene", "type": "enum", "values": ["clear", "rain"]},
                {"key": "time_of_day", "scope": "scene", "type": "enum", "values": ["day", "night"]},
                {"key": "road_type", "scope": "scene", "type": "enum", "values": ["highway", "urban"]},
                {"key": "occlusion", "scope": "instance", "type": "enum", "values": ["none", "partial"]},
            ]
        else:  # windsurf / default
            fields = [
                {"key": "weather", "scope": "scene", "type": "enum", "values": ["sunny", "overcast"]},
                {"key": "wave_state", "scope": "scene", "type": "enum", "values": ["flat", "choppy"]},
                {"key": "sail_color", "scope": "instance", "type": "enum", "values": ["red", "blue"]},
                {"key": "shot_distance", "scope": "scene", "type": "enum", "values": ["close", "wide"]},
            ]
        return {"fields": fields}


class LeakyFake:
    """A 'bad' model: always returns the windsurf schema regardless of domain — exactly the
    failure the harness must catch on non-windsurf datasets."""

    def infer(self, *, prompt: str = "", json_schema=None, **_):
        return {"fields": [
            {"key": "weather", "scope": "scene", "type": "enum", "values": ["sunny", "overcast"]},
            {"key": "wave_state", "scope": "scene", "type": "enum", "values": ["flat", "choppy"]},
            {"key": "sail_color", "scope": "instance", "type": "enum", "values": ["red", "blue"]},
            {"key": "shot_distance", "scope": "scene", "type": "enum", "values": ["close", "wide"]},
        ]}


def _with_model(name, handle):
    MODELS.register_instance(name, handle, capabilities=["metadata-extract"])
    return name


def _drop(name):
    MODELS._instances.pop(name, None)
    MODELS._caps.pop(name, None)


def test_prompt_mirrors_frontend_and_is_domain_neutral():
    prompt = build_draft_prompt("Histology tiles", "tumor detection", ["tumor", "stroma"])
    assert "Histology tiles" in prompt
    assert "tumor detection" in prompt
    assert "tumor, stroma" in prompt
    # the template itself must not seed a domain (the regression that started all this)
    for leaked in ("weather", "wave", "sail"):
        assert leaked not in prompt.lower()


def test_good_model_passes_every_case():
    name = _with_model("fake-good", DomainAwareFake())
    try:
        rep = run_eval(name)
        assert rep.cases_ok == len(CASES), format_failure(rep)
        assert rep.score == 1.0
    finally:
        _drop(name)


def test_harness_catches_a_leaky_model():
    name = _with_model("fake-leaky", LeakyFake())
    try:
        rep = run_eval(name)
        # windsurf case still passes (it *is* the windsurf schema); the others must fail
        by_id = {c.case_id: c for c in rep.cases}
        assert by_id["windsurf"].ok
        assert not by_id["histology"].ok
        assert not by_id["traffic"].ok
        assert rep.score < 1.0
    finally:
        _drop(name)


def test_checks_units():
    leaky = {"fields": [{"key": "weather", "scope": "scene", "type": "enum", "values": ["sunny"]}]}
    assert not excludes_all(["weather"])(leaky).passed
    assert mentions_any(["weather"])(leaky).passed
    malformed = {"fields": [{"key": "x", "scope": "planet", "type": "enum", "values": []}]}
    assert not well_formed()(malformed).passed


def test_model_error_is_a_result_not_a_crash():
    class Boom:
        def infer(self, **_):
            raise RuntimeError("no key")

    name = _with_model("fake-boom", Boom())
    try:
        rep = run_eval(name)
        assert rep.score == 0.0
        assert all(c.error and not c.ok for c in rep.cases)
    finally:
        _drop(name)


def format_failure(rep):
    from pipeline_engine.evals.metadata import format_report

    return "\n" + format_report(rep)


@pytest.mark.skipif(
    not (os.getenv("RUN_LLM_EVALS") and os.getenv("ANTHROPIC_API_KEY")),
    reason="live eval — set RUN_LLM_EVALS=1 and ANTHROPIC_API_KEY to run against the real model",
)
def test_claude_meets_the_bar():
    from pathlib import Path

    from pipeline_engine.config import load_models_yaml

    load_models_yaml(Path(__file__).resolve().parents[1] / "models.example.yaml")
    try:
        rep = run_eval("claude")
        assert rep.score >= 0.85, format_failure(rep)
    finally:
        MODELS._configs.pop("claude", None)
        MODELS._caps.pop("claude", None)
