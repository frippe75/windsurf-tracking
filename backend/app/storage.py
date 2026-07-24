"""
S3 (Ceph RGW) video storage.

Videos are canonical in S3; the local uploads dir is a pod-lifetime cache for
processing paths (OpenCV/ffmpeg/SAM2 need local files). Presigned GET URLs are
generated against the public endpoint so browsers can stream (RGW supports
HTTP Range, unlike the /download proxy).

When S3 env vars are absent, enabled() is False and callers fall back to the
legacy local-files-only behavior.
"""

import os
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger("windsurf_debug")

S3_BUCKET = os.getenv("S3_BUCKET", "windsurf-videos")
S3_ENDPOINT = os.getenv("S3_ENDPOINT", "")
S3_PUBLIC_ENDPOINT = os.getenv("S3_PUBLIC_ENDPOINT", "https://s3.tclab.org")
S3_ACCESS_KEY = os.getenv("S3_ACCESS_KEY", "")
S3_SECRET_KEY = os.getenv("S3_SECRET_KEY", "")
PRESIGN_EXPIRY = int(os.getenv("S3_PRESIGN_EXPIRY", "3600"))

# Same dir the legacy code used, so file_path semantics stay unchanged
LOCAL_CACHE_DIR = Path(os.getenv("VIDEO_CACHE_DIR", str(Path(__file__).parent.parent / "uploads")))

_internal = None
_public = None


def enabled() -> bool:
    return bool(S3_ENDPOINT and S3_ACCESS_KEY and S3_SECRET_KEY)


def _client(endpoint: str):
    import boto3
    from botocore.config import Config
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=S3_ACCESS_KEY,
        aws_secret_access_key=S3_SECRET_KEY,
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
        region_name="us-east-1",
    )


def internal():
    """Client for data-path operations (in-cluster endpoint)."""
    global _internal
    if _internal is None:
        _internal = _client(S3_ENDPOINT)
    return _internal


def public():
    """Client used ONLY to presign URLs the browser will fetch — the SigV4
    signature covers the host, so it must be the public endpoint."""
    global _public
    if _public is None:
        _public = _client(S3_PUBLIC_ENDPOINT)
    return _public


def _key(video_id: str) -> str:
    return f"videos/{video_id}.mp4"


def upload_video(video_id: str, local_path: str, metadata: dict) -> None:
    """Upload a video file with its metadata (values stringified).
    S3 metadata only accepts ASCII — sanitize defensively (non-ASCII → '?')."""
    meta = {k: str(v).encode("ascii", "replace").decode() for k, v in metadata.items()}
    internal().upload_file(
        str(local_path), S3_BUCKET, _key(video_id),
        ExtraArgs={"Metadata": meta, "ContentType": "video/mp4"},
    )
    logger.info(f"S3: uploaded {video_id} ({metadata.get('filename')})")


def list_videos() -> list:
    """Return [{'video_id', 'size', 'metadata'}] for every video in the bucket."""
    out = []
    paginator = internal().get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=S3_BUCKET, Prefix="videos/"):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if not key.endswith(".mp4"):
                continue
            head = internal().head_object(Bucket=S3_BUCKET, Key=key)
            out.append({
                "video_id": Path(key).stem,
                "size": obj["Size"],
                "last_modified": obj["LastModified"],
                "metadata": head.get("Metadata", {}),
            })
    return out


def list_video_ids() -> list:
    """Cheap: just the video ids present in the bucket (no per-object HEAD)."""
    ids = []
    paginator = internal().get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=S3_BUCKET, Prefix="videos/"):
        for obj in page.get("Contents", []):
            if obj["Key"].endswith(".mp4"):
                ids.append(Path(obj["Key"]).stem)
    return ids


def head_metadata(video_id: str) -> dict:
    """Object metadata for one video (filename, fps, dimensions, ...)."""
    head = internal().head_object(Bucket=S3_BUCKET, Key=_key(video_id))
    return head.get("Metadata", {})


def ensure_local(video_id: str) -> Optional[Path]:
    """Return a local path for the video, downloading from S3 if needed."""
    local = LOCAL_CACHE_DIR / f"{video_id}.mp4"
    if local.exists() and local.stat().st_size > 0:
        return local
    if not enabled():
        return local if local.exists() else None
    LOCAL_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = local.with_suffix(".part")
    try:
        internal().download_file(S3_BUCKET, _key(video_id), str(tmp))
        tmp.rename(local)
        logger.info(f"S3: cached {video_id} locally")
        return local
    except Exception as e:
        tmp.unlink(missing_ok=True)
        logger.error(f"S3: fetch failed for {video_id}: {e}")
        return None


def presigned_url(video_id: str, filename: str = "") -> str:
    params = {"Bucket": S3_BUCKET, "Key": _key(video_id)}
    if filename:
        params["ResponseContentDisposition"] = f'inline; filename="{filename}"'
    return public().generate_presigned_url(
        "get_object", Params=params, ExpiresIn=PRESIGN_EXPIRY
    )


def delete_video(video_id: str) -> None:
    if enabled():
        internal().delete_object(Bucket=S3_BUCKET, Key=_key(video_id))
    (LOCAL_CACHE_DIR / f"{video_id}.mp4").unlink(missing_ok=True)


# --- generic object helpers (used by dataset export, not video-specific) -----
def put_bytes(key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
    """Upload raw bytes to an arbitrary bucket key."""
    internal().put_object(Bucket=S3_BUCKET, Key=key, Body=data, ContentType=content_type)


def put_file(key: str, path: str, content_type: str = "application/octet-stream") -> None:
    """Upload a file to a bucket key by streaming from disk (never reads it fully into RAM).
    Used by dataset export so a large zip doesn't balloon the process memory."""
    internal().upload_file(str(path), S3_BUCKET, key, ExtraArgs={"ContentType": content_type})


def get_bytes(key: str) -> bytes:
    """Download an arbitrary bucket key into memory (used by the frame cache)."""
    return internal().get_object(Bucket=S3_BUCKET, Key=key)["Body"].read()


def object_exists(key: str) -> bool:
    """True if the bucket key exists (cheap HEAD). Any error → treat as absent."""
    try:
        internal().head_object(Bucket=S3_BUCKET, Key=key)
        return True
    except Exception:
        return False


def list_keys(prefix: str) -> list:
    """All object keys under a prefix (used to enumerate a version's model-runs for lineage)."""
    out = []
    paginator = internal().get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=S3_BUCKET, Prefix=prefix):
        for obj in page.get("Contents", []):
            out.append(obj["Key"])
    return out


def presigned_get(key: str, filename: str = "") -> str:
    """Presign a browser-fetchable GET URL for any bucket key."""
    params = {"Bucket": S3_BUCKET, "Key": key}
    if filename:
        params["ResponseContentDisposition"] = f'attachment; filename="{filename}"'
    return public().generate_presigned_url("get_object", Params=params, ExpiresIn=PRESIGN_EXPIRY)
