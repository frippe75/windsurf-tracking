"""
Pluggable dataset sinks — where a generated dataset goes.

Generation (generator.py) is destination-agnostic; a Sink takes the finished
dataset directory and publishes it. Adding a destination = implement DatasetSink
+ register it, with zero changes to generation. ClearML is just the first
optional plugin: it's a lazy import and reports available()==False when the SDK
or its config is absent, so the platform has no hard dependency on it.
"""
from pathlib import Path
from typing import Dict, Protocol, runtime_checkable


@runtime_checkable
class DatasetSink(Protocol):
    name: str
    def available(self) -> bool: ...
    def publish(self, dataset_dir: Path, meta: dict) -> dict: ...


class ZipSink:
    """Zip the dataset and upload to S3, returning a presigned download URL."""
    name = "zip"

    def available(self) -> bool:
        from .. import storage
        return storage.enabled()

    def publish(self, dataset_dir: Path, meta: dict) -> dict:
        import io
        import zipfile
        from .. import storage

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            for p in sorted(dataset_dir.rglob("*")):
                if p.is_file():
                    z.write(p, p.relative_to(dataset_dir).as_posix())
        data = buf.getvalue()
        fname = f"{meta['name']}.zip"
        key = f"exports/{meta['project_id']}/{fname}"
        storage.put_bytes(key, data, "application/zip")
        return {"kind": "zip", "url": storage.presigned_get(key, fname), "bytes": len(data)}


class ClearMLSink:
    """Publish as a versioned ClearML Dataset. Optional — only available when the
    clearml SDK is importable and configured."""
    name = "clearml"

    def available(self) -> bool:
        try:
            from clearml.config import get_config_for_bucket  # noqa: F401
            from clearml import Dataset  # noqa: F401
        except Exception:
            return False
        # Configured if a clearml.conf / env creds exist.
        try:
            from clearml.backend_api import Session
            return bool(Session.get_api_server_host())
        except Exception:
            return False

    def publish(self, dataset_dir: Path, meta: dict) -> dict:
        from clearml import Dataset
        ds = Dataset.create(
            dataset_name=meta["name"],
            dataset_project=meta.get("clearml_project", "windsurf-datasets"),
        )
        ds.add_files(str(dataset_dir))
        ds.upload()
        ds.finalize()
        return {"kind": "clearml", "id": ds.id, "name": meta["name"]}


# Order matters: first registered is the default.
_ALL = [ZipSink(), ClearMLSink()]


def available_sinks() -> Dict[str, DatasetSink]:
    out = {}
    for s in _ALL:
        try:
            if s.available():
                out[s.name] = s
        except Exception:
            pass
    return out


def get_sink(name: str | None):
    sinks = available_sinks()
    if not sinks:
        return None
    if name is None:
        return next(iter(sinks.values()))  # default = first available
    return sinks.get(name)
