from __future__ import annotations

import sys
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from ml._bootstrap import APP_ROOT  # noqa: F401
from tajweed_ml.data_augmentation import (
    simulate_heavy_as_light,
    simulate_light_as_heavy,
    simulate_missing_nasalization,
    simulate_missing_qalqalah,
    simulate_short_madd,
)

__all__ = [
    "simulate_heavy_as_light",
    "simulate_light_as_heavy",
    "simulate_missing_nasalization",
    "simulate_missing_qalqalah",
    "simulate_short_madd",
]
