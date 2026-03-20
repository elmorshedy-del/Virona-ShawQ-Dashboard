from __future__ import annotations

from pathlib import Path

CONFUSION_PAIR_DEFINITIONS: dict[str, tuple[str, str]] = {
    "ayn_vs_hamza": ("ع", "ء"),
    "haa_vs_ha": ("ح", "ه"),
    "qaaf_vs_kaaf": ("ق", "ك"),
    "saad_vs_seen": ("ص", "س"),
}

LETTER_TO_PAIR = {
    letter: pair_name
    for pair_name, letters in CONFUSION_PAIR_DEFINITIONS.items()
    for letter in letters
}

LETTER_EXPECTED_LABEL = {
    letters[0]: 0
    for letters in CONFUSION_PAIR_DEFINITIONS.values()
} | {
    letters[1]: 1
    for letters in CONFUSION_PAIR_DEFINITIONS.values()
}


def confusion_model_path(models_dir: str | Path, pair_name: str) -> Path:
    return Path(models_dir) / f"confusion_{pair_name}" / "best_model.pt"
