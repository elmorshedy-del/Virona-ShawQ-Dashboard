from __future__ import annotations

from pathlib import Path

CONFUSION_GROUPS: dict[str, dict[str, object]] = {
    "throat_depth": {
        "letters": ["ء", "ه", "ع", "ح", "غ", "خ"],
        "description": "6 throat letters at 3 depths - most confused by non-Arabs",
    },
    "emphatic_pairs": {
        "letters": ["ص", "س", "ط", "ت", "ظ", "ذ", "ض", "د"],
        "description": "Emphatic (istilaa+itbaaq) vs plain counterparts",
    },
    "interdental": {
        "letters": ["ث", "ذ", "ظ"],
        "description": "Interdental letters - do not exist in most dialects",
    },
    "uvular_velar": {
        "letters": ["ق", "ك"],
        "description": "Uvular vs velar stop - position difference",
    },
    "sibilants": {
        "letters": ["ص", "س", "ز", "ش"],
        "description": "All sibilants - distinguished by safeer + tafashshi",
    },
    "raa_quality": {
        "letters": ["ر_heavy", "ر_light"],
        "description": "Context-dependent raa - heavy or light based on surrounding vowels",
    },
    "laam_quality": {
        "letters": ["ل_heavy", "ل_light"],
        "description": "Laam in Allah - heavy after fatha/damma, light after kasra",
    },
}

GROUP_CLASS_COUNTS = {
    group_name: len(config["letters"])
    for group_name, config in CONFUSION_GROUPS.items()
}


def base_letter(label: str) -> str:
    return label.split("_", 1)[0]


LETTER_TO_GROUPS: dict[str, list[str]] = {}
for _group_name, _config in CONFUSION_GROUPS.items():
    for _label in _config["letters"]:
        LETTER_TO_GROUPS.setdefault(base_letter(str(_label)), []).append(_group_name)


def group_model_path(group_models_dir: str | Path, group_name: str) -> Path:
    return Path(group_models_dir) / f"{group_name}.pt"


def labels_for_group(group_name: str) -> list[str]:
    config = CONFUSION_GROUPS.get(group_name)
    if config is None:
        raise KeyError(f"Unknown group: {group_name}")
    return [str(label) for label in config["letters"]]

