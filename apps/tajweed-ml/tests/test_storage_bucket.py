from pathlib import Path

from tajweed_ml.storage_bucket import bucket_doctor, load_bucket_config, upload_directory_to_bucket


def test_bucket_doctor_reports_missing(monkeypatch) -> None:
    monkeypatch.delenv("TAJWEED_BUCKET_NAME", raising=False)
    monkeypatch.delenv("BUCKET", raising=False)
    monkeypatch.delenv("TAJWEED_BUCKET_REGION", raising=False)
    monkeypatch.delenv("REGION", raising=False)
    monkeypatch.delenv("TAJWEED_BUCKET_ENDPOINT", raising=False)
    monkeypatch.delenv("ENDPOINT", raising=False)
    monkeypatch.delenv("TAJWEED_BUCKET_ACCESS_KEY_ID", raising=False)
    monkeypatch.delenv("ACCESS_KEY_ID", raising=False)
    monkeypatch.delenv("TAJWEED_BUCKET_SECRET_ACCESS_KEY", raising=False)
    monkeypatch.delenv("SECRET_ACCESS_KEY", raising=False)

    report = bucket_doctor()

    assert report["configured"] is False
    assert "bucket_name" in report["missing"]


def test_bucket_config_uses_prefixed_env(monkeypatch) -> None:
    monkeypatch.setenv("TAJWEED_BUCKET_NAME", "tajweed-bucket")
    monkeypatch.setenv("TAJWEED_BUCKET_REGION", "us-east-1")
    monkeypatch.setenv("TAJWEED_BUCKET_ENDPOINT", "https://example.test")
    monkeypatch.setenv("TAJWEED_BUCKET_ACCESS_KEY_ID", "key")
    monkeypatch.setenv("TAJWEED_BUCKET_SECRET_ACCESS_KEY", "secret")
    monkeypatch.setenv("TAJWEED_BUCKET_PREFIX", "trainer")

    config = load_bucket_config()

    assert config.bucket_name == "tajweed-bucket"
    assert config.region == "us-east-1"
    assert config.prefix == "trainer"
    assert config.configured is True


def test_upload_directory_uses_bucket_client(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("TAJWEED_BUCKET_NAME", "tajweed-bucket")
    monkeypatch.setenv("TAJWEED_BUCKET_REGION", "us-east-1")
    monkeypatch.setenv("TAJWEED_BUCKET_ENDPOINT", "https://example.test")
    monkeypatch.setenv("TAJWEED_BUCKET_ACCESS_KEY_ID", "key")
    monkeypatch.setenv("TAJWEED_BUCKET_SECRET_ACCESS_KEY", "secret")
    monkeypatch.setenv("TAJWEED_BUCKET_PREFIX", "trainer")

    uploads: list[tuple[str, str, str]] = []

    class StubClient:
        def upload_file(self, filename: str, bucket: str, key: str) -> None:
            uploads.append((filename, bucket, key))

    class StubBoto3:
        def client(self, *_args, **_kwargs):
            return StubClient()

    monkeypatch.setattr("tajweed_ml.storage_bucket.require_dependency", lambda *_args, **_kwargs: StubBoto3())

    root = tmp_path / "artifacts"
    nested = root / "models"
    nested.mkdir(parents=True)
    file_path = nested / "checkpoint.pt"
    file_path.write_text("ok", encoding="utf-8")

    result = upload_directory_to_bucket(root, prefix="artifacts")

    assert result["uploaded_files"] == 1
    assert uploads == [(str(file_path.resolve()), "tajweed-bucket", "trainer/artifacts/models/checkpoint.pt")]
