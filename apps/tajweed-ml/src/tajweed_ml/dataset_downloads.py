from __future__ import annotations

import json
import os
from pathlib import Path

from .config import load_config

LIVE_BURAAQ_DATASET_ID = "Buraaq/quran-md-words"
LEGACY_BURAAQ_DATASET_ID = "Buraaq/quran-audio-text-dataset"
MATERIALIZED_AUDIO_DIRNAME = "_materialized_audio"


def _load_dataset_dependencies():
    from datasets import Audio, load_dataset, load_from_disk

    return Audio, load_dataset, load_from_disk


def _load_hf_dataset_with_fallback(repo_ids: tuple[str, ...], *, split: str = "train"):
    _, load_dataset, _ = _load_dataset_dependencies()
    last_error: Exception | None = None
    for repo_id in repo_ids:
        try:
            return repo_id, load_dataset(repo_id, split=split)
        except Exception as exc:
            last_error = exc
            print(f"Failed to load {repo_id}: {exc}")
    assert last_error is not None
    raise RuntimeError(f"Unable to load any dataset repo from {repo_ids}") from last_error


def download_buraaq(output_dir: str | Path | None = None):
    config = load_config()
    resolved_output_dir = (
        Path(output_dir).expanduser().resolve()
        if output_dir is not None
        else config.buraaq_dataset_dir.parent
    )
    resolved_output_dir.mkdir(parents=True, exist_ok=True)

    print("Downloading Buraaq word-level dataset...")
    repo_id, dataset = _load_hf_dataset_with_fallback((LIVE_BURAAQ_DATASET_ID, LEGACY_BURAAQ_DATASET_ID))
    dataset.save_to_disk(resolved_output_dir / "words")
    print(f"Downloaded {len(dataset)} entries from {repo_id}")
    return dataset


def download_tarteel(output_dir: str | Path | None = None):
    _, load_dataset, _ = _load_dataset_dependencies()
    config = load_config()
    resolved_output_dir = (
        Path(output_dir).expanduser().resolve()
        if output_dir is not None
        else config.tarteel_dataset_dir.parent
    )
    resolved_output_dir.mkdir(parents=True, exist_ok=True)

    print("Downloading Tarteel EveryAyah dataset...")
    dataset = load_dataset("tarteel-ai/everyayah", split="train")
    dataset.save_to_disk(resolved_output_dir / "everyayah")
    print(f"Downloaded {len(dataset)} recordings")
    return dataset


def download_retasy(output_dir: str | Path | None = None):
    Audio, load_dataset, _ = _load_dataset_dependencies()
    config = load_config()
    resolved_output_dir = (
        Path(output_dir).expanduser().resolve()
        if output_dir is not None
        else config.retasy_dataset_dir.parent
    )
    resolved_output_dir.mkdir(parents=True, exist_ok=True)

    print("Downloading RetaSy student recitation dataset...")
    dataset = load_dataset("RetaSy/quranic_audio_dataset", split="train")
    dataset.save_to_disk(resolved_output_dir / "student_recordings")
    if "audio" in dataset.column_names:
        dataset = dataset.cast_column("audio", Audio(decode=False))
    labeled = [sample for sample in dataset if sample.get("final_label") in ("correct", "in_correct")]
    print(f"Downloaded {len(dataset)} total, {len(labeled)} with labels")
    return dataset


def _resolve_candidate_path(candidate: str | os.PathLike[str] | None, roots: list[Path]) -> str:
    if not candidate:
        return ""
    path = Path(candidate)
    if path.exists():
        return str(path.resolve())
    for root in roots:
        joined = (root / path).resolve()
        if joined.exists():
            return str(joined)
    return str(path)


def _materialize_audio_payload(
    audio_payload: dict | None,
    dataset_dir: Path,
    *,
    fallback_name: str,
) -> str:
    if not isinstance(audio_payload, dict):
        return ""
    payload_bytes = audio_payload.get("bytes")
    if not payload_bytes:
        return ""

    raw_path = str(audio_payload.get("path") or fallback_name).strip()
    relative_path = Path(raw_path)
    if relative_path.is_absolute():
        relative_path = Path(relative_path.name)
    materialized_path = (dataset_dir / MATERIALIZED_AUDIO_DIRNAME / relative_path).resolve()
    materialized_path.parent.mkdir(parents=True, exist_ok=True)
    if not materialized_path.exists():
        materialized_path.write_bytes(payload_bytes)
    return str(materialized_path)


def _default_audio_filename(item: dict, extension: str = ".mp3") -> str:
    coordinates = _extract_buraaq_coordinates(item)
    if coordinates is None:
        return f"clip{extension}"
    surah, ayah, word_index = coordinates
    return f"{surah:03d}_{ayah:03d}_{word_index:03d}{extension}"


def resolve_buraaq_word_audio_path(item: dict, dataset_dir: str | Path | None = None) -> str:
    config = load_config()
    resolved_dataset_dir = (
        Path(dataset_dir).expanduser().resolve()
        if dataset_dir is not None
        else config.buraaq_dataset_dir
    )
    audio_payload = item.get("audio") or {}
    resolved_path = _resolve_candidate_path(
        audio_payload.get("path") or item.get("audio_word_path"),
        [
            resolved_dataset_dir,
            resolved_dataset_dir.parent,
            resolved_dataset_dir.parent.parent,
        ],
    )
    if Path(resolved_path).exists():
        return resolved_path
    return _materialize_audio_payload(
        audio_payload,
        resolved_dataset_dir,
        fallback_name=str(audio_payload.get("path") or item.get("audio_word_path") or _default_audio_filename(item)),
    ) or resolved_path


def resolve_dataset_audio_path(
    item: dict,
    dataset_dir: str | Path | None,
    *,
    audio_field: str = "audio",
    fallback_field: str | None = None,
) -> str:
    config = load_config()
    if dataset_dir is None:
        resolved_dataset_dir = config.data_dir
    else:
        resolved_dataset_dir = Path(dataset_dir).expanduser().resolve()
    audio_payload = item.get(audio_field) or {}
    fallback_value = item.get(fallback_field) if fallback_field else None
    resolved_path = _resolve_candidate_path(
        audio_payload.get("path") or fallback_value,
        [
            resolved_dataset_dir,
            resolved_dataset_dir.parent,
            resolved_dataset_dir.parent.parent,
        ],
    )
    if Path(resolved_path).exists():
        return resolved_path
    return _materialize_audio_payload(
        audio_payload,
        resolved_dataset_dir,
        fallback_name=str(audio_payload.get("path") or fallback_value or _default_audio_filename(item, extension=".wav")),
    ) or resolved_path


def _extract_buraaq_coordinates(item: dict) -> tuple[int, int, int] | None:
    surah = item.get("surah_id", item.get("surah"))
    ayah = item.get("ayah_id", item.get("ayah"))
    word_index = item.get("word_index")
    if surah is not None and ayah is not None and word_index is not None:
        try:
            return int(surah), int(ayah), int(word_index)
        except (TypeError, ValueError):
            return None

    word_id = str(item.get("word_id", "")).strip()
    if word_id:
        parts = word_id.split(":")
        if len(parts) == 3:
            try:
                return int(parts[0]), int(parts[1]), max(0, int(parts[2]) - 1)
            except ValueError:
                return None

    path = str(item.get("audio_word_path", "")).strip()
    parts = Path(path).name.replace(".mp3", "").split("_")
    if len(parts) != 3:
        return None
    try:
        return int(parts[0]), int(parts[1]), int(parts[2])
    except ValueError:
        return None


def build_word_audio_index(dataset_dir: str | Path | None = None) -> dict[str, dict[str, object]]:
    Audio, _, load_from_disk = _load_dataset_dependencies()
    config = load_config()
    resolved_dataset_dir = (
        Path(dataset_dir).expanduser().resolve()
        if dataset_dir is not None
        else config.buraaq_dataset_dir
    )
    dataset = load_from_disk(str(resolved_dataset_dir))
    if "audio" in dataset.column_names:
        dataset = dataset.cast_column("audio", Audio(decode=False))

    index: dict[str, dict[str, object]] = {}
    for item in dataset:
        coordinates = _extract_buraaq_coordinates(item)
        if coordinates is None:
            continue
        surah, ayah, word_index = coordinates
        key = f"{surah}:{ayah}:{word_index}"
        index[key] = {
            "audio_path": resolve_buraaq_word_audio_path(item, resolved_dataset_dir),
            "audio_word_path": str(item.get("audio_word_path") or item.get("word_id") or ""),
            "word_ar": item.get("word_ar", ""),
            "word_en": item.get("word_en", ""),
            "word_tr": item.get("word_tr", ""),
            "surah": surah,
            "ayah": ayah,
            "word_index": word_index,
        }

    index_path = resolved_dataset_dir / "word_index.json"
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Built index with {len(index)} word entries")
    return index


def load_word_audio_index(index_path: str | Path) -> dict[str, dict[str, object]]:
    resolved_index_path = Path(index_path)
    if not resolved_index_path.exists():
        return {}
    return json.loads(resolved_index_path.read_text(encoding="utf-8"))
