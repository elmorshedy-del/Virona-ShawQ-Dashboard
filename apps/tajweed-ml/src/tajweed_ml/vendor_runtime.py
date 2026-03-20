from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

from .config import TajweedMLConfig, load_config
from .optional import require_dependency


VENDOR_DEPENDENCIES = (
    ("diff_match_patch", "diff-match-patch"),
    ("fuzzysearch", "fuzzysearch"),
    ("Levenshtein", "python-Levenshtein"),
    ("pydantic", "pydantic"),
    ("rich", "rich"),
    ("xmltodict", "xmltodict"),
)


def ensure_vendor_paths(config: TajweedMLConfig | None = None) -> TajweedMLConfig:
    resolved = config or load_config()
    for repo_dir in (
        resolved.quran_transcript_repo_dir,
        resolved.quran_muaalem_repo_dir,
    ):
        src_dir = repo_dir / "src"
        for candidate in (src_dir, repo_dir):
            if candidate.exists():
                candidate_str = str(candidate.resolve())
                if candidate_str not in sys.path:
                    sys.path.insert(0, candidate_str)
    return resolved


def load_muaalem_vendor(config: TajweedMLConfig | None = None) -> dict[str, Any]:
    resolved = ensure_vendor_paths(config)
    for module_name, package_name in VENDOR_DEPENDENCIES:
        require_dependency(module_name, package_name)

    from quran_muaalem import Muaalem
    from quran_transcript import Aya, MoshafAttributes, chunck_phonemes, explain_error, quran_phonetizer

    return {
        "Aya": Aya,
        "MoshafAttributes": MoshafAttributes,
        "Muaalem": Muaalem,
        "chunck_phonemes": chunck_phonemes,
        "explain_error": explain_error,
        "quran_phonetizer": quran_phonetizer,
        "config": resolved,
    }
