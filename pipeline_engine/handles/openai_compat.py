"""OpenAI-compatible HTTP model handle.

Talks the OpenAI chat-completions + structured-output (``response_format: json_schema``)
contract, so the *same* handle serves a RunPod serverless endpoint, a local vLLM/LMDeploy
server, or any hosted OpenAI-compatible API — only ``base_url``/``model_name`` change. No
vendor lock-in, and no new dependency: it uses stdlib ``urllib`` (imported lazily).

This is the safe half of "bring your own model": a deployer points at an *endpoint*
(URL + model + an env-var name for the key). No foreign code runs in-process.
"""
from __future__ import annotations

from typing import Any, ClassVar

from ..errors import ModelError
from ..models import HANDLES, ModelConfig


@HANDLES.register
class OpenAICompatHandle:
    name: ClassVar[str] = "openai-compat-http"

    def __init__(self, config: ModelConfig) -> None:
        if not config.base_url:
            raise ModelError("openai-compat-http handle requires 'base_url'")
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
            {"type": "text", "text": prompt or "Extract the requested fields as JSON."}
        ]
        if image_png_base64:
            content.append(
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/png;base64,{image_png_base64}"},
                }
            )

        body: dict[str, Any] = {
            "model": cfg.model_name,
            "messages": [{"role": "user", "content": content}],
            "max_tokens": cfg.max_tokens,
            "temperature": cfg.temperature,
        }
        if json_schema is not None:
            body["response_format"] = {
                "type": "json_schema",
                "json_schema": {
                    "name": "extract",
                    "schema": json_schema,
                    "strict": cfg.strict_schema,
                },
            }
        body.update(cfg.extra)

        headers = {"Content-Type": "application/json"}
        if cfg.auth_env:
            key = os.environ.get(cfg.auth_env)
            if not key:
                raise ModelError(
                    f"auth env var '{cfg.auth_env}' is unset for model '{cfg.model_name}'"
                )
            headers["Authorization"] = f"Bearer {key}"

        url = cfg.base_url.rstrip("/") + "/chat/completions"
        req = urllib.request.Request(
            url, data=json.dumps(body).encode(), headers=headers, method="POST"
        )
        try:
            with urllib.request.urlopen(req, timeout=cfg.timeout_s) as resp:
                payload = json.loads(resp.read().decode())
        except urllib.error.HTTPError as exc:  # pragma: no cover - network path
            detail = exc.read().decode(errors="replace")[:500]
            raise ModelError(f"model endpoint {url} returned {exc.code}: {detail}") from exc
        except urllib.error.URLError as exc:  # pragma: no cover - network path
            raise ModelError(f"cannot reach model endpoint {url}: {exc.reason}") from exc

        try:
            text = payload["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise ModelError(f"unexpected completion payload: {payload!r}") from exc

        if isinstance(text, dict):
            return text
        try:
            return json.loads(text)
        except (json.JSONDecodeError, TypeError) as exc:
            raise ModelError(f"model did not return JSON content: {text!r}") from exc
