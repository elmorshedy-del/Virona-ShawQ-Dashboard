from __future__ import annotations

from pathlib import Path

from .optional import require_dependency

MODEL_WEIGHT_FILENAMES = {
    "model.safetensors",
    "model.safetensors.index.json",
    "pytorch_model.bin",
    "pytorch_model.bin.index.json",
}


def _snapshot_root(model_name: str) -> Path:
    cache_root = Path.home() / ".cache" / "huggingface" / "hub"
    return cache_root / f"models--{model_name.replace('/', '--')}" / "snapshots"


def has_local_snapshot(model_name: str) -> bool:
    repo_dir = _snapshot_root(model_name)
    return repo_dir.exists() and any(snapshot.is_dir() for snapshot in repo_dir.iterdir())


def has_local_model_weights(model_name: str) -> bool:
    repo_dir = _snapshot_root(model_name)
    if not repo_dir.exists():
        return False
    for snapshot in repo_dir.iterdir():
        if not snapshot.is_dir():
            continue
        if any((snapshot / filename).exists() for filename in MODEL_WEIGHT_FILENAMES):
            return True
    return False


def load_audio_processor(model_name: str):
    transformers = require_dependency("transformers")
    local_files_only = has_local_snapshot(model_name)
    try:
        return transformers.AutoProcessor.from_pretrained(
            model_name,
            local_files_only=local_files_only,
        )
    except Exception:
        return transformers.AutoFeatureExtractor.from_pretrained(
            model_name,
            local_files_only=local_files_only,
        )


def load_audio_model(model_name: str):
    transformers = require_dependency("transformers")
    return transformers.AutoModel.from_pretrained(
        model_name,
        local_files_only=has_local_model_weights(model_name),
    )
