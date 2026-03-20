from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from .audio import load_audio, slice_audio
from .config import DEFAULT_SAMPLE_RATE, load_config
from .hf_utils import load_audio_model, load_audio_processor
from .optional import require_dependency


def _preferred_model_name(model_name: str | None = None, *, prefer_arabic: bool = True) -> str:
    config = load_config()
    if model_name:
        return model_name
    return config.default_arabic_model_name if prefer_arabic else config.default_model_name


@lru_cache(maxsize=4)
def _load_bundle(model_name: str):
    processor = load_audio_processor(model_name)
    model = load_audio_model(model_name)
    model.eval()
    return processor, model


def download_base_model(model_name: str | None = None, *, prefer_arabic: bool = True) -> str:
    resolved_model_name = _preferred_model_name(model_name, prefer_arabic=prefer_arabic)
    _load_bundle(resolved_model_name)
    return resolved_model_name


def extract_features(
    audio_path: str | Path,
    start_sec: float | None = None,
    end_sec: float | None = None,
    *,
    model_name: str | None = None,
    sample_rate: int = DEFAULT_SAMPLE_RATE,
):
    torch = require_dependency("torch")
    processor, model = _load_bundle(_preferred_model_name(model_name))
    waveform, loaded_sample_rate = load_audio(audio_path, target_sample_rate=sample_rate)
    waveform = slice_audio(waveform, loaded_sample_rate, start_sec, end_sec)
    inputs = processor(
        waveform.squeeze(0).cpu().numpy(),
        sampling_rate=sample_rate,
        return_tensors="pt",
    )
    with torch.no_grad():
        outputs = model(**inputs)
    return outputs.last_hidden_state.cpu()


def extract_embedding(
    audio_path: str | Path,
    start_sec: float | None = None,
    end_sec: float | None = None,
    *,
    model_name: str | None = None,
    sample_rate: int = DEFAULT_SAMPLE_RATE,
):
    features = extract_features(
        audio_path,
        start_sec=start_sec,
        end_sec=end_sec,
        model_name=model_name,
        sample_rate=sample_rate,
    )
    return features.mean(dim=1).squeeze().cpu()
