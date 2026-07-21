"""Anthropic (Claude) vision handle — for metadata extraction from a frame / frame-grid.

Talks the Anthropic Messages API (``POST {base_url}/messages``). Structured JSON is forced via a
single tool whose ``input_schema`` is the caller's json_schema, with ``tool_choice`` pinned to it —
the model must reply with a ``tool_use`` block whose ``input`` IS the structured result. This is the
reliable way to get schema-conformant JSON out of Claude.

Like the other handles: no vendor SDK, stdlib ``urllib`` only, imported lazily so the engine core
import-boundary stays clean. A deployer points at the endpoint (URL + model + an env var for the key).
"""
from __future__ import annotations

from typing import Any, ClassVar

from ..errors import ModelError
from ..models import HANDLES, ModelConfig


@HANDLES.register
class AnthropicHandle:
    name: ClassVar[str] = "anthropic"

    def __init__(self, config: ModelConfig) -> None:
        if not config.base_url:
            raise ModelError("anthropic handle requires 'base_url' (e.g. https://api.anthropic.com/v1)")
        self.config = config

    def infer(
        self,
        *,
        prompt: str | None = None,
        image_png_base64: str | None = None,
        json_schema: dict[str, Any] | None = None,
        **_: Any,
    ) -> dict[str, Any]:
        import json
        import os
        import urllib.error
        import urllib.request

        cfg = self.config

        content: list[dict[str, Any]] = [
            {"type": "text", "text": prompt or "Extract the requested fields."}
        ]
        if image_png_base64:
            content.append(
                {
                    "type": "image",
                    "source": {"type": "base64", "media_type": "image/png", "data": image_png_base64},
                }
            )

        # NB: no `temperature` — deprecated on newer Claude models (400). Set it via `extra` if ever needed.
        body: dict[str, Any] = {
            "model": cfg.model_name,
            "max_tokens": cfg.max_tokens,
            "messages": [{"role": "user", "content": content}],
        }
        if json_schema is not None:
            # force a single tool call whose input is the structured result
            body["tools"] = [{
                "name": "extract",
                "description": "Return the extracted fields as structured data.",
                "input_schema": json_schema,
            }]
            body["tool_choice"] = {"type": "tool", "name": "extract"}
        # anthropic-specific extras (e.g. anthropic_version override, thinking) live under extra
        extra = dict(cfg.extra)
        anthropic_version = extra.pop("anthropic_version", "2023-06-01")
        extra.pop("user_agent", None)
        body.update(extra)

        if not cfg.auth_env:
            raise ModelError("anthropic handle requires 'auth_env' (the env var holding the API key)")
        key = os.environ.get(cfg.auth_env)
        if not key:
            raise ModelError(f"auth env var '{cfg.auth_env}' is unset for model '{cfg.model_name}'")
        headers = {
            "content-type": "application/json",
            "x-api-key": key,
            "anthropic-version": anthropic_version,
        }

        url = cfg.base_url.rstrip("/") + "/messages"
        req = urllib.request.Request(
            url, data=json.dumps(body).encode(), headers=headers, method="POST"
        )
        try:
            with urllib.request.urlopen(req, timeout=cfg.timeout_s) as resp:
                payload = json.loads(resp.read().decode())
        except urllib.error.HTTPError as exc:  # pragma: no cover - network path
            detail = exc.read().decode(errors="replace")[:500]
            raise ModelError(f"anthropic endpoint {url} returned {exc.code}: {detail}") from exc
        except urllib.error.URLError as exc:  # pragma: no cover - network path
            raise ModelError(f"cannot reach anthropic endpoint {url}: {exc.reason}") from exc

        if isinstance(payload, dict) and payload.get("error"):
            raise ModelError(f"anthropic error: {payload['error']}")

        blocks = payload.get("content") if isinstance(payload, dict) else None
        if not isinstance(blocks, list):
            raise ModelError(f"unexpected anthropic payload: {payload!r}")
        # structured path: the tool_use block's input is the result
        for b in blocks:
            if isinstance(b, dict) and b.get("type") == "tool_use" and isinstance(b.get("input"), dict):
                return b["input"]
        # fallback: a text block that is JSON
        for b in blocks:
            if isinstance(b, dict) and b.get("type") == "text":
                try:
                    return json.loads(b.get("text", ""))
                except (json.JSONDecodeError, TypeError):
                    break
        raise ModelError(f"anthropic returned no structured content: {payload!r}")
