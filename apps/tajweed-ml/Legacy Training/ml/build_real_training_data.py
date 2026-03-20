from __future__ import annotations

import sys
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from ml._bootstrap import APP_ROOT  # noqa: F401
from tajweed_ml.real_training_data import (  # noqa: F401
    CONFUSION_GROUPS,
    build_all_training_data,
    build_error_detection_data,
    build_group_data_from_buraaq,
    check_context,
)

__all__ = [
    "CONFUSION_GROUPS",
    "build_all_training_data",
    "build_error_detection_data",
    "build_group_data_from_buraaq",
    "check_context",
]


if __name__ == "__main__":
    build_all_training_data()
