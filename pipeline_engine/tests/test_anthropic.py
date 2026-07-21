"""Anthropic handle: forced-tool structured output over the Messages API (mocked urllib)."""
from __future__ import annotations

import io
import json

import pytest

from pipeline_engine.errors import ModelError
from pipeline_engine.models import HANDLES, ModelConfig


def _resp(payload):
    class R(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    return R(json.dumps(payload).encode())


def _handle(**kw):
    cfg = ModelConfig(
        type="anthropic",
        capabilities=["metadata-extract"],
        base_url="https://api.anthropic.com/v1",
        auth_env="ANTHROPIC_API_KEY",
        model_name="claude-sonnet-5",
        timeout_s=5,
        **kw,
    )
    return HANDLES.get("anthropic")(cfg)


def test_registered():
    assert "anthropic" in HANDLES.names()


def test_forces_tool_and_parses_tool_use(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    seen = {}

    def fake_urlopen(req, timeout=None):
        seen["url"] = req.full_url
        seen["headers"] = {k.lower(): v for k, v in req.headers.items()}
        seen["body"] = json.loads(req.data.decode())
        return _resp({"content": [{"type": "tool_use", "name": "extract", "input": {"weather": "sunny", "sail_color": "red"}}]})

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    out = _handle().infer(
        prompt="describe",
        image_png_base64="AAAA",
        json_schema={"type": "object", "properties": {"weather": {"type": "string"}}},
    )
    assert out == {"weather": "sunny", "sail_color": "red"}
    assert seen["url"].endswith("/messages")
    assert seen["headers"]["x-api-key"] == "sk-ant-test"
    assert seen["headers"]["anthropic-version"] == "2023-06-01"
    assert "authorization" not in seen["headers"]  # anthropic uses x-api-key, not bearer
    assert seen["body"]["tool_choice"] == {"type": "tool", "name": "extract"}
    kinds = [b["type"] for b in seen["body"]["messages"][0]["content"]]
    assert "image" in kinds and "text" in kinds
    img = next(b for b in seen["body"]["messages"][0]["content"] if b["type"] == "image")
    assert img["source"] == {"type": "base64", "media_type": "image/png", "data": "AAAA"}


def test_missing_key_raises(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(ModelError):
        _handle().infer(prompt="x", json_schema={"type": "object"})


def test_error_payload_raises(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    monkeypatch.setattr("urllib.request.urlopen", lambda req, timeout=None: _resp({"error": {"type": "overloaded_error"}}))
    with pytest.raises(ModelError):
        _handle().infer(prompt="x", json_schema={"type": "object"})


def test_text_block_json_fallback(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    monkeypatch.setattr("urllib.request.urlopen", lambda req, timeout=None: _resp({"content": [{"type": "text", "text": "{\"a\": 1}"}]}))
    assert _handle().infer(prompt="x") == {"a": 1}
