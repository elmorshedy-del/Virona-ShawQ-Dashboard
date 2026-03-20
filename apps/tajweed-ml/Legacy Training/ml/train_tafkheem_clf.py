from __future__ import annotations

import argparse
import sys
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from ml._bootstrap import APP_ROOT  # noqa: F401
from tajweed_ml.models.tafkheem import TafkheemClassifier, train_tafkheem_model

__all__ = ["TafkheemClassifier", "train_tafkheem_model"]


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", required=True, help="Path to training data JSON")
    parser.add_argument("--output", default="artifacts/models/tafkheem_classifier.pt")
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--lr", type=float, default=1e-4)
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--model-name", default=None)
    arguments = parser.parse_args()
    result = train_tafkheem_model(
        train_data_path=arguments.data,
        output_path=arguments.output,
        epochs=arguments.epochs,
        batch_size=arguments.batch_size,
        learning_rate=arguments.lr,
        device=arguments.device,
        model_name=arguments.model_name or "jonatasgrosman/wav2vec2-large-xlsr-53-arabic",
    )
    print(result)
