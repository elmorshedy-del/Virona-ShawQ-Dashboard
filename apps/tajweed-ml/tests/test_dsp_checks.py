from __future__ import annotations

import numpy as np

from tajweed_ml.checker import check_ghunnah, check_madd


def make_sine(freq: float, duration: float, sr: int = 16_000) -> np.ndarray:
    t = np.arange(int(sr * duration)) / sr
    return (0.5 * np.sin(2 * np.pi * freq * t)).astype(np.float32)


def make_nasal_tone(duration: float, sr: int = 16_000) -> np.ndarray:
    t = np.arange(int(sr * duration)) / sr
    signal = (
        0.6 * np.sin(2 * np.pi * 250 * t)
        + 0.2 * np.sin(2 * np.pi * 500 * t)
        + 0.1 * np.sin(2 * np.pi * 1000 * t)
    )
    return signal.astype(np.float32)


def make_non_nasal_tone(duration: float, sr: int = 16_000) -> np.ndarray:
    t = np.arange(int(sr * duration)) / sr
    signal = 0.6 * np.sin(2 * np.pi * 800 * t) + 0.2 * np.sin(2 * np.pi * 1200 * t)
    return signal.astype(np.float32)


class TestMadd:
    def test_correct_madd_same_duration(self):
        ref = make_sine(440, 0.3)
        student = make_sine(440, 0.3)
        result = check_madd(student, ref, sr=16_000)
        assert result["result"] == "correct"

    def test_short_madd_detected(self):
        ref = make_sine(440, 0.5)
        student = make_sine(440, 0.1)
        result = check_madd(student, ref, sr=16_000)
        assert result["result"] == "error"
        assert "too short" in str(result["detail"]).lower()

    def test_borderline_madd(self):
        ref = make_sine(440, 0.4)
        student = make_sine(440, 0.22)
        result = check_madd(student, ref, sr=16_000)
        assert result["result"] in ("uncertain", "error")


class TestGhunnah:
    def test_ghunnah_present(self):
        ref = make_nasal_tone(0.3)
        student = make_nasal_tone(0.3)
        result = check_ghunnah(student, ref, sr=16_000)
        assert result["result"] == "correct"

    def test_ghunnah_missing(self):
        ref = make_nasal_tone(0.3)
        student = make_non_nasal_tone(0.3)
        result = check_ghunnah(student, ref, sr=16_000)
        assert result["result"] == "error"
        assert "missing" in str(result["detail"]).lower()

    def test_ghunnah_too_short(self):
        ref = make_nasal_tone(0.3)
        student = make_nasal_tone(0.05)
        result = check_ghunnah(student, ref, sr=16_000)
        assert result["result"] in ("error", "uncertain")
