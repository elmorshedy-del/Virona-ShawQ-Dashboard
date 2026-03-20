from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import torch
import torch.nn as nn
from sklearn.model_selection import train_test_split
from torch.utils.data import DataLoader, Dataset

from ..audio import load_audio, pad_or_truncate
from ..config import (
    DEFAULT_MAX_CLIP_SAMPLES,
    DEFAULT_RANDOM_SEED,
    DEFAULT_SAMPLE_RATE,
    DEFAULT_VALIDATION_SPLIT,
)

DEFAULT_NUM_WORKERS = 0


class LetterAudioDataset(Dataset):
    """Dataset of pre-segmented word or letter clips with integer class labels."""

    def __init__(
        self,
        samples: list[dict],
        processor: Any,
        max_length: int = DEFAULT_MAX_CLIP_SAMPLES,
        label_key: str = "label",
    ):
        self.samples = samples
        self.processor = processor
        self.max_length = max_length
        self.label_key = label_key

    @classmethod
    def from_json(
        cls,
        data_path: str | Path,
        processor: Any,
        max_length: int = DEFAULT_MAX_CLIP_SAMPLES,
        label_key: str = "label",
    ) -> "LetterAudioDataset":
        samples = json.loads(Path(data_path).read_text(encoding="utf-8"))
        return cls(samples, processor, max_length=max_length, label_key=label_key)

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, idx: int) -> dict:
        sample = self.samples[idx]
        waveform, _ = load_audio(sample["audio_path"], target_sample_rate=DEFAULT_SAMPLE_RATE)
        waveform = pad_or_truncate(waveform, target_num_samples=self.max_length).squeeze(0)
        inputs = self.processor(
            waveform.cpu().numpy(),
            sampling_rate=DEFAULT_SAMPLE_RATE,
            return_tensors="pt",
        )
        return {
            "input_values": inputs.input_values.squeeze(0),
            "label": torch.tensor(int(sample[self.label_key]), dtype=torch.long),
            "letter": sample.get("letter", ""),
        }


def resolve_device(requested_device: str) -> str:
    if requested_device == "cuda" and not torch.cuda.is_available():
        return "cpu"
    return requested_device


def configure_wav2vec_layers(wav2vec_model, trainable_encoder_layers: int) -> None:
    for parameter in wav2vec_model.feature_extractor.parameters():
        parameter.requires_grad = False

    frozen_layer_count = max(0, len(wav2vec_model.encoder.layers) - trainable_encoder_layers)
    for index, layer in enumerate(wav2vec_model.encoder.layers):
        if index < frozen_layer_count:
            for parameter in layer.parameters():
                parameter.requires_grad = False


def build_classifier_head(
    hidden_size: int,
    output_classes: int,
    hidden_layer_sizes: tuple[int, int],
    dropout_rates: tuple[float, float],
) -> nn.Sequential:
    first_hidden_size, second_hidden_size = hidden_layer_sizes
    first_dropout, second_dropout = dropout_rates
    return nn.Sequential(
        nn.Linear(hidden_size, first_hidden_size),
        nn.ReLU(),
        nn.Dropout(first_dropout),
        nn.Linear(first_hidden_size, second_hidden_size),
        nn.ReLU(),
        nn.Dropout(second_dropout),
        nn.Linear(second_hidden_size, output_classes),
    )


def save_json(path: str | Path, payload: list[dict]) -> Path:
    resolved_path = Path(path)
    resolved_path.parent.mkdir(parents=True, exist_ok=True)
    resolved_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return resolved_path


def split_samples(
    samples: list[dict],
    source_path: str | Path,
    validation_split: float = DEFAULT_VALIDATION_SPLIT,
    random_seed: int = DEFAULT_RANDOM_SEED,
) -> tuple[Path, Path]:
    if len(samples) < 2:
        raise ValueError("Need at least 2 labeled samples to create train/validation splits.")
    source = Path(source_path)
    stratify_labels = None
    labels = [sample.get("label") for sample in samples]
    if all(label is not None for label in labels) and len(set(labels)) > 1:
        stratify_labels = labels
    train_samples, val_samples = train_test_split(
        samples,
        test_size=validation_split,
        random_state=random_seed,
        stratify=stratify_labels,
    )
    train_path = source.with_name(f"{source.stem}_train.json")
    val_path = source.with_name(f"{source.stem}_val.json")
    save_json(train_path, train_samples)
    save_json(val_path, val_samples)
    return train_path, val_path


def build_dataloader(
    dataset: Dataset,
    batch_size: int,
    *,
    shuffle: bool,
    num_workers: int = DEFAULT_NUM_WORKERS,
) -> DataLoader:
    return DataLoader(
        dataset,
        batch_size=batch_size,
        shuffle=shuffle,
        num_workers=num_workers,
    )


def trainable_state_dict(model: nn.Module) -> dict[str, torch.Tensor]:
    state: dict[str, torch.Tensor] = {}
    for name, parameter in model.named_parameters():
        if parameter.requires_grad:
            state[name] = parameter.detach().cpu()
    return state
