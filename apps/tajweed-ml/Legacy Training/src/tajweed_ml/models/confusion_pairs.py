from __future__ import annotations

import json
from pathlib import Path

import torch
import torch.nn as nn

from ..confusion_pairs import CONFUSION_PAIR_DEFINITIONS, confusion_model_path
from ..config import (
    DEFAULT_ARABIC_MODEL_NAME,
    DEFAULT_BATCH_SIZE,
    DEFAULT_DEVICE,
    DEFAULT_EPOCHS,
    DEFAULT_LEARNING_RATE,
    DEFAULT_RANDOM_SEED,
    DEFAULT_VALIDATION_SPLIT,
    load_config,
)
from ..hf_utils import load_audio_processor
from .common import LetterAudioDataset, build_dataloader, resolve_device, save_json, trainable_state_dict
from .tafkheem import MAX_GRAD_NORM, WEIGHT_DECAY, TafkheemClassifier

MIN_EPOCHS = 3
EARLY_STOPPING_PATIENCE = 2
CPU_SAMPLE_CAP_PER_LABEL = 96


def _split_pair_samples(
    samples: list[dict],
    source_path: str | Path,
    *,
    validation_split: float = DEFAULT_VALIDATION_SPLIT,
    random_seed: int = DEFAULT_RANDOM_SEED,
) -> tuple[Path, Path]:
    if len(samples) < 4:
        raise ValueError("Need at least 4 samples to train a confusion-pair classifier.")
    sklearn_model_selection = __import__("sklearn.model_selection", fromlist=["train_test_split"])
    train_samples, val_samples = sklearn_model_selection.train_test_split(
        samples,
        test_size=validation_split,
        random_state=random_seed,
        stratify=[int(sample["label"]) for sample in samples],
    )
    source = Path(source_path)
    train_path = source.with_name(f"{source.stem}_train.json")
    val_path = source.with_name(f"{source.stem}_val.json")
    save_json(train_path, train_samples)
    save_json(val_path, val_samples)
    return train_path, val_path


def _balanced_subset(samples: list[dict], cap_per_label: int, *, seed: int) -> list[dict]:
    import random

    grouped: dict[int, list[dict]] = {}
    for sample in samples:
        grouped.setdefault(int(sample["label"]), []).append(sample)
    rng = random.Random(seed)
    selected: list[dict] = []
    for label in sorted(grouped):
        label_samples = grouped[label]
        rng.shuffle(label_samples)
        selected.extend(label_samples[:cap_per_label])
    rng.shuffle(selected)
    return selected


def train_confusion_pair(
    pair_name: str,
    data_path: str | Path,
    output_path: str | Path | None = None,
    epochs: int = DEFAULT_EPOCHS,
    batch_size: int = DEFAULT_BATCH_SIZE,
    learning_rate: float = DEFAULT_LEARNING_RATE,
    device: str = DEFAULT_DEVICE,
    model_name: str = DEFAULT_ARABIC_MODEL_NAME,
) -> dict[str, float | int | str]:
    if pair_name not in CONFUSION_PAIR_DEFINITIONS:
        raise ValueError(f"Unknown confusion pair: {pair_name}")

    samples = json.loads(Path(data_path).read_text(encoding="utf-8"))
    if len(samples) < 10:
        raise ValueError(f"Need at least 10 samples for {pair_name}, found {len(samples)}.")

    config = load_config()
    resolved_output_path = (
        Path(output_path)
        if output_path is not None
        else confusion_model_path(config.confusion_models_dir, pair_name)
    )
    resolved_output_path.parent.mkdir(parents=True, exist_ok=True)

    resolved_device = resolve_device(device)
    if resolved_device == "cpu" and len(samples) > CPU_SAMPLE_CAP_PER_LABEL * 2:
        samples = _balanced_subset(samples, CPU_SAMPLE_CAP_PER_LABEL, seed=DEFAULT_RANDOM_SEED)
    train_path, val_path = _split_pair_samples(samples, data_path)
    processor = load_audio_processor(model_name)
    train_dataset = LetterAudioDataset.from_json(train_path, processor)
    val_dataset = LetterAudioDataset.from_json(val_path, processor)
    train_loader = build_dataloader(train_dataset, batch_size=batch_size, shuffle=True)
    val_loader = build_dataloader(val_dataset, batch_size=batch_size, shuffle=False)

    trainable_encoder_layers = 0 if resolved_device == "cpu" else 4
    model = TafkheemClassifier(
        model_name=model_name,
        trainable_encoder_layers=trainable_encoder_layers,
    ).to(resolved_device)
    optimizer = torch.optim.AdamW(
        filter(lambda parameter: parameter.requires_grad, model.parameters()),
        lr=learning_rate,
        weight_decay=WEIGHT_DECAY,
    )
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)
    criterion = nn.CrossEntropyLoss()

    best_val_accuracy = 0.0
    epochs_without_improvement = 0
    train_accuracy = 0.0
    average_train_loss = 0.0
    epochs_ran = 0
    for epoch in range(epochs):
        model.train()
        train_loss = 0.0
        train_correct = 0
        train_total = 0
        for batch in train_loader:
            input_values = batch["input_values"].to(resolved_device)
            labels = batch["label"].to(resolved_device)
            logits = model(input_values)
            loss = criterion(logits, labels)
            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=MAX_GRAD_NORM)
            optimizer.step()
            train_loss += loss.item()
            predictions = logits.argmax(dim=-1)
            train_correct += int((predictions == labels).sum().item())
            train_total += labels.size(0)

        model.eval()
        val_correct = 0
        val_total = 0
        with torch.no_grad():
            for batch in val_loader:
                input_values = batch["input_values"].to(resolved_device)
                labels = batch["label"].to(resolved_device)
                logits = model(input_values)
                predictions = logits.argmax(dim=-1)
                val_correct += int((predictions == labels).sum().item())
                val_total += labels.size(0)

        train_accuracy = (train_correct / max(1, train_total)) * 100
        average_train_loss = train_loss / max(1, len(train_loader))
        val_accuracy = (val_correct / max(1, val_total)) * 100
        if val_accuracy > best_val_accuracy:
            best_val_accuracy = val_accuracy
            epochs_without_improvement = 0
            torch.save(
                {
                    "partial_state_dict": True,
                    "model_state_dict": trainable_state_dict(model),
                    "model_name": model_name,
                    "pair_name": pair_name,
                    "trainable_encoder_layers": trainable_encoder_layers,
                    "epoch": epoch,
                    "val_accuracy": val_accuracy,
                    "labels": CONFUSION_PAIR_DEFINITIONS[pair_name],
                },
                resolved_output_path,
                _use_new_zipfile_serialization=False,
            )
        else:
            epochs_without_improvement += 1
        epochs_ran = epoch + 1
        if epochs_ran >= MIN_EPOCHS and epochs_without_improvement >= EARLY_STOPPING_PATIENCE:
            break
        scheduler.step()

    return {
        "pair_name": pair_name,
        "output_path": str(resolved_output_path),
        "best_val_accuracy": round(best_val_accuracy, 2),
        "last_train_accuracy": round(train_accuracy, 2),
        "last_train_loss": round(average_train_loss, 4),
        "epochs": epochs_ran,
        "device": resolved_device,
    }


def train_all_confusion_pairs(
    *,
    data_prefix: str | Path | None = None,
    epochs: int = DEFAULT_EPOCHS,
    batch_size: int = DEFAULT_BATCH_SIZE,
    learning_rate: float = DEFAULT_LEARNING_RATE,
    device: str = DEFAULT_DEVICE,
    model_name: str = DEFAULT_ARABIC_MODEL_NAME,
) -> dict[str, dict[str, float | int | str] | None]:
    config = load_config()
    resolved_data_prefix = (
        Path(data_prefix).expanduser().resolve()
        if data_prefix is not None
        else config.data_dir / "confusion_pair"
    )
    results: dict[str, dict[str, float | int | str] | None] = {}
    for pair_name in CONFUSION_PAIR_DEFINITIONS:
        data_path = Path(f"{resolved_data_prefix}_{pair_name}.json")
        if not data_path.exists():
            results[pair_name] = None
            continue
        results[pair_name] = train_confusion_pair(
            pair_name,
            data_path=data_path,
            epochs=epochs,
            batch_size=batch_size,
            learning_rate=learning_rate,
            device=device,
            model_name=model_name,
        )
    return results
