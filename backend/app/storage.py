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
    """Upload a video file with its metadata (values stringified)."""
    meta = {k: str(v) for k, v in metadata.items()}
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
