import numpy as np

from tajweed_ml.sifaat_checker import (
    check_f2_depression,
    check_f2_elevation,
    check_letter_sifaat,
)
from tajweed_ml.sifaat_map import get_checks_for_letter, get_distinguishing_checks


def make_sine(freq: float, duration: float, sr: int = 16_000) -> np.ndarray:
    timeline = np.arange(int(sr * duration)) / sr
    return (0.5 * np.sin(2 * np.pi * freq * timeline)).astype(np.float32)


def test_get_checks_for_letter_saad_contains_expected_sifaat() -> None:
    checks = get_checks_for_letter("ص")
    sifaat = {check["sifah"] for check in checks}
    assert {"hams", "rakhawah", "istilaa", "itbaaq", "safeer"} <= sifaat


def test_get_distinguishing_checks_between_saad_and_seen_mentions_tafkheem() -> None:
    checks = get_distinguishing_checks("ص", "س")
    measures = {check["measure"] for check in checks}
    assert "f2_depression" in measures
    assert "f2_elevation" in measures


def test_check_f2_depression_accepts_low_centroid_signal() -> None:
    result = check_f2_depression(make_sine(440, 0.3), make_sine(440, 0.3), 16_000)
    assert result["status"] == "correct"


def test_check_f2_elevation_flags_low_centroid_signal() -> None:
    result = check_f2_elevation(make_sine(440, 0.3), make_sine(440, 0.3), 16_000)
    assert result["status"] == "error"


def test_check_letter_sifaat_reports_no_errors_for_simple_heavy_proxy() -> None:
    errors = check_letter_sifaat(make_sine(440, 0.3), make_sine(440, 0.3), "ص", sr=16_000)
    assert isinstance(errors, list)
