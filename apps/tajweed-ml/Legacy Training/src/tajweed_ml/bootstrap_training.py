from __future__ import annotations

import json
import sys
from pathlib import Path

from .audio import load_audio, save_audio
from .confusion_pairs import CONFUSION_PAIR_DEFINITIONS
from .config import DEFAULT_SAMPLE_RATE, load_config
from .optional import require_dependency

try:
    import parselmouth
    from parselmouth.praat import call
except ImportError:  # pragma: no cover - depends on local environment
    parselmouth = None
    call = None


HEAVY_LETTERS = {"خ", "ص", "ض", "غ", "ط", "ق", "ظ"}
FORMANT_SHIFT_BY_PAIR = {
    "ayn_vs_hamza": 200,
    "haa_vs_ha": 200,
    "qaaf_vs_kaaf": 250,
    "saad_vs_seen": 350,
}
MAX_TAFKHEEM_HEAVY_WORDS = 180
MAX_TAFKHEEM_LIGHT_WORDS = 180
MAX_PAIR_SOURCE_CLIPS_PER_LABEL = 120


def _load_audio_array(audio_path: str | Path, sample_rate: int = DEFAULT_SAMPLE_RATE):
    waveform, _ = load_audio(audio_path, target_sample_rate=sample_rate)
    return waveform.squeeze(0).cpu().numpy()


def _save_audio_array(audio, output_path: str | Path, sample_rate: int = DEFAULT_SAMPLE_RATE) -> str:
    torch = require_dependency("torch")
    tensor = torch.tensor(audio, dtype=torch.float32).unsqueeze(0)
    return str(save_audio(output_path, tensor, sample_rate=sample_rate))


def augment_pitch_shift(audio_path: str | Path, semitones: float = 1.5):
    torchaudio = require_dependency("torchaudio")
    waveform, sample_rate = load_audio(audio_path, target_sample_rate=DEFAULT_SAMPLE_RATE)
    shifted = torchaudio.functional.pitch_shift(waveform, sample_rate, n_steps=semitones)
    return shifted.squeeze(0).cpu().numpy()


def augment_formant_shift(audio_path: str | Path, f2_shift_hz: int = 300):
    if parselmouth is None or call is None:
        return augment_pitch_shift(audio_path, semitones=1.5)
    try:
        sound = parselmouth.Sound(str(audio_path))
        manipulation = call(sound, "To Manipulation", 0.01, 75, 600)
        duration = sound.get_total_duration()
        formant_grid = call(manipulation, "Extract formant grid")
        call(formant_grid, "Add formant point", 2, 0.0, f2_shift_hz)
        call(formant_grid, "Add formant point", 2, duration, f2_shift_hz)
        call([manipulation, formant_grid], "Replace formant grid")
        new_sound = call(manipulation, "Get resynthesis (overlap-add)")
        return new_sound.values.flatten().astype("float32")
    except Exception:
        return augment_pitch_shift(audio_path, semitones=1.5)


def augment_speed(audio_path: str | Path, factor: float = 1.1):
    librosa = require_dependency("librosa")
    audio = _load_audio_array(audio_path)
    return librosa.effects.time_stretch(audio, rate=factor).astype("float32")


def augment_noise(audio_path: str | Path, snr_db: float = 20.0):
    numpy = require_dependency("numpy")
    audio = _load_audio_array(audio_path)
    if audio.size == 0:
        return audio.astype("float32")
    signal_power = float(numpy.mean(audio**2) + 1e-10)
    noise_power = signal_power / (10 ** (snr_db / 10))
    noise = numpy.random.normal(0.0, noise_power**0.5, size=audio.shape)
    return (audio + noise).astype("float32")


def augment_volume(audio_path: str | Path, gain_db: float = 3.0):
    numpy = require_dependency("numpy")
    audio = _load_audio_array(audio_path)
    gain = 10 ** (gain_db / 20)
    return (audio * gain).astype("float32")


def _iter_word_clips(husary_words_dir: str | Path):
    husary_root = Path(husary_words_dir)
    if not husary_root.exists():
        return
    for surah_dir in sorted(husary_root.iterdir()):
        if not surah_dir.is_dir():
            continue
        manifest_path = surah_dir / "manifest.json"
        if not manifest_path.exists():
            continue
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        for ayah_key, clips in manifest.items():
            for clip in clips:
                audio_path = Path(clip.get("path", ""))
                if audio_path.exists():
                    yield ayah_key, clip


def _write_sample(audio, output_path: Path, *, label: int, letter: str, source: str, augmentation: str, word: str) -> dict:
    return {
        "audio_path": _save_audio_array(audio, output_path),
        "label": label,
        "letter": letter,
        "word": word,
        "source": source,
        "augmentation": augmentation,
    }


def _confusion_variant(audio_path: str | Path, *, pair_name: str, source_label: int):
    source_letter, target_letter = CONFUSION_PAIR_DEFINITIONS[pair_name]
    if pair_name in {"ayn_vs_hamza", "haa_vs_ha"}:
        if source_label == 0:
            return augment_formant_shift(audio_path, f2_shift_hz=FORMANT_SHIFT_BY_PAIR[pair_name])
        return augment_pitch_shift(audio_path, semitones=-1.0)
    if pair_name == "qaaf_vs_kaaf":
        if source_label == 0:
            return augment_formant_shift(audio_path, f2_shift_hz=FORMANT_SHIFT_BY_PAIR[pair_name])
        return augment_pitch_shift(audio_path, semitones=-1.5)
    if source_label == 0:
        return augment_formant_shift(audio_path, f2_shift_hz=FORMANT_SHIFT_BY_PAIR[pair_name])
    return augment_pitch_shift(audio_path, semitones=-2.0)


def build_tafkheem_training_data(
    husary_words_dir: str | Path | None = None,
    output_dir: str | Path | None = None,
    output_json: str | Path | None = None,
) -> list[dict]:
    config = load_config()
    resolved_husary_words_dir = (
        Path(husary_words_dir).expanduser().resolve()
        if husary_words_dir is not None
        else config.husary_manifest_dir
    )
    output_root = (
        Path(output_dir).expanduser().resolve()
        if output_dir is not None
        else config.data_dir / "tafkheem_augmented"
    )
    output_root.mkdir(parents=True, exist_ok=True)
    samples: list[dict] = []
    sample_id = 0
    heavy_source_count = 0
    light_source_count = 0

    for _ayah_key, clip in _iter_word_clips(resolved_husary_words_dir):
        word = clip.get("word", "")
        audio_path = clip["path"]
        word_has_tafkheem = any(letter in HEAVY_LETTERS for letter in word)

        if not word_has_tafkheem:
            if light_source_count >= MAX_TAFKHEEM_LIGHT_WORDS:
                continue
            out_path = output_root / f"light_orig_{sample_id}.wav"
            samples.append(
                _write_sample(
                    augment_noise(audio_path, snr_db=30),
                    out_path,
                    label=0,
                    letter=word,
                    source="husary_light",
                    augmentation="noise_30",
                    word=word,
                )
            )
            sample_id += 1
            light_source_count += 1
            continue

        if heavy_source_count >= MAX_TAFKHEEM_HEAVY_WORDS:
            continue

        positive_variants = [
            ("original", augment_volume(audio_path, gain_db=0.0)),
            ("speed_0.9", augment_speed(audio_path, factor=0.9)),
            ("speed_1.1", augment_speed(audio_path, factor=1.1)),
            ("noise_15", augment_noise(audio_path, snr_db=15)),
        ]
        for augmentation, audio in positive_variants:
            out_path = output_root / f"heavy_{augmentation}_{sample_id}.wav"
            samples.append(
                _write_sample(
                    audio,
                    out_path,
                    label=1,
                    letter=word,
                    source="husary",
                    augmentation=augmentation,
                    word=word,
                )
            )
            sample_id += 1

        negative_variants = [
            ("formant_shift_300", augment_formant_shift(audio_path, f2_shift_hz=300)),
            ("pitch_shift_1.5", augment_pitch_shift(audio_path, semitones=1.5)),
        ]
        combined_audio_path = output_root / f"_temp_formant_{sample_id}.wav"
        _save_audio_array(augment_formant_shift(audio_path, f2_shift_hz=250), combined_audio_path)
        negative_variants.append(("formant_noise", augment_noise(combined_audio_path, snr_db=20)))
        if combined_audio_path.exists():
            combined_audio_path.unlink()

        for augmentation, audio in negative_variants:
            out_path = output_root / f"light_{augmentation}_{sample_id}.wav"
            samples.append(
                _write_sample(
                    audio,
                    out_path,
                    label=0,
                    letter=word,
                    source="husary_augmented",
                    augmentation=augmentation,
                    word=word,
                )
            )
            sample_id += 1
        heavy_source_count += 1

    resolved_output = (
        Path(output_json).expanduser().resolve()
        if output_json is not None
        else config.data_dir / "tafkheem_training.json"
    )
    resolved_output.parent.mkdir(parents=True, exist_ok=True)
    resolved_output.write_text(json.dumps(samples, ensure_ascii=False, indent=2), encoding="utf-8")
    return samples


def build_confusion_pair_training_data(
    husary_words_dir: str | Path | None = None,
    output_dir: str | Path | None = None,
    output_json_prefix: str | Path | None = None,
) -> dict[str, list[dict]]:
    config = load_config()
    resolved_husary_words_dir = (
        Path(husary_words_dir).expanduser().resolve()
        if husary_words_dir is not None
        else config.husary_manifest_dir
    )
    output_root = (
        Path(output_dir).expanduser().resolve()
        if output_dir is not None
        else config.data_dir / "confusion_pairs"
    )
    resolved_output_json_prefix = (
        Path(output_json_prefix).expanduser().resolve()
        if output_json_prefix is not None
        else config.data_dir / "confusion_pair"
    )
    output_root.mkdir(parents=True, exist_ok=True)
    results: dict[str, list[dict]] = {}

    for pair_name, letters in CONFUSION_PAIR_DEFINITIONS.items():
        left_letter, right_letter = letters
        pair_root = output_root / pair_name
        pair_root.mkdir(parents=True, exist_ok=True)
        sample_id = 0
        samples: list[dict] = []
        label_source_counts = {0: 0, 1: 0}

        for _ayah_key, clip in _iter_word_clips(resolved_husary_words_dir):
            word = clip.get("word", "")
            audio_path = clip["path"]
            if left_letter in word:
                base_label = 0
                base_letter = left_letter
            elif right_letter in word:
                base_label = 1
                base_letter = right_letter
            else:
                continue
            if label_source_counts[base_label] >= MAX_PAIR_SOURCE_CLIPS_PER_LABEL:
                continue

            correct_variants = [
                ("original", augment_volume(audio_path, gain_db=0.0)),
                ("speed_0.9", augment_speed(audio_path, factor=0.9)),
                ("speed_1.1", augment_speed(audio_path, factor=1.1)),
                ("noise_15", augment_noise(audio_path, snr_db=15)),
            ]
            for augmentation, audio in correct_variants:
                out_path = pair_root / f"label_{base_label}_{augmentation}_{sample_id}.wav"
                samples.append(
                    _write_sample(
                        audio,
                        out_path,
                        label=base_label,
                        letter=base_letter,
                        source="husary",
                        augmentation=augmentation,
                        word=word,
                    )
                )
                sample_id += 1

            confused_audio = _confusion_variant(audio_path, pair_name=pair_name, source_label=base_label)
            confused_label = 1 - base_label
            confused_letter = right_letter if confused_label == 1 else left_letter
            out_path = pair_root / f"label_{confused_label}_formant_{sample_id}.wav"
            samples.append(
                _write_sample(
                    confused_audio,
                    out_path,
                    label=confused_label,
                    letter=confused_letter,
                    source="husary_augmented",
                    augmentation="confusion_variant",
                    word=word,
                )
            )
            sample_id += 1

            temp_path = pair_root / f"_temp_{sample_id}.wav"
            _save_audio_array(confused_audio, temp_path)
            combined_audio = augment_noise(temp_path, snr_db=18)
            if temp_path.exists():
                temp_path.unlink()
            out_path = pair_root / f"label_{confused_label}_combined_{sample_id}.wav"
            samples.append(
                _write_sample(
                    combined_audio,
                    out_path,
                    label=confused_label,
                    letter=confused_letter,
                    source="husary_augmented",
                    augmentation="confusion_variant_noise",
                    word=word,
                )
            )
            sample_id += 1
            label_source_counts[base_label] += 1

        results[pair_name] = samples
        output_json = Path(f"{resolved_output_json_prefix}_{pair_name}.json")
        output_json.parent.mkdir(parents=True, exist_ok=True)
        output_json.write_text(json.dumps(samples, ensure_ascii=False, indent=2), encoding="utf-8")

    return results


def bootstrap_training_data(
    husary_words_dir: str | Path | None = None,
    *,
    tafkheem_output_path: str | Path | None = None,
    makhraj_output_path: str | Path | None = None,
    confusion_output_prefix: str | Path | None = None,
    tafkheem_output_dir: str | Path | None = None,
    confusion_output_dir: str | Path | None = None,
) -> dict[str, object]:
    config = load_config()
    tafkheem_samples = build_tafkheem_training_data(
        husary_words_dir=husary_words_dir,
        output_dir=tafkheem_output_dir,
        output_json=tafkheem_output_path,
    )
    confusion_results = build_confusion_pair_training_data(
        husary_words_dir=husary_words_dir,
        output_dir=confusion_output_dir,
        output_json_prefix=confusion_output_prefix,
    )

    aggregated_samples: list[dict] = []
    pair_counts: dict[str, int] = {}
    for pair_name, samples in confusion_results.items():
        pair_counts[pair_name] = len(samples)
        aggregated_samples.extend({**sample, "pair_name": pair_name} for sample in samples)

    resolved_makhraj_output = (
        Path(makhraj_output_path).expanduser().resolve()
        if makhraj_output_path is not None
        else config.data_dir / "makhraj_training.json"
    )
    resolved_makhraj_output.parent.mkdir(parents=True, exist_ok=True)
    resolved_makhraj_output.write_text(
        json.dumps(aggregated_samples, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    return {
        "tafkheem_output_path": str(Path(tafkheem_output_path).resolve()),
        "makhraj_output_path": str(resolved_makhraj_output.resolve()),
        "tafkheem_samples": len(tafkheem_samples),
        "confusion_pair_counts": pair_counts,
        "confusion_total_samples": len(aggregated_samples),
    }


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--manifest",
        default=None,
        help="Deprecated single-manifest input. When provided, the parent husary words directory is inferred.",
    )
    parser.add_argument(
        "--husary-words-dir",
        default="audio/husary/words",
        help="Directory containing per-surah Husary word manifests",
    )
    parser.add_argument(
        "--tafkheem-output",
        default="data/tafkheem_training.json",
        help="Output JSON for tafkheem training samples",
    )
    parser.add_argument(
        "--makhraj-output",
        default="data/makhraj_training.json",
        help="Aggregated output JSON for confusion-pair samples",
    )
    parser.add_argument(
        "--confusion-output-prefix",
        default="data/confusion_pair",
        help="Prefix for per-pair output JSON files",
    )
    parser.add_argument(
        "--tafkheem-output-dir",
        default="data/tafkheem_augmented",
        help="Directory for generated tafkheem audio",
    )
    parser.add_argument(
        "--confusion-output-dir",
        default="data/confusion_pairs",
        help="Directory for generated confusion-pair audio",
    )
    arguments = parser.parse_args(argv)

    husary_words_dir = arguments.husary_words_dir
    if arguments.manifest:
        husary_words_dir = str(Path(arguments.manifest).expanduser().resolve().parents[1])

    result = bootstrap_training_data(
        husary_words_dir=husary_words_dir,
        tafkheem_output_path=arguments.tafkheem_output,
        makhraj_output_path=arguments.makhraj_output,
        confusion_output_prefix=arguments.confusion_output_prefix,
        tafkheem_output_dir=arguments.tafkheem_output_dir,
        confusion_output_dir=arguments.confusion_output_dir,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
