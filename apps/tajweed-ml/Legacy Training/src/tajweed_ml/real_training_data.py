from __future__ import annotations

import json
import random
from pathlib import Path

from .config import load_config
from .dataset_downloads import resolve_buraaq_word_audio_path, resolve_dataset_audio_path
from .group_definitions import CONFUSION_GROUPS


def _load_dataset(path: str | Path):
    from datasets import Audio, load_from_disk

    dataset = load_from_disk(str(path))
    if "audio" in dataset.column_names:
        dataset = dataset.cast_column("audio", Audio(decode=False))
    return dataset


def check_context(word_ar: str, letter: str, letter_with_context: str) -> bool:
    is_heavy = "_heavy" in letter_with_context
    letter_index = word_ar.find(letter)
    if letter_index < 0:
        return False

    fatha = "َ"
    damma = "ُ"
    kasra = "ِ"
    if letter_index > 0:
        previous_char = word_ar[letter_index - 1]
        if is_heavy and previous_char in (fatha, damma):
            return True
        if not is_heavy and previous_char == kasra:
            return True
    return letter_index == 0 and is_heavy


def build_group_data_from_buraaq(
    group_name: str,
    letters: list[str],
    buraaq_dir: str | Path | None = None,
    output_json: str | Path | None = None,
    max_per_class: int = 500,
):
    config = load_config()
    resolved_buraaq_dir = (
        Path(buraaq_dir).expanduser().resolve()
        if buraaq_dir is not None
        else config.buraaq_dataset_dir
    )
    if output_json is None:
        output_json = config.data_dir / f"group_{group_name}.json"
    else:
        output_json = Path(output_json).expanduser().resolve()

    dataset = _load_dataset(resolved_buraaq_dir)
    samples_by_class: dict[int, list[dict]] = {index: [] for index in range(len(letters))}
    for item in dataset:
        word_ar = str(item.get("word_ar", ""))
        audio_path = resolve_buraaq_word_audio_path(item, resolved_buraaq_dir)
        if not audio_path or not Path(audio_path).exists():
            continue

        for label_index, letter in enumerate(letters):
            search_letter = letter.split("_", 1)[0] if "_" in letter else letter
            if search_letter not in word_ar:
                continue
            if "_" in letter and not check_context(word_ar, search_letter, letter):
                continue
            samples_by_class[label_index].append(
                {
                    "audio_path": audio_path,
                    "label": label_index,
                    "letter": letter,
                    "word": word_ar,
                    "source": "buraaq",
                }
            )
            break

    print(f"\n{group_name} raw counts:")
    min_count = float("inf")
    for label_index, letter in enumerate(letters):
        count = len(samples_by_class[label_index])
        print(f"  {letter}: {count} clips")
        if count > 0:
            min_count = min(min_count, count)

    if min_count == 0 or min_count == float("inf"):
        print("  SKIP: at least one class has 0 samples")
        return None

    balanced: list[dict] = []
    cap = min(int(min_count), max_per_class)
    for label_index in range(len(letters)):
        random.shuffle(samples_by_class[label_index])
        balanced.extend(samples_by_class[label_index][:cap])

    random.shuffle(balanced)
    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(json.dumps(balanced, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  Saved {len(balanced)} balanced samples ({cap} per class)")
    return balanced


def build_error_detection_data(
    buraaq_dir: str | Path | None = None,
    retasy_dir: str | Path | None = None,
    output_json: str | Path | None = None,
):
    config = load_config()
    resolved_buraaq_dir = (
        Path(buraaq_dir).expanduser().resolve()
        if buraaq_dir is not None
        else config.buraaq_dataset_dir
    )
    resolved_retasy_dir = (
        Path(retasy_dir).expanduser().resolve()
        if retasy_dir is not None
        else config.retasy_dataset_dir
    )
    resolved_output = (
        Path(output_json).expanduser().resolve()
        if output_json is not None
        else config.data_dir / "error_detection_training.json"
    )
    samples: list[dict] = []

    print("Loading Buraaq correct samples...")
    buraaq_dataset = _load_dataset(resolved_buraaq_dir)
    for item in buraaq_dataset:
        audio_path = resolve_buraaq_word_audio_path(item, resolved_buraaq_dir)
        if not audio_path or not Path(audio_path).exists():
            continue
        samples.append({"audio_path": audio_path, "label": 0, "source": "buraaq"})

    print("Loading RetaSy student error samples...")
    retasy_dataset = _load_dataset(resolved_retasy_dir)
    correct_student: list[dict] = []
    incorrect_student: list[dict] = []
    for item in retasy_dataset:
        audio_path = resolve_dataset_audio_path(item, resolved_retasy_dir)
        if not audio_path or not Path(audio_path).exists():
            continue
        label = str(item.get("final_label", ""))
        if label == "correct":
            correct_student.append({"audio_path": audio_path, "label": 0, "source": "retasy_correct"})
        elif label == "in_correct":
            incorrect_student.append({"audio_path": audio_path, "label": 1, "source": "retasy_incorrect"})

    print(f"RetaSy: {len(correct_student)} correct, {len(incorrect_student)} incorrect")

    all_correct = [sample for sample in samples if sample["label"] == 0][:2000]
    all_correct.extend(correct_student)
    min_count = min(len(all_correct), len(incorrect_student))
    random.shuffle(all_correct)
    random.shuffle(incorrect_student)

    balanced = all_correct[:min_count] + incorrect_student[:min_count]
    random.shuffle(balanced)

    resolved_output.parent.mkdir(parents=True, exist_ok=True)
    resolved_output.write_text(json.dumps(balanced, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Error detection data: {len(balanced)} samples ({min_count} per class)")
    return balanced


def build_all_training_data():
    random.seed(42)
    for group_name, config in CONFUSION_GROUPS.items():
        print(f"\n{'=' * 60}")
        print(f"Building: {group_name}")
        print(f"{'=' * 60}")
        build_group_data_from_buraaq(group_name, list(config["letters"]))

    print(f"\n{'=' * 60}")
    print("Building error detection data")
    print(f"{'=' * 60}")
    build_error_detection_data()
