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
    load_config,
)
from ..hf_utils import load_audio_model, load_audio_processor
from .common import (
    LetterAudioDataset,
    build_classifier_head,
    build_dataloader,
    configure_wav2vec_layers,
    resolve_device,
    save_json,
    split_samples,
    trainable_state_dict,
)

ARABIC_PHONEMES = [
    "ء",
    "ب",
    "ت",
    "ث",
    "ج",
    "ح",
    "خ",
    "د",
    "ذ",
    "ر",
    "ز",
    "س",
    "ش",
    "ص",
    "ض",
    "ط",
    "ظ",
    "ع",
    "غ",
    "ف",
    "ق",
    "ك",
    "ل",
    "م",
    "ن",
    "ه",
    "و",
    "ي",
    "SIL",
]
PHONEME_TO_INDEX = {phoneme: index for index, phoneme in enumerate(ARABIC_PHONEMES)}
TRAINABLE_ENCODER_LAYERS = 6
HIDDEN_LAYER_SIZES = (512, 256)
DROPOUT_RATES = (0.30, 0.20)
MAX_GRAD_NORM = 1.0
WEIGHT_DECAY = 0.01


class MakhrajClassifier(nn.Module):
    def __init__(
        self,
        model_name: str = DEFAULT_ARABIC_MODEL_NAME,
        trainable_encoder_layers: int = TRAINABLE_ENCODER_LAYERS,
    ):
        super().__init__()
        self.wav2vec2 = load_audio_model(model_name)
        configure_wav2vec_layers(self.wav2vec2, trainable_encoder_layers=trainable_encoder_layers)
        hidden_size = self.wav2vec2.config.hidden_size
        self.classifier = build_classifier_head(
            hidden_size,
            output_classes=len(ARABIC_PHONEMES),
            hidden_layer_sizes=HIDDEN_LAYER_SIZES,
            dropout_rates=DROPOUT_RATES,
        )

    def forward(self, input_values):
        outputs = self.wav2vec2(input_values)
        pooled = outputs.last_hidden_state.mean(dim=1)
        return self.classifier(pooled)

    def predict(self, input_values) -> tuple[str, float]:
        logits = self.forward(input_values)
        probabilities = torch.softmax(logits, dim=-1)
        predicted_index = probabilities.argmax(dim=-1).item()
        return ARABIC_PHONEMES[predicted_index], float(probabilities[0, predicted_index].item())


def _normalized_samples(source_path: str | Path) -> tuple[list[dict], Path]:
    resolved_source_path = Path(source_path)
    samples = json.loads(resolved_source_path.read_text(encoding="utf-8"))
    normalized: list[dict] = []
    for sample in samples:
        label_value = sample.get("label")
        if label_value is None:
            phoneme = sample.get("phoneme")
            if phoneme not in PHONEME_TO_INDEX:
                raise ValueError("Each makhraj sample must include either 'label' or a valid 'phoneme'.")
            label_value = PHONEME_TO_INDEX[phoneme]
        normalized.append({**sample, "label": int(label_value)})
    normalized_path = resolved_source_path.with_name(f"{resolved_source_path.stem}_normalized.json")
    save_json(normalized_path, normalized)
    return normalized, normalized_path


def train_makhraj_model(
    train_data_path: str | Path,
    output_path: str | Path | None = None,
    epochs: int = DEFAULT_EPOCHS,
    batch_size: int = DEFAULT_BATCH_SIZE,
    learning_rate: float = DEFAULT_LEARNING_RATE,
    device: str = DEFAULT_DEVICE,
    model_name: str = DEFAULT_ARABIC_MODEL_NAME,
) -> dict[str, float | int | str]:
    config = load_config()
    resolved_output_path = Path(output_path) if output_path is not None else config.makhraj_model_path
    resolved_output_path.parent.mkdir(parents=True, exist_ok=True)

    normalized_samples, normalized_path = _normalized_samples(train_data_path)
    train_path, val_path = split_samples(normalized_samples, normalized_path)
    processor = load_audio_processor(model_name)
    train_dataset = LetterAudioDataset.from_json(train_path, processor)
    val_dataset = LetterAudioDataset.from_json(val_path, processor)
    train_loader = build_dataloader(train_dataset, batch_size=batch_size, shuffle=True)
    val_loader = build_dataloader(val_dataset, batch_size=batch_size, shuffle=False)

    resolved_device = resolve_device(device)
    model = MakhrajClassifier(model_name=model_name).to(resolved_device)
    optimizer = torch.optim.AdamW(
        filter(lambda parameter: parameter.requires_grad, model.parameters()),
        lr=learning_rate,
        weight_decay=WEIGHT_DECAY,
    )
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)
    criterion = nn.CrossEntropyLoss()

    best_val_accuracy = 0.0
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

        val_accuracy = (val_correct / max(1, val_total)) * 100
        if val_accuracy > best_val_accuracy:
            best_val_accuracy = val_accuracy
            torch.save(
                {
                    "partial_state_dict": True,
                    "model_state_dict": trainable_state_dict(model),
                    "model_name": model_name,
                    "epoch": epoch,
                    "val_accuracy": val_accuracy,
                    "phonemes": ARABIC_PHONEMES,
                },
                resolved_output_path,
                _use_new_zipfile_serialization=False,
            )
        scheduler.step()

    train_accuracy = (train_correct / max(1, train_total)) * 100
    average_train_loss = train_loss / max(1, len(train_loader))
    return {
        "output_path": str(resolved_output_path),
        "best_val_accuracy": round(best_val_accuracy, 2),
        "last_train_accuracy": round(train_accuracy, 2),
        "last_train_loss": round(average_train_loss, 4),
        "epochs": epochs,
        "device": resolved_device,
    }
