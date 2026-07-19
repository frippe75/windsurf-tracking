"""SAM2 handle — calls the deployed backend's click-prompt segment endpoint.

SAM2's "segment-click" capability: a click (native pixel point) on an uploaded video frame
-> a mask + bbox, used to seed tracking. Matches the backend contract:
  POST <base_url>/segment  { video_id, frame_number, click_prompts:[{x,y,type}] }
  -> { results: { bbox:[x1,y1,x2,y2], mask_base64, score, center } }
Serving is config: base_url = the lab backend (local) or any SAM2 server (external).
stdlib urllib only.
"""
from __future__ import annotations

from typing import Any, ClassVar

from ..errors import ModelError
from ..models import HANDLES, ModelConfig


@HANDLES.register
class Sam2HttpHandle:
    name: ClassVar[str] = "sam2-http"

    def __init__(self, config: ModelConfig) -> None:
        if not config.base_url:
            raise ModelError("sam2-http handle requires base_url (the SAM2 segment API base)")
        self.config = config

    def infer(
        self,
        *,
        video_id: str,
        frame_number: int,
        points: list[dict[str, Any]],
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
            if key:
                headers["Authorization"] = f"Bearer {key}"

        body = {"video_id": video_id, "frame_number": frame_number, "click_prompts": points}
        url = cfg.base_url.rstrip("/") + "/segment"
        req = urllib.request.Request(
            url, data=json.dumps(body).encode(), headers=headers, method="POST"
        )
        try:
            with urllib.request.urlopen(req, timeout=cfg.timeout_s) as resp:
                payload = json.loads(resp.read().decode())
        except urllib.error.HTTPError as exc:  # pragma: no cover - network
            raise ModelError(f"SAM2 endpoint {url} returned {exc.code}: {exc.read()[:400]!r}") from exc
        except urllib.error.URLError as exc:  # pragma: no cover - network
            raise ModelError(f"cannot reach SAM2 endpoint {url}: {exc.reason}") from exc

        results = payload.get("results", payload)
        if not isinstance(results, dict) or "bbox" not in results:
            raise ModelError(f"SAM2 returned unexpected payload: {payload!r}")
        return {
            "bbox": results.get("bbox"),
            "mask_base64": results.get("mask_base64"),
            "score": results.get("score"),
        }
