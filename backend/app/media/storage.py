"""Where finished videos are kept (owner, 2026-11-17): the owner's private AWS S3 bucket.

Both the AI video from fal.ai and the joined video with banners are stored here and played
through short-lived signed links. Credentials come only from boto3's own chain (environment
variables outside EC2, the instance role on EC2); this module never reads, logs or stores them.

Without a bucket (development, mock mode) there is no storage object and videos stay on local
disk, as before."""

from __future__ import annotations

import os
from typing import Any, Protocol

from ..core.config import Settings

VIDEO_CONTENT_TYPE = "video/mp4"


class VideoStorage(Protocol):
    def put(self, local_path: str | os.PathLike[str], key: str) -> None:
        """Store the file under `key`, replacing any object with that key. Raises on failure."""
        ...

    def url(self, key: str, filename: str | None = None) -> str:
        """A time-limited link to the object. With `filename`, the browser saves it under that
        name. Computed locally; makes no network call."""
        ...

    def delete(self, key: str) -> None: ...


class S3VideoStorage:
    """A private S3 bucket. `client` is a boto3 S3 client; tests pass a fake or one with dummy
    credentials so nothing reaches AWS."""

    def __init__(self, bucket: str, region: str, url_seconds: int, client: Any = None) -> None:
        if client is None:
            import boto3  # type: ignore[import-untyped]  # boto3 ships no type stubs
            from botocore.config import Config  # type: ignore[import-untyped]

            # SigV4 on the bucket's regional endpoint, so signed links work in every region
            # (the global endpoint can redirect a new bucket outside us-east-1).
            client = boto3.client(
                "s3",
                region_name=region,
                endpoint_url=f"https://s3.{region}.amazonaws.com",
                config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}),
            )
        self._client = client
        self.bucket = bucket
        self.url_seconds = url_seconds

    def put(self, local_path: str | os.PathLike[str], key: str) -> None:
        self._client.upload_file(
            str(local_path), self.bucket, key, ExtraArgs={"ContentType": VIDEO_CONTENT_TYPE}
        )

    def url(self, key: str, filename: str | None = None) -> str:
        params: dict[str, str] = {"Bucket": self.bucket, "Key": key}
        if filename is not None:
            params["ResponseContentDisposition"] = f'attachment; filename="{filename}"'
        return str(
            self._client.generate_presigned_url(
                "get_object", Params=params, ExpiresIn=self.url_seconds
            )
        )

    def delete(self, key: str) -> None:
        self._client.delete_object(Bucket=self.bucket, Key=key)


def build_video_storage(settings: Settings) -> VideoStorage | None:
    """S3 when a bucket is configured; otherwise None (videos stay on local disk)."""
    if not settings.s3_bucket:
        return None
    return S3VideoStorage(settings.s3_bucket, settings.s3_region, settings.s3_url_seconds)
