"""SAM3 model handle — calls the RunPod serverless SAM3 worker (native /runsync).

Unlike the OpenAI-compatible VLM handle, SAM3's worker uses RunPod's own job protocol:
POST <base_url>/runsync with {"input": {...}} -> {"output": {...}}. base_url is the
endpoint base ``https://api.runpod.ai/v2/<ENDPOINT_ID>``; auth via ``auth_env``.
No ML in-process — stdlib urllib only.
"""
from __future__ import annotations

from typing import Any, ClassVar

from ..errors import ModelError
from ..models import HANDLES, ModelConfig


@HANDLES.register
class Sam3RunpodHandle:
    name: ClassVar[str] = "sam3-runpod"

    def __init__(self, config: ModelConfig) -> None:
        if not config.base_url:
            raise ModelError("sam3-runpod handle requires base_url (https://api.runpod.ai/v2/<id>)")
        self.config = config

    def infer(
        self,
        *,
        image_png_base64: str,
        text: str,
        **_: Any,
    ) -> dict[str, Any]:
        import json
        import os
        import urllib.error
        import urllib.request

        cfg = self.config
        headers = {
            "Content-Type": "application/json",
            "User-Agent": cfg.extra.get("user_agent", "pipeline-engine/0.1"),
        }
        if cfg.auth_env:
            key = os.environ.get(cfg.auth_env)
            if not key:
                raise ModelError(f"auth env var '{cfg.auth_env}' is unset for the SAM3 endpoint")
            headers["Authorization"] = f"Bearer {key}"

        body = {"input": {"image_base64": image_png_base64, "text": text}}
        url = cfg.base_url.rstrip("/") + "/runsync"
        req = urllib.request.Request(
            url, data=json.dumps(body).encode(), headers=headers, method="POST"
        )
        try:
            with urllib.request.urlopen(req, timeout=cfg.timeout_s) as resp:
                payload = json.loads(resp.read().decode())
        except urllib.error.HTTPError as exc:  # pragma: no cover - network
            raise ModelError(f"SAM3 endpoint {url} returned {exc.code}: {exc.read()[:400]!r}") from exc
        except urllib.error.URLError as exc:  # pragma: no cover - network
            raise ModelError(f"cannot reach SAM3 endpoint {url}: {exc.reason}") from exc

        out = payload.get("output", payload)
        if not isinstance(out, dict):
            raise ModelError(f"SAM3 returned unexpected payload: {payload!r}")
        if out.get("error"):
            raise ModelError(f"SAM3 worker error: {out['error']}")
        # normalise to {"detections": [{"bbox":[x1,y1,x2,y2], "score":..}, ...]}
        return {"detections": out.get("detections", [])}
