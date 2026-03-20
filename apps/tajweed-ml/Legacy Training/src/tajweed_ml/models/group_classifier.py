from __future__ import annotations

import json
from pathlib import Path

import torch
import torch.nn as nn

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
from ..group_definitions import GROUP_CLASS_COUNTS, labels_for_group, group_model_path
from ..hf_utils import load_audio_model, load_audio_processor
from .common import (
    LetterAudioDataset,
    build_classifier_head,
    build_dataloader,
    configure_wav2vec_layers,
    resolve_device,
    save_json,
    trainable_state_dict,
)

TRAINABLE_ENCODER_LAYERS = 0
HIDDEN_LAYER_SIZES = (512, 256)
DROPOUT_RATES = (0.30, 0.20)
MAX_GRAD_NORM = 1.0
WEIGHT_DECAY = 0.01
MIN_EPOCHS = 5
EARLY_STOPPING_PATIENCE = 3
CPU_SAMPLE_CAP_PER_LABEL = 192


class GroupClassifier(nn.Module):
    def __init__(
        self,
        num_classes: int,
        model_name: str = DEFAULT_ARABIC_MODEL_NAME,
        trainable_encoder_layers: int = TRAINABLE_ENCODER_LAYERS,
    ):
        super().__init__()
        self.wav2vec2 = load_audio_model(model_name)
        configure_wav2vec_layers(self.wav2vec2, trainable_encoder_layers=trainable_encoder_layers)
        hidden_size = self.wav2vec2.config.hidden_size
        self.classifier = build_classifier_head(
            hidden_size,
            output_classes=num_classes,
            hidden_layer_sizes=HIDDEN_LAYER_SIZES,
            dropout_rates=DROPOUT_RATES,
        )

    def forward(self, input_values):
        outputs = self.wav2vec2(input_values)
        pooled = outputs.last_hidden_state.mean(dim=1)
        return self.classifier(pooled)


def _split_group_samples(
    samples: list[dict],
    source_path: str | Path,
    *,
    validation_split: float = DEFAULT_VALIDATION_SPLIT,
    random_seed: int = DEFAULT_RANDOM_SEED,
) -> tuple[Path, Path]:
    if len(samples) < 4:
        raise ValueError("Need at least 4 samples to train a group classifier.")
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
    for label, label_samples in sorted(grouped.items()):
        del label
        rng.shuffle(label_samples)
        selected.extend(label_samples[:cap_per_label])
    rng.shuffle(selected)
    return selected


def train_group(
    group_name: str,
    num_classes: int,
    data_path: str | Path,
    epochs: int = DEFAULT_EPOCHS,
    learning_rate: float = DEFAULT_LEARNING_RATE,
    batch_size: int = DEFAULT_BATCH_SIZE,
    device: str = DEFAULT_DEVICE,
    model_name: str = DEFAULT_ARABIC_MODEL_NAME,
    output_path: str | Path | None = None,
) -> dict[str, float | int | str]:
    samples = json.loads(Path(data_path).read_text(encoding="utf-8"))
    if len(samples) < num_classes * 2:
        raise ValueError(
            f"Need at least {num_classes * 2} samples for {group_name}, found {len(samples)}."
        )

    config = load_config()
    resolved_output_path = (
        Path(output_path)
        if output_path is not None
        else group_model_path(config.group_models_dir, group_name)
    )
    resolved_output_path.parent.mkdir(parents=True, exist_ok=True)

    resolved_device = resolve_device(device)
    if resolved_device == "cpu" and len(samples) > CPU_SAMPLE_CAP_PER_LABEL * num_classes:
        samples = _balanced_subset(samples, CPU_SAMPLE_CAP_PER_LABEL, seed=DEFAULT_RANDOM_SEED)
    train_path, val_path = _split_group_samples(samples, data_path)

    processor = load_audio_processor(model_name)
    train_dataset = LetterAudioDataset.from_json(train_path, processor)
    val_dataset = LetterAudioDataset.from_json(val_path, processor)
    train_loader = build_dataloader(train_dataset, batch_size=batch_size, shuffle=True)
    val_loader = build_dataloader(val_dataset, batch_size=batch_size, shuffle=False)

    model = GroupClassifier(num_classes=num_classes, model_name=model_name).to(resolved_device)
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
                    "group_name": group_name,
                    "num_classes": num_classes,
                    "labels": labels_for_group(group_name),
                    "epoch": epoch,
                    "val_accuracy": val_accuracy,
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
        "group_name": group_name,
        "output_path": str(resolved_output_path),
        "best_val_accuracy": round(best_val_accuracy, 2),
        "last_train_accuracy": round(train_accuracy, 2),
        "last_train_loss": round(average_train_loss, 4),
        "epochs": epochs_ran,
        "device": resolved_device,
    }


def train_all_groups(
    *,
    groups: dict[str, int] | None = None,
    data_prefix: str | Path | None = None,
    epochs: int = DEFAULT_EPOCHS,
    learning_rate: float = DEFAULT_LEARNING_RATE,
    batch_size: int = DEFAULT_BATCH_SIZE,
    device: str = DEFAULT_DEVICE,
    model_name: str = DEFAULT_ARABIC_MODEL_NAME,
) -> dict[str, dict[str, float | int | str] | None]:
    resolved_groups = groups or GROUP_CLASS_COUNTS
    config = load_config()
    resolved_data_prefix = (
        Path(data_prefix).expanduser().resolve()
        if data_prefix is not None
        else config.data_dir / "group_"
    )
    results: dict[str, dict[str, float | int | str] | None] = {}
    for group_name, num_classes in resolved_groups.items():
        data_path = Path(f"{resolved_data_prefix}{group_name}.json")
        if not data_path.exists():
            results[group_name] = None
            continue
        results[group_name] = train_group(
            group_name=group_name,
            num_classes=num_classes,
            data_path=data_path,
            epochs=epochs,
            learning_rate=learning_rate,
            batch_size=batch_size,
            device=device,
            model_name=model_name,
        )
    return results
