"""Model layer: config resolution + the OpenAI-compatible HTTP handle (network mocked)."""
from __future__ import annotations

import json

import pytest

from pipeline_engine.errors import ModelError
from pipeline_engine.handles.openai_compat import OpenAICompatHandle
from pipeline_engine.models import HANDLES, MODELS, ModelConfig
from pipeline_engine.schemas import SailMeta


def test_handle_type_registered():
    assert "openai-compat-http" in HANDLES.names()


def test_registry_resolves_config_to_handle():
    MODELS.configure(
        "vlm-test",
        ModelConfig(type="openai-compat-http", model_name="m", base_url="http://x/v1"),
    )
    try:
        h = MODELS.get("vlm-test")
        assert isinstance(h, OpenAICompatHandle)
        assert h.config.model_name == "m"
    finally:
        MODELS._configs.pop("vlm-test", None)


def test_unknown_model_raises():
    with pytest.raises(ModelError, match="no model 'nope'"):
        MODELS.get("nope")


def test_handle_requires_base_url():
    with pytest.raises(ModelError, match="requires 'base_url'"):
        OpenAICompatHandle(ModelConfig(type="openai-compat-http", model_name="m"))


def test_openai_compat_infer_builds_request_and_parses(monkeypatch):
    import urllib.request

    captured: dict = {}

    class FakeResp:
        def __init__(self, data: bytes) -> None:
            self._data = data

        def read(self) -> bytes:
            return self._data

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def fake_urlopen(req, timeout=None):
        captured["url"] = req.full_url
        captured["body"] = json.loads(req.data.decode())
        captured["auth"] = req.get_header("Authorization")
        result = {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "brand": "Severne",
                                "model": "Blade",
                                "size_m2": 4.7,
                                "sail_number": None,
                                "primary_colors": ["blue"],
                            }
                        )
                    }
                }
            ]
        }
        return FakeResp(json.dumps(result).encode())

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setenv("RUNPOD_KEY", "secret-xyz")

    cfg = ModelConfig(
        type="openai-compat-http",
        model_name="OpenGVLab/InternVL3_5-8B",
        base_url="https://api.runpod.ai/v2/abc123/openai/v1",
        auth_env="RUNPOD_KEY",
    )
    out = OpenAICompatHandle(cfg).infer(
        image_png_base64="aGVsbG8=",
        json_schema=SailMeta.model_json_schema(),
        prompt="extract",
    )

    assert out["brand"] == "Severne" and out["model"] == "Blade"
    assert captured["url"].endswith("/openai/v1/chat/completions")
    assert captured["body"]["model"] == "OpenGVLab/InternVL3_5-8B"
    assert captured["body"]["response_format"]["type"] == "json_schema"
    assert captured["auth"] == "Bearer secret-xyz"
    parts = captured["body"]["messages"][0]["content"]
    assert any(p.get("type") == "image_url" for p in parts)


def test_openai_compat_missing_auth_env(monkeypatch):
    monkeypatch.delenv("RUNPOD_KEY", raising=False)
    cfg = ModelConfig(
        type="openai-compat-http", model_name="m",
        base_url="http://x/v1", auth_env="RUNPOD_KEY",
    )
    with pytest.raises(ModelError, match="auth env var"):
        cfg_handle = OpenAICompatHandle(cfg)
        cfg_handle.infer(image_png_base64="x", json_schema={"type": "object"})
