from __future__ import annotations

import os
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterator

from .optional import require_dependency


BUCKET_NAME_ENV_KEYS = ("TAJWEED_BUCKET_NAME", "BUCKET")
BUCKET_REGION_ENV_KEYS = ("TAJWEED_BUCKET_REGION", "REGION", "AWS_DEFAULT_REGION")
BUCKET_ENDPOINT_ENV_KEYS = ("TAJWEED_BUCKET_ENDPOINT", "ENDPOINT", "AWS_ENDPOINT_URL_S3")
BUCKET_ACCESS_KEY_ENV_KEYS = ("TAJWEED_BUCKET_ACCESS_KEY_ID", "ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID")
BUCKET_SECRET_KEY_ENV_KEYS = (
    "TAJWEED_BUCKET_SECRET_ACCESS_KEY",
    "SECRET_ACCESS_KEY",
    "AWS_SECRET_ACCESS_KEY",
)
BUCKET_PREFIX_ENV_KEYS = ("TAJWEED_BUCKET_PREFIX",)


def _first_env_value(keys: tuple[str, ...]) -> str:
    for key in keys:
        value = os.getenv(key, "").strip()
        if value:
            return value
    return ""


@dataclass(frozen=True)
class BucketConfig:
    bucket_name: str
    region: str
    endpoint: str
    access_key_id: str
    secret_access_key: str
    prefix: str = ""

    @property
    def configured(self) -> bool:
        return all(
            (
                self.bucket_name,
                self.region,
                self.endpoint,
                self.access_key_id,
                self.secret_access_key,
            )
        )

    def redacted(self) -> dict[str, object]:
        payload = asdict(self)
        payload["configured"] = self.configured
        payload["access_key_id"] = bool(self.access_key_id)
        payload["secret_access_key"] = bool(self.secret_access_key)
        return payload


def load_bucket_config() -> BucketConfig:
    return BucketConfig(
        bucket_name=_first_env_value(BUCKET_NAME_ENV_KEYS),
        region=_first_env_value(BUCKET_REGION_ENV_KEYS),
        endpoint=_first_env_value(BUCKET_ENDPOINT_ENV_KEYS),
        access_key_id=_first_env_value(BUCKET_ACCESS_KEY_ENV_KEYS),
        secret_access_key=_first_env_value(BUCKET_SECRET_KEY_ENV_KEYS),
        prefix=_first_env_value(BUCKET_PREFIX_ENV_KEYS).strip("/"),
    )


def bucket_doctor() -> dict[str, object]:
    config = load_bucket_config()
    payload = config.redacted()
    payload["missing"] = [
        label
        for label, present in (
            ("bucket_name", bool(config.bucket_name)),
            ("region", bool(config.region)),
            ("endpoint", bool(config.endpoint)),
            ("access_key_id", bool(config.access_key_id)),
            ("secret_access_key", bool(config.secret_access_key)),
        )
        if not present
    ]
    return payload


def _bucket_client():
    config = load_bucket_config()
    if not config.configured:
        missing = ", ".join(bucket_doctor()["missing"])
        raise RuntimeError(f"Bucket is not configured. Missing: {missing}")
    boto3 = require_dependency("boto3", "boto3")
    client = boto3.client(
        "s3",
        region_name=config.region,
        endpoint_url=config.endpoint,
        aws_access_key_id=config.access_key_id,
        aws_secret_access_key=config.secret_access_key,
    )
    return config, client


def _iter_files(root: Path) -> Iterator[Path]:
    for path in sorted(root.rglob("*")):
        if path.is_file():
            yield path


def _join_prefix(*parts: str) -> str:
    cleaned = [part.strip("/") for part in parts if part and part.strip("/")]
    return "/".join(cleaned)


def upload_directory_to_bucket(local_path: str | Path, *, prefix: str = "") -> dict[str, object]:
    resolved_local_path = Path(local_path).expanduser().resolve()
    if not resolved_local_path.exists():
        raise FileNotFoundError(f"Local path not found: {resolved_local_path}")
    if not resolved_local_path.is_dir():
        raise ValueError(f"Expected a directory to upload: {resolved_local_path}")

    config, client = _bucket_client()
    uploaded = 0
    for file_path in _iter_files(resolved_local_path):
        relative_path = file_path.relative_to(resolved_local_path).as_posix()
        object_key = _join_prefix(config.prefix, prefix, relative_path)
        client.upload_file(str(file_path), config.bucket_name, object_key)
        uploaded += 1

    return {
        "bucket": config.bucket_name,
        "prefix": _join_prefix(config.prefix, prefix),
        "uploaded_files": uploaded,
        "local_path": str(resolved_local_path),
    }


def download_prefix_from_bucket(prefix: str, local_path: str | Path) -> dict[str, object]:
    resolved_local_path = Path(local_path).expanduser().resolve()
    resolved_local_path.mkdir(parents=True, exist_ok=True)

    config, client = _bucket_client()
    resolved_prefix = _join_prefix(config.prefix, prefix)
    paginator = client.get_paginator("list_objects_v2")
    downloaded = 0
    for page in paginator.paginate(Bucket=config.bucket_name, Prefix=resolved_prefix):
        for item in page.get("Contents", []):
            key = str(item.get("Key", ""))
            if not key or key.endswith("/"):
                continue
            relative_key = key[len(resolved_prefix):].lstrip("/") if resolved_prefix else key
            destination = resolved_local_path / relative_key
            destination.parent.mkdir(parents=True, exist_ok=True)
            client.download_file(config.bucket_name, key, str(destination))
            downloaded += 1

    return {
        "bucket": config.bucket_name,
        "prefix": resolved_prefix,
        "downloaded_files": downloaded,
        "local_path": str(resolved_local_path),
    }
