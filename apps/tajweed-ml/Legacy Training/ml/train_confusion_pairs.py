from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from ml._bootstrap import APP_ROOT  # noqa: F401
from tajweed_ml.models.confusion_pairs import train_all_confusion_pairs, train_confusion_pair


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--pair", type=str, default=None, help="Train one specific pair")
    parser.add_argument("--all", action="store_true", help="Train all confusion pairs")
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--epochs", type=int, default=25)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--lr", type=float, default=1e-4)
    parser.add_argument("--model-name", default="jonatasgrosman/wav2vec2-large-xlsr-53-arabic")
    arguments = parser.parse_args()

    if arguments.all or arguments.pair is None:
        result = train_all_confusion_pairs(
            epochs=arguments.epochs,
            batch_size=arguments.batch_size,
            learning_rate=arguments.lr,
            device=arguments.device,
            model_name=arguments.model_name,
        )
    else:
        result = train_confusion_pair(
            arguments.pair,
            data_path=f"data/confusion_pair_{arguments.pair}.json",
            epochs=arguments.epochs,
            batch_size=arguments.batch_size,
            learning_rate=arguments.lr,
            device=arguments.device,
            model_name=arguments.model_name,
        )
    print(json.dumps(result, ensure_ascii=False, indent=2))
