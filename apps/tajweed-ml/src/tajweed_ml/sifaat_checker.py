from __future__ import annotations

import numpy as np

from .sifaat_map import get_checks_for_letter


def _rfft_dependencies():
    from scipy.fft import rfft, rfftfreq

    return rfft, rfftfreq


def _as_float_array(audio: np.ndarray) -> np.ndarray:
    return np.asarray(audio, dtype=np.float32).reshape(-1)


def _measure_vowel_duration(audio: np.ndarray, sr: int) -> float:
    audio_array = _as_float_array(audio)
    frame_len = int(0.010 * sr)
    hop = int(0.005 * sr)
    if audio_array.size < frame_len:
        return (audio_array.size / sr) * 1000
    energy = np.array(
        [
            np.sum(audio_array[index:index + frame_len] ** 2)
            for index in range(0, audio_array.size - frame_len, hop)
        ]
    )
    if energy.size == 0:
        return 0.0
    energy = energy / (float(np.max(energy)) + 1e-10)
    voiced_frames = int(np.sum(energy > 0.25))
    return voiced_frames * (hop / sr) * 1000


def _measure_nasal_ratio(audio: np.ndarray, sr: int) -> float:
    audio_array = _as_float_array(audio)
    if audio_array.size < 256:
        return 0.0
    rfft, rfftfreq = _rfft_dependencies()
    fft_vals = rfft(audio_array)
    fft_magnitude = np.abs(fft_vals)
    freqs = rfftfreq(audio_array.size, d=1.0 / sr)
    total_energy = float(np.sum(fft_magnitude**2) + 1e-10)
    nasal_mask = (freqs >= 200) & (freqs <= 350)
    nasal_energy = float(np.sum(fft_magnitude[nasal_mask] ** 2))
    return nasal_energy / total_energy


def _measure_nasal_duration(audio: np.ndarray, sr: int) -> float:
    audio_array = _as_float_array(audio)
    frame_len = int(0.020 * sr)
    hop = int(0.010 * sr)
    if audio_array.size < frame_len:
        return 0.0
    rfft, rfftfreq = _rfft_dependencies()
    nasal_frames = 0
    for index in range(0, audio_array.size - frame_len, hop):
        frame = audio_array[index:index + frame_len]
        fft_vals = rfft(frame)
        fft_mag = np.abs(fft_vals)
        freqs = rfftfreq(frame.size, d=1.0 / sr)
        total_energy = float(np.sum(fft_mag**2) + 1e-10)
        nasal_mask = (freqs >= 200) & (freqs <= 350)
        nasal_energy = float(np.sum(fft_mag[nasal_mask] ** 2))
        if nasal_energy / total_energy > 0.10:
            nasal_frames += 1
    return nasal_frames * (hop / sr) * 1000


def check_madd(
    student_audio: np.ndarray,
    reference_audio: np.ndarray,
    sr: int = 16_000,
    min_ratio: float = 0.60,
    natural_min_ms: int = 150,
) -> dict[str, float | str]:
    student_duration = _measure_vowel_duration(student_audio, sr)
    reference_duration = _measure_vowel_duration(reference_audio, sr)
    if reference_duration < 10:
        return {
            "result": "uncertain",
            "confidence": 0.0,
            "student_duration_ms": round(student_duration, 1),
            "reference_duration_ms": round(reference_duration, 1),
            "ratio": 0.0,
            "detail": "Reference audio too short for madd comparison",
        }

    ratio = student_duration / reference_duration
    if ratio >= min_ratio and student_duration >= natural_min_ms:
        return {
            "result": "correct",
            "confidence": min(1.0, ratio),
            "student_duration_ms": round(student_duration, 1),
            "reference_duration_ms": round(reference_duration, 1),
            "ratio": round(ratio, 2),
            "detail": f"Madd duration OK: {student_duration:.0f}ms (ref: {reference_duration:.0f}ms)",
        }
    if ratio >= min_ratio * 0.8:
        return {
            "result": "uncertain",
            "confidence": 0.5,
            "student_duration_ms": round(student_duration, 1),
            "reference_duration_ms": round(reference_duration, 1),
            "ratio": round(ratio, 2),
            "detail": f"Madd borderline: {student_duration:.0f}ms (ref: {reference_duration:.0f}ms)",
        }
    return {
        "result": "error",
        "confidence": min(1.0, max(0.0, (1.0 - ratio) * 2)),
        "student_duration_ms": round(student_duration, 1),
        "reference_duration_ms": round(reference_duration, 1),
        "ratio": round(ratio, 2),
        "detail": (
            f"Madd too short: {student_duration:.0f}ms vs expected {reference_duration:.0f}ms"
            " - elongate the vowel"
        ),
    }


def check_ghunnah(
    student_audio: np.ndarray,
    reference_audio: np.ndarray,
    sr: int = 16_000,
    nasal_energy_min: float = 0.12,
    duration_min_ms: int = 150,
) -> dict[str, float | str]:
    student_ratio = _measure_nasal_ratio(student_audio, sr)
    reference_ratio = _measure_nasal_ratio(reference_audio, sr)
    student_duration = _measure_nasal_duration(student_audio, sr)

    has_nasalization = student_ratio >= nasal_energy_min
    long_enough = student_duration >= duration_min_ms
    if has_nasalization and long_enough:
        return {
            "result": "correct",
            "confidence": min(1.0, student_ratio / nasal_energy_min),
            "student_nasal_ratio": round(student_ratio, 4),
            "reference_nasal_ratio": round(reference_ratio, 4),
            "detail": f"Ghunnah present: nasal energy {student_ratio:.3f}, duration {student_duration:.0f}ms",
        }
    if has_nasalization and not long_enough:
        return {
            "result": "error",
            "confidence": 0.7,
            "student_nasal_ratio": round(student_ratio, 4),
            "reference_nasal_ratio": round(reference_ratio, 4),
            "detail": f"Ghunnah too short: {student_duration:.0f}ms - hold the nasal sound for 2 counts",
        }
    if student_ratio >= nasal_energy_min * 0.5:
        return {
            "result": "uncertain",
            "confidence": 0.4,
            "student_nasal_ratio": round(student_ratio, 4),
            "reference_nasal_ratio": round(reference_ratio, 4),
            "detail": f"Weak nasalization detected: {student_ratio:.3f}",
        }
    return {
        "result": "error",
        "confidence": 0.85,
        "student_nasal_ratio": round(student_ratio, 4),
        "reference_nasal_ratio": round(reference_ratio, 4),
        "detail": (
            f"Ghunnah missing: nasal energy {student_ratio:.3f} below threshold"
            " - nasalize through the nose"
        ),
    }


def check_letter_sifaat(
    student_audio: np.ndarray,
    reference_audio: np.ndarray,
    letter: str,
    sr: int = 16_000,
) -> list[dict]:
    checks = get_checks_for_letter(letter)
    errors: list[dict] = []
    for check in checks:
        if check["method"] == "ml":
            continue
        result = run_dsp_check(student_audio, reference_audio, sr, str(check["measure"]))
        if result["status"] == "error":
            errors.append(
                {
                    "sifah": check["sifah"],
                    "letter": letter,
                    "measure": check["measure"],
                    "expected": check["check"],
                    "detail": result["detail"],
                    "confidence": result["confidence"],
                }
            )
    return errors


def run_dsp_check(student: np.ndarray, reference: np.ndarray, sr: int, measure: str) -> dict:
    if measure == "breath_energy_ratio":
        return check_breath_energy(student, reference, sr)
    if measure == "voicing_energy":
        return check_voicing(student, reference, sr)
    if measure == "energy_stop":
        return check_energy_stop(student, reference, sr)
    if measure in {"energy_continuity", "partial_energy_flow"}:
        return check_energy_continuity(student, reference, sr)
    if measure in {"f2_depression", "f2_f3_pattern"}:
        return check_f2_depression(student, reference, sr)
    if measure in {"f2_elevation", "normal_formants"}:
        return check_f2_elevation(student, reference, sr)
    if measure == "post_release_burst":
        return check_qalqalah_burst(student, sr)
    if measure == "sibilant_energy":
        return check_sibilant_energy(student, reference, sr)
    if measure == "amplitude_modulation":
        return check_takreer(student, sr)
    if measure == "wideband_noise":
        return check_tafashshi(student, reference, sr)
    if measure == "smooth_transition":
        return check_energy_continuity(student, reference, sr)
    return {"status": "skip", "detail": f"No DSP check for {measure}", "confidence": 0.0}


def check_breath_energy(student, reference, sr):
    rfft, rfftfreq = _rfft_dependencies()
    if len(student) < 256:
        return {"status": "skip", "detail": "Audio too short", "confidence": 0.0}
    fft_mag = np.abs(rfft(student))
    freqs = rfftfreq(len(student), 1.0 / sr)
    total = float(np.sum(fft_mag**2) + 1e-10)
    ratio = float(np.sum(fft_mag[freqs > 2000] ** 2) / total)

    reference = reference[: len(student)]
    if len(reference) < 256:
        ref_ratio = ratio
    else:
        ref_fft = np.abs(rfft(reference))
        ref_freqs = rfftfreq(len(reference), 1.0 / sr)
        ref_total = float(np.sum(ref_fft**2) + 1e-10)
        ref_ratio = float(np.sum(ref_fft[ref_freqs > 2000] ** 2) / ref_total)

    if abs(ratio - ref_ratio) < 0.15:
        return {"status": "correct", "detail": "Breath energy matches reference", "confidence": 0.8}
    return {
        "status": "error",
        "detail": f"Breath energy ratio {ratio:.3f} vs reference {ref_ratio:.3f}",
        "confidence": 0.6,
    }


def check_voicing(student, reference, sr):
    del reference
    rfft, rfftfreq = _rfft_dependencies()
    if len(student) < 256:
        return {"status": "skip", "detail": "Audio too short", "confidence": 0.0}
    fft_mag = np.abs(rfft(student))
    freqs = rfftfreq(len(student), 1.0 / sr)
    total = float(np.sum(fft_mag**2) + 1e-10)
    ratio = float(np.sum(fft_mag[freqs < 300] ** 2) / total)
    if ratio > 0.2:
        return {"status": "correct", "detail": "Voicing energy present", "confidence": 0.7}
    return {"status": "error", "detail": f"Weak voicing: {ratio:.3f}", "confidence": 0.6}


def check_energy_stop(student, reference, sr):
    del reference
    frame_len = int(0.010 * sr)
    hop = int(0.005 * sr)
    if len(student) < frame_len * 3:
        return {"status": "skip", "detail": "Audio too short", "confidence": 0.0}
    energy = np.array(
        [np.sum(student[index:index + frame_len] ** 2) for index in range(0, len(student) - frame_len, hop)]
    )
    if len(energy) < 3:
        return {"status": "skip", "detail": "Not enough frames", "confidence": 0.0}
    energy_norm = energy / (float(np.max(energy)) + 1e-10)
    min_energy = float(np.min(energy_norm))
    if min_energy < 0.05:
        return {"status": "correct", "detail": "Energy stop detected (shiddah)", "confidence": 0.8}
    return {"status": "error", "detail": f"No energy stop: min={min_energy:.3f}", "confidence": 0.5}


def check_energy_continuity(student, reference, sr):
    del reference
    frame_len = int(0.010 * sr)
    hop = int(0.005 * sr)
    if len(student) < frame_len * 3:
        return {"status": "skip", "detail": "Audio too short", "confidence": 0.0}
    energy = np.array(
        [np.sum(student[index:index + frame_len] ** 2) for index in range(0, len(student) - frame_len, hop)]
    )
    energy_norm = energy / (float(np.max(energy)) + 1e-10)
    variance = float(np.var(energy_norm))
    if variance < 0.15:
        return {"status": "correct", "detail": "Sound flows smoothly (rakhawah)", "confidence": 0.7}
    return {"status": "uncertain", "detail": f"Energy variance: {variance:.3f}", "confidence": 0.4}


def _spectral_centroid(signal: np.ndarray, sr: int) -> float:
    rfft, rfftfreq = _rfft_dependencies()
    fft_mag = np.abs(rfft(signal))
    freqs = rfftfreq(len(signal), 1.0 / sr)
    return float(np.sum(freqs * fft_mag) / (np.sum(fft_mag) + 1e-10))


def check_f2_depression(student, reference, sr):
    del reference
    if len(student) < 512:
        return {"status": "skip", "detail": "Audio too short for formant analysis", "confidence": 0.0}
    centroid = _spectral_centroid(student, sr)
    if centroid < 1500:
        return {"status": "correct", "detail": f"Heavy articulation - centroid {centroid:.0f}Hz", "confidence": 0.6}
    return {
        "status": "error",
        "detail": f"Sounds light - centroid {centroid:.0f}Hz, expected heavy",
        "confidence": 0.5,
    }


def check_f2_elevation(student, reference, sr):
    del reference
    if len(student) < 512:
        return {"status": "skip", "detail": "Audio too short", "confidence": 0.0}
    centroid = _spectral_centroid(student, sr)
    if centroid > 1200:
        return {"status": "correct", "detail": f"Light articulation - centroid {centroid:.0f}Hz", "confidence": 0.6}
    return {
        "status": "error",
        "detail": f"Sounds heavy - centroid {centroid:.0f}Hz, expected light",
        "confidence": 0.5,
    }


def check_qalqalah_burst(student, sr):
    if len(student) < int(0.05 * sr):
        return {"status": "skip", "detail": "Audio too short", "confidence": 0.0}
    frame_len = int(0.005 * sr)
    hop = int(0.002 * sr)
    energy = np.array(
        [np.sum(student[index:index + frame_len] ** 2) for index in range(0, len(student) - frame_len, hop)]
    )
    if len(energy) < 5:
        return {"status": "skip", "detail": "Not enough frames", "confidence": 0.0}
    min_index = int(np.argmin(energy))
    post_min = energy[min_index:min(min_index + 10, len(energy))]
    if len(post_min) > 2 and float(np.max(post_min)) > float(np.mean(energy)) * 0.3:
        return {"status": "correct", "detail": "Qalqalah bounce detected", "confidence": 0.7}
    return {"status": "error", "detail": "No qalqalah bounce after stop", "confidence": 0.6}


def check_sibilant_energy(student, reference, sr):
    del reference
    rfft, rfftfreq = _rfft_dependencies()
    if len(student) < 256:
        return {"status": "skip", "detail": "Audio too short", "confidence": 0.0}
    fft_mag = np.abs(rfft(student))
    freqs = rfftfreq(len(student), 1.0 / sr)
    total = float(np.sum(fft_mag**2) + 1e-10)
    ratio = float(np.sum(fft_mag[(freqs > 4000) & (freqs < 8000)] ** 2) / total)
    if ratio > 0.1:
        return {"status": "correct", "detail": f"Sibilant energy present: {ratio:.3f}", "confidence": 0.7}
    return {"status": "error", "detail": f"Weak sibilant: {ratio:.3f}", "confidence": 0.5}


def check_takreer(student, sr):
    frame_len = int(0.005 * sr)
    hop = int(0.002 * sr)
    if len(student) < frame_len * 5:
        return {"status": "skip", "detail": "Audio too short", "confidence": 0.0}
    energy = np.array(
        [np.sum(student[index:index + frame_len] ** 2) for index in range(0, len(student) - frame_len, hop)]
    )
    energy_norm = energy / (float(np.max(energy)) + 1e-10)
    crossings = int(np.sum(np.abs(np.diff(energy_norm > 0.3))))
    if crossings <= 4:
        return {"status": "correct", "detail": "Single tap raa (correct)", "confidence": 0.6}
    return {
        "status": "error",
        "detail": f"Multiple taps detected ({crossings}) - reduce trill",
        "confidence": 0.5,
    }


def check_tafashshi(student, reference, sr):
    del reference
    rfft, rfftfreq = _rfft_dependencies()
    if len(student) < 256:
        return {"status": "skip", "detail": "Audio too short", "confidence": 0.0}
    fft_mag = np.abs(rfft(student))
    freqs = rfftfreq(len(student), 1.0 / sr)
    hf_mag = fft_mag[freqs > 2000]
    if len(hf_mag) == 0:
        return {"status": "skip", "detail": "No HF content", "confidence": 0.0}
    geometric_mean = float(np.exp(np.mean(np.log(hf_mag + 1e-10))))
    arithmetic_mean = float(np.mean(hf_mag) + 1e-10)
    flatness = geometric_mean / arithmetic_mean
    if flatness > 0.3:
        return {
            "status": "correct",
            "detail": f"Wideband noise (tafashshi): flatness={flatness:.2f}",
            "confidence": 0.6,
        }
    return {
        "status": "uncertain",
        "detail": f"Spectral peak detected: flatness={flatness:.2f}",
        "confidence": 0.4,
    }
