from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]
SRC_PATH = APP_ROOT / "src"
if str(SRC_PATH) not in sys.path:
    sys.path.insert(0, str(SRC_PATH))

from tajweed_ml.optional import require_dependency
from tajweed_ml.quran_text import AL_FATIHA_AYAHS, load_quran_text, split_expected_words


DEFAULT_MODEL_SIZE = "large-v3"
HUSARY_BASE_URL = "https://everyayah.com/data/Husary_128kbps"


def resolve_device(requested_device: str) -> str:
    torch = require_dependency("torch")
    if requested_device == "cuda" and not torch.cuda.is_available():
        return "cpu"
    return requested_device


def compute_type_for_device(device: str) -> str:
    return "float16" if device == "cuda" else "int8"


def is_valid_audio_file(audio_path: Path) -> bool:
    if not audio_path.exists() or audio_path.stat().st_size < 1024:
        return False
    pydub = require_dependency("pydub")
    try:
        pydub.AudioSegment.from_file(audio_path)
    except Exception:
        return False
    return True


def load_expected_surah_words(tanzil_path: str | Path | None = None) -> dict[int, dict[int, list[str]]]:
    quran = load_quran_text(tanzil_path)
    grouped: dict[int, dict[int, list[str]]] = {}
    for key, words in quran.items():
        surah, ayah = [int(part) for part in key.split(":")]
        grouped.setdefault(surah, {})[ayah] = words
    return grouped


def download_husary_surah(surah: int, raw_dir: Path, ayahs: dict[int, list[str]]) -> list[tuple[int, Path]]:
    raw_dir.mkdir(parents=True, exist_ok=True)
    downloaded_paths: list[tuple[int, Path]] = []
    for ayah in sorted(ayahs):
        filename = f"{surah:03d}{ayah:03d}.mp3"
        destination = raw_dir / filename
        url = f"{HUSARY_BASE_URL}/{filename}"
        if not is_valid_audio_file(destination):
            if destination.exists():
                destination.unlink()
            urllib.request.urlretrieve(url, destination)
            if not is_valid_audio_file(destination):
                raise RuntimeError(f"Downloaded audio is invalid for surah {surah}, ayah {ayah}: {destination}")
        downloaded_paths.append((ayah, destination.resolve()))
    return downloaded_paths


def load_transcriber(*, device: str, model_size: str):
    faster_whisper = require_dependency("faster_whisper")
    return faster_whisper.WhisperModel(
        model_size,
        device=device,
        compute_type=compute_type_for_device(device),
    )


def transcribe_words(audio_path: Path, model) -> list[dict]:
    if model is None:
        return []
    segments, _info = model.transcribe(
        str(audio_path),
        language="ar",
        word_timestamps=True,
    )
    words: list[dict] = []
    for segment in segments:
        for word in segment.words or []:
            if word.start is None or word.end is None:
                continue
            text = str(word.word or "").strip()
            if not text:
                continue
            words.append(
                {
                    "word": text,
                    "start": float(word.start),
                    "end": float(word.end),
                    "confidence": float(word.probability or 0.0),
                }
            )
    return words


def distribute_expected_words(expected_words: list[str], duration_sec: float) -> list[tuple[float, float]]:
    if not expected_words:
        return []
    weights = [max(1, len(word)) for word in expected_words]
    total_weight = sum(weights)
    boundaries = [0.0]
    running = 0.0
    for weight in weights:
        running += duration_sec * (weight / total_weight)
        boundaries.append(running)
    boundaries[-1] = duration_sec
    return list(zip(boundaries[:-1], boundaries[1:]))


def align_words(expected_words: list[str], transcript_words: list[dict], duration_sec: float) -> tuple[list[dict], str]:
    if transcript_words and len(transcript_words) == len(expected_words):
        aligned = []
        for index, (expected_word, observed_word) in enumerate(zip(expected_words, transcript_words)):
            aligned.append(
                {
                    "word_index": index,
                    "word": expected_word,
                    "observed_word": observed_word["word"],
                    "start": observed_word["start"],
                    "end": observed_word["end"],
                    "confidence": observed_word["confidence"],
                }
            )
        return aligned, "transcript-word-timestamps"

    fallback_edges = distribute_expected_words(expected_words, duration_sec)
    aligned = []
    for index, (expected_word, (start_sec, end_sec)) in enumerate(zip(expected_words, fallback_edges)):
        observed_word = transcript_words[index]["word"] if index < len(transcript_words) else ""
        confidence = transcript_words[index]["confidence"] if index < len(transcript_words) else 0.0
        aligned.append(
            {
                "word_index": index,
                "word": expected_word,
                "observed_word": observed_word,
                "start": start_sec,
                "end": end_sec,
                "confidence": confidence,
            }
        )
    return aligned, "duration-fallback"


def segment_ayah(
    audio_path: Path,
    *,
    expected_words: list[str],
    output_dir: Path,
    surah: int,
    ayah: int,
    model,
) -> tuple[list[dict], dict]:
    pydub = require_dependency("pydub")
    output_dir.mkdir(parents=True, exist_ok=True)
    audio = pydub.AudioSegment.from_file(audio_path)
    duration_sec = len(audio) / 1000.0
    transcript_words = transcribe_words(audio_path, model)
    aligned_words, alignment_method = align_words(expected_words, transcript_words, duration_sec)

    clips: list[dict] = []
    for item in aligned_words:
        start_ms = max(0, int(item["start"] * 1000))
        end_ms = min(len(audio), max(start_ms + 25, int(item["end"] * 1000)))
        clip_path = output_dir / f"{surah:03d}_{ayah:03d}_{item['word_index']:02d}_{item['word']}.wav"
        audio[start_ms:end_ms].export(clip_path, format="wav")
        clips.append(
            {
                "path": str(clip_path.resolve()),
                "word_index": item["word_index"],
                "word": item["word"],
                "observed_word": item["observed_word"],
                "start": item["start"],
                "end": item["end"],
                "confidence": item["confidence"],
                "alignment_method": alignment_method,
            }
        )

    transcript_debug = {
        "audio_path": str(audio_path.resolve()),
        "expected_words": expected_words,
        "transcript_words": transcript_words,
        "alignment_method": alignment_method,
    }
    return clips, transcript_debug


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--surah", required=True, type=int, help="Surah number to segment")
    parser.add_argument("--output-dir", required=True, help="Root output directory")
    parser.add_argument("--device", default="cuda", help="Execution device")
    parser.add_argument("--model-size", default=DEFAULT_MODEL_SIZE, help="faster-whisper model size")
    parser.add_argument(
        "--force-transcribe",
        action="store_true",
        help="Force faster-whisper transcription even when the device resolves to CPU",
    )
    parser.add_argument(
        "--raw-dir",
        default=str(APP_ROOT / "audio" / "husary" / "raw"),
        help="Directory for downloaded Husary ayah MP3 files",
    )
    parser.add_argument(
        "--tanzil-path",
        default=str(APP_ROOT / "data" / "quran-simple-enhanced.txt"),
        help="Path to Tanzil simple-enhanced text",
    )
    arguments = parser.parse_args()

    expected_surahs = load_expected_surah_words(arguments.tanzil_path)
    if arguments.surah == 1 and arguments.surah not in expected_surahs:
        expected_surahs[1] = {
            ayah: split_expected_words(AL_FATIHA_AYAHS[ayah])
            for ayah in sorted(AL_FATIHA_AYAHS)
        }
    if arguments.surah not in expected_surahs:
        raise SystemExit(
            f"Surah {arguments.surah} not found in {arguments.tanzil_path}. Download Tanzil first."
        )

    resolved_device = resolve_device(arguments.device)
    raw_dir = Path(arguments.raw_dir).expanduser().resolve()
    output_root = Path(arguments.output_dir).expanduser().resolve()
    surah_dir = output_root / str(arguments.surah)
    surah_dir.mkdir(parents=True, exist_ok=True)

    raw_paths = download_husary_surah(arguments.surah, raw_dir, expected_surahs[arguments.surah])
    use_transcriber = resolved_device == "cuda" or arguments.force_transcribe
    model = load_transcriber(device=resolved_device, model_size=arguments.model_size) if use_transcriber else None
    manifest: dict[str, list[dict]] = {}
    transcripts: dict[str, dict] = {}
    for ayah, audio_path in raw_paths:
        expected_words = expected_surahs[arguments.surah][ayah]
        clips, transcript_debug = segment_ayah(
            audio_path,
            expected_words=expected_words,
            output_dir=surah_dir,
            surah=arguments.surah,
            ayah=ayah,
            model=model,
        )
        ayah_key = f"{arguments.surah}:{ayah}"
        manifest[ayah_key] = clips
        transcripts[ayah_key] = transcript_debug

    manifest_path = surah_dir / "manifest.json"
    transcripts_path = surah_dir / "transcripts.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    transcripts_path.write_text(json.dumps(transcripts, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        json.dumps(
            {
                "status": "segmented",
                "requested_device": arguments.device,
                "resolved_device": resolved_device,
                "model_size": arguments.model_size,
                "alignment_mode": "faster-whisper" if use_transcriber else "duration-fallback-only",
                "raw_dir": str(raw_dir),
                "manifest_path": str(manifest_path),
                "transcripts_path": str(transcripts_path),
                "ayahs": len(manifest),
                "word_clips": sum(len(clips) for clips in manifest.values()),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
