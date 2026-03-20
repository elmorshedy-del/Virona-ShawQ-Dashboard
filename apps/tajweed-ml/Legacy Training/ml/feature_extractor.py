from __future__ import annotations

import sys
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from ml._bootstrap import APP_ROOT  # noqa: F401
from tajweed_ml.feature_extractor import download_base_model, extract_embedding, extract_features

__all__ = ["download_base_model", "extract_embedding", "extract_features"]
