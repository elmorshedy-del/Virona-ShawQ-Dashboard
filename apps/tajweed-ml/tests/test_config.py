from tajweed_ml.config import ARTIFACT_ROOT_ENV, load_config


def test_load_config_uses_env_override(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv(ARTIFACT_ROOT_ENV, str(tmp_path / "tajweed-artifacts"))
    config = load_config()

    assert config.artifact_root == (tmp_path / "tajweed-artifacts").resolve()
    assert config.buraaq_dataset_dir.parent.parent == config.data_dir
    assert config.muaalem_model_dir.parent == config.models_dir
