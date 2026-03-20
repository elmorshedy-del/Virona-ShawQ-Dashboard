from pathlib import Path

from tajweed_ml.config import load_config


def test_load_config_uses_storage_root_env(monkeypatch, tmp_path) -> None:
    storage_root = tmp_path / "persistent"
    monkeypatch.setenv("TAJWEED_ML_STORAGE_ROOT", str(storage_root))
    monkeypatch.delenv("TAJWEED_ML_ARTIFACT_ROOT", raising=False)

    config = load_config()

    assert config.storage_root == storage_root.resolve()
    assert config.data_dir == (storage_root / "data").resolve()
    assert config.audio_dir == (storage_root / "audio").resolve()
    assert config.artifact_root == (storage_root / "artifacts").resolve()


def test_load_config_allows_artifact_override(monkeypatch, tmp_path) -> None:
    storage_root = tmp_path / "persistent"
    artifact_root = tmp_path / "alt-artifacts"
    monkeypatch.setenv("TAJWEED_ML_STORAGE_ROOT", str(storage_root))
    monkeypatch.setenv("TAJWEED_ML_ARTIFACT_ROOT", str(artifact_root))

    config = load_config()

    assert config.storage_root == storage_root.resolve()
    assert config.artifact_root == artifact_root.resolve()
    assert config.models_dir == storage_root.resolve() / "ml" / "models"
