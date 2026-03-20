from __future__ import annotations

import argparse
import sys
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from ml._bootstrap import APP_ROOT  # noqa: F401
from tajweed_ml.group_definitions import GROUP_CLASS_COUNTS
from tajweed_ml.models.group_classifier import train_all_groups, train_group

__all__ = ["train_all_groups", "train_group"]


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--group", default=None)
    parser.add_argument("--data", default=None)
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--lr", type=float, default=5e-5)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--device", default="cpu")
    arguments = parser.parse_args()

    if arguments.group:
        group_name = arguments.group
        data_path = arguments.data or f"data/group_{group_name}.json"
        print(
            train_group(
                group_name=group_name,
                num_classes=GROUP_CLASS_COUNTS[group_name],
                data_path=data_path,
                epochs=arguments.epochs,
                learning_rate=arguments.lr,
                batch_size=arguments.batch_size,
                device=arguments.device,
            )
        )
    else:
        print(
            train_all_groups(
                epochs=arguments.epochs,
                learning_rate=arguments.lr,
                batch_size=arguments.batch_size,
                device=arguments.device,
            )
        )
