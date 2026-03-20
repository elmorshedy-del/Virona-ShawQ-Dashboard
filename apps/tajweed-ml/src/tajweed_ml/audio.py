from __future__ import annotations

from pathlib import Path

from .config import DEFAULT_MAX_CLIP_SAMPLES, DEFAULT_SAMPLE_RATE
from .optional import require_dependency


def load_audio(
    audio_path: str | Path,
    target_sample_rate: int = DEFAULT_SAMPLE_RATE,
    mono: bool = True,
):
    torch = require_dependency("torch")
    soundfile = require_dependency("soundfile")
    torchaudio = require_dependency("torchaudio")
    try:
        samples, sample_rate = soundfile.read(str(audio_path), dtype="float32", always_2d=True)
        waveform = torch.from_numpy(samples.T)
    except Exception:
        waveform, sample_rate = torchaudio.load(str(audio_path))
    if sample_rate != target_sample_rate:
        waveform = torchaudio.transforms.Resample(sample_rate, target_sample_rate)(waveform)
        sample_rate = target_sample_rate
    if mono and waveform.shape[0] > 1:
        waveform = waveform.mean(dim=0, keepdim=True)
    return waveform, sample_rate


def slice_audio(waveform, sample_rate: int, start_sec: float | None, end_sec: float | None):
    if start_sec is None or end_sec is None:
        return waveform
    start_sample = max(0, int(start_sec * sample_rate))
    end_sample = max(start_sample, int(end_sec * sample_rate))
    return waveform[:, start_sample:end_sample]


def pad_or_truncate(waveform, target_num_samples: int = DEFAULT_MAX_CLIP_SAMPLES):
    torch = require_dependency("torch")
    if waveform.shape[-1] > target_num_samples:
        return waveform[..., :target_num_samples]
    if waveform.shape[-1] < target_num_samples:
        padding = target_num_samples - waveform.shape[-1]
        return torch.nn.functional.pad(waveform, (0, padding))
    return waveform


def save_audio(audio_path: str | Path, waveform, sample_rate: int) -> Path:
    soundfile = require_dependency("soundfile")
    resolved_path = Path(audio_path)
    resolved_path.parent.mkdir(parents=True, exist_ok=True)
    soundfile.write(str(resolved_path), waveform.detach().squeeze(0).cpu().numpy(), sample_rate)
    return resolved_path.resolve()
