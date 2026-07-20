"""SAM3 VIDEO-tracking handle — calls the RunPod serverless SAM3 *video* worker.

Tracking runs for minutes, so this uses RunPod's ASYNC protocol (POST <base_url>/run ->
job id; GET <base_url>/status/<id> -> {status, output}) rather than the synchronous /runsync
the image handle uses. Because it's async, it exposes ``submit`` + ``poll`` instead of the
synchronous ``infer`` contract — the pipeline_service drives it via dedicated /track routes.

Frames are PUSHED in the request (the RunPod worker cannot reach the lab S3); the caller
(pipeline_service) extracts the window in-cluster and passes ``frames_b64``.
No ML in-process — stdlib urllib only.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any, ClassVar

from ..errors import ModelError
from ..models import HANDLES, ModelConfig


@HANDLES.register
class Sam3RunpodTrackHandle:
    name: ClassVar[str] = "sam3-runpod-track"

    def __init__(self, config: ModelConfig) -> None:
        if not config.base_url:
            raise ModelError("sam3-runpod-track handle requires base_url (https://api.runpod.ai/v2/<id>)")
        self.config = config

    def _headers(self) -> dict[str, str]:
        cfg = self.config
        headers = {
            "Content-Type": "application/json",
            "User-Agent": cfg.extra.get("user_agent", "pipeline-engine/0.1"),
        }
        if cfg.auth_env:
            key = os.environ.get(cfg.auth_env)
            if not key:
                raise ModelError(f"auth env var '{cfg.auth_env}' is unset for the SAM3 video endpoint")
            headers["Authorization"] = f"Bearer {key}"
        return headers

    def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        url = self.config.base_url.rstrip("/") + path
        req = urllib.request.Request(
            url, data=json.dumps(body).encode(), headers=self._headers(), method="POST"
        )
        try:
            with urllib.request.urlopen(req, timeout=self.config.timeout_s) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as exc:  # pragma: no cover - network
            raise ModelError(f"SAM3 video endpoint {url} returned {exc.code}: {exc.read()[:400]!r}") from exc
        except urllib.error.URLError as exc:  # pragma: no cover - network
            raise ModelError(f"cannot reach SAM3 video endpoint {url}: {exc.reason}") from exc

    def _get(self, path: str) -> dict[str, Any]:
        url = self.config.base_url.rstrip("/") + path
        req = urllib.request.Request(url, headers=self._headers(), method="GET")
        try:
            with urllib.request.urlopen(req, timeout=self.config.timeout_s) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as exc:  # pragma: no cover - network
            raise ModelError(f"SAM3 video endpoint {url} returned {exc.code}: {exc.read()[:400]!r}") from exc
        except urllib.error.URLError as exc:  # pragma: no cover - network
            raise ModelError(f"cannot reach SAM3 video endpoint {url}: {exc.reason}") from exc

    def submit(self, *, frames_b64: list[str], start_frame: int, text: str) -> str:
        """Kick off a tracking job; returns the RunPod job id."""
        out = self._post("/run", {"input": {
            "frames_b64": frames_b64, "start_frame": start_frame, "text": text,
        }})
        job_id = out.get("id")
        if not job_id:
            raise ModelError(f"SAM3 video /run returned no job id: {out!r}")
        return job_id

    def poll(self, *, job_id: str) -> dict[str, Any]:
        """Return {status, output?} for a submitted job. status is RunPod's
        IN_QUEUE|IN_PROGRESS|COMPLETED|FAILED (plus top-level error if the worker errored)."""
        st = self._get(f"/status/{job_id}")
        status = st.get("status", "UNKNOWN")
        result: dict[str, Any] = {"status": status}
        if st.get("error"):
            result["error"] = st["error"]
        out = st.get("output")
        if isinstance(out, dict):
            if out.get("error"):
                result["error"] = out["error"]
            else:
                result["output"] = out
        return result
