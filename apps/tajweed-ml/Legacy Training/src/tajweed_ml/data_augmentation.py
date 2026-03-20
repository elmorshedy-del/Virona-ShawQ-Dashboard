from __future__ import annotations

from .optional import require_dependency


SHORT_MADD_RATIO = 0.40
NASAL_BAND_MIN_HZ = 200
NASAL_BAND_MAX_HZ = 350
NASAL_BAND_ATTENUATION = 0.10
HEAVY_SHIFT_STEPS = -1.5
LIGHT_SHIFT_STEPS = 1.5
QALQALAH_BURST_SEC = 0.025
QALQALAH_ATTENUATION = 0.05


def simulate_short_madd(audio, sr: int = 16_000, vowel_start: float = 0.0, vowel_end: float = 0.0):
    torch = require_dependency("torch")
    start_sample = int(vowel_start * sr)
    end_sample = int(vowel_end * sr)
    retained_vowel_end = start_sample + int((end_sample - start_sample) * SHORT_MADD_RATIO)
    return torch.cat([audio[:, :retained_vowel_end], audio[:, end_sample:]], dim=1)


def simulate_missing_nasalization(
    audio,
    sr: int = 16_000,
    nasal_start: float = 0.0,
    nasal_end: float = 0.0,
):
    torch = require_dependency("torch")
    start_sample = int(nasal_start * sr)
    end_sample = int(nasal_end * sr)
    result = audio.clone()
    segment = result[:, start_sample:end_sample]
    fft = torch.fft.rfft(segment)
    freqs = torch.fft.rfftfreq(segment.shape[1], d=1.0 / sr)
    nasal_mask = (freqs >= NASAL_BAND_MIN_HZ) & (freqs <= NASAL_BAND_MAX_HZ)
    fft[:, nasal_mask] *= NASAL_BAND_ATTENUATION
    result[:, start_sample:end_sample] = torch.fft.irfft(fft, n=segment.shape[1])
    return result


def simulate_light_as_heavy(audio, sr: int = 16_000):
    torchaudio = require_dependency("torchaudio")
    return torchaudio.transforms.PitchShift(sr, n_steps=LIGHT_SHIFT_STEPS)(audio)


def simulate_heavy_as_light(audio, sr: int = 16_000):
    torchaudio = require_dependency("torchaudio")
    return torchaudio.transforms.PitchShift(sr, n_steps=HEAVY_SHIFT_STEPS)(audio)


def simulate_missing_qalqalah(audio, sr: int = 16_000, stop_time: float = 0.0):
    stop_sample = int(stop_time * sr)
    burst_end = min(audio.shape[1], stop_sample + int(QALQALAH_BURST_SEC * sr))
    result = audio.clone()
    result[:, stop_sample:burst_end] *= QALQALAH_ATTENUATION
    return result
