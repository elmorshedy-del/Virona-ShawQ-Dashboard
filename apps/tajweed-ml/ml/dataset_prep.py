from __future__ import annotations

import sys
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from ml._bootstrap import APP_ROOT  # noqa: F401
from tajweed_ml.dataset_prep import (
    create_tajweed_pairs,
    download_tarteel_dataset,
    prepare_reference_dataset,
)

__all__ = ["create_tajweed_pairs", "download_tarteel_dataset", "prepare_reference_dataset"]
