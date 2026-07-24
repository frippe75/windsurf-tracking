"""Trained-YOLO handle — calls the on-prem ``yolo-serve`` service, which loads a project's trained
``best.pt`` by dataset version (from S3) and runs detection. Serving is in-cluster (no auth), cheap,
and keeps GPUs free for training. stdlib urllib only — no ML in-process.

Contract: ``infer(image_png_base64, version_id, conf) -> {"detections": [...], "width", "height"}``.
"""
from __future__ import annotations

from typing import Any, ClassVar

from ..errors import ModelError
from ..models import HANDLES, ModelConfig


@HANDLES.register
class YoloHttpHandle:
    name: ClassVar[str] = "yolo-http"

    def __init__(self, config: ModelConfig) -> None:
        if not config.base_url:
            raise ModelError("yolo-http handle requires base_url (the yolo-serve service)")
        self.config = config

    def infer(
        self,
        *,
        image_png_base64: str | None = None,
        version_id: str | None = None,
        conf: float = 0.25,
        **_: Any,
    ) -> dict[str, Any]:
        import json
        import urllib.error
        import urllib.request

        if not image_png_base64 or not version_id:
            raise ModelError("yolo detect needs image_png_base64 + version_id")
        cfg = self.config
        url = cfg.base_url.rstrip("/") + "/detect"
        body = {"version_id": version_id, "image_png_base64": image_png_base64, "conf": conf}
        req = urllib.request.Request(
            url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}, method="POST"
        )
        try:
            with urllib.request.urlopen(req, timeout=cfg.timeout_s) as resp:
                payload = json.loads(resp.read().decode())
        except urllib.error.HTTPError as exc:  # pragma: no cover - network
            raise ModelError(f"yolo-serve {url} returned {exc.code}: {exc.read()[:400]!r}") from exc
        except urllib.error.URLError as exc:  # pragma: no cover - network
            raise ModelError(f"cannot reach yolo-serve {url}: {exc.reason}") from exc

        if isinstance(payload, dict) and payload.get("error"):
            raise ModelError(f"yolo-serve error: {payload['error']}")
        return {
            "detections": payload.get("detections", []),
            "width": payload.get("width"),
            "height": payload.get("height"),
        }
