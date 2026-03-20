from __future__ import annotations

import os
from dataclasses import asdict, dataclass
from pathlib import Path


APP_ROOT = Path(__file__).resolve().parents[2]
ARTIFACT_ROOT_ENV = "TAJWEED_ML_ARTIFACT_ROOT"
STORAGE_ROOT_ENV = "TAJWEED_ML_STORAGE_ROOT"

DEFAULT_SAMPLE_RATE = 16_000
DEFAULT_MAX_CLIP_SAMPLES = DEFAULT_SAMPLE_RATE
DEFAULT_DEVICE = "cpu"
DEFAULT_SERVER_HOST = "0.0.0.0"
DEFAULT_SERVER_PORT = int(os.getenv("PORT", "8000"))

DEFAULT_MUAALEM_MODEL_NAME = "obadx/muaalem-model-v3_2"
DEFAULT_SEGMENTER_MODEL_NAME = "obadx/recitation-segmenter-v2"

ARTIFACTS_DIRNAME = "artifacts"
DATA_DIRNAME = "data"
AUDIO_DIRNAME = "audio"
ML_DIRNAME = "ml"
MODELS_DIRNAME = "models"
VENDOR_DIRNAME = "vendor"
BURAAQ_DIRNAME = "buraaq"
WORDS_DIRNAME = "words"
HUSARY_DIRNAME = "husary"
WORD_INDEX_FILENAME = "word_index.json"


@dataclass(frozen=True)
class TajweedMLConfig:
    storage_root: Path
    artifact_root: Path
    data_dir: Path
    audio_dir: Path
    ml_dir: Path
    models_dir: Path
    vendor_dir: Path
    husary_word_audio_dir: Path
    served_word_audio_dir: Path
    buraaq_dataset_dir: Path
    buraaq_word_index_path: Path
    muaalem_model_name: str = DEFAULT_MUAALEM_MODEL_NAME
    segmenter_model_name: str = DEFAULT_SEGMENTER_MODEL_NAME
    muaalem_model_dir: Path = APP_ROOT / ML_DIRNAME / MODELS_DIRNAME / "muaalem"
    segmenter_model_dir: Path = APP_ROOT / ML_DIRNAME / MODELS_DIRNAME / "segmenter"
    quran_muaalem_repo_dir: Path = APP_ROOT / ML_DIRNAME / VENDOR_DIRNAME / "quran-muaalem"
    quran_transcript_repo_dir: Path = APP_ROOT / ML_DIRNAME / VENDOR_DIRNAME / "quran-transcript"
    sample_rate: int = DEFAULT_SAMPLE_RATE
    max_clip_samples: int = DEFAULT_MAX_CLIP_SAMPLES
    default_device: str = DEFAULT_DEVICE
    server_host: str = DEFAULT_SERVER_HOST
    server_port: int = DEFAULT_SERVER_PORT

    def as_dict(self) -> dict[str, str | int]:
        payload = asdict(self)
        for key, value in payload.items():
            if isinstance(value, Path):
                payload[key] = str(value)
        return payload


def _resolve_storage_root(storage_root: str | Path | None = None) -> Path:
    if storage_root is not None:
        return Path(storage_root).expanduser().resolve()
    env_value = os.getenv(STORAGE_ROOT_ENV, "").strip()
    if env_value:
        return Path(env_value).expanduser().resolve()
    return APP_ROOT.resolve()


def _resolve_artifact_root(
    artifact_root: str | Path | None = None,
    *,
    storage_root: str | Path | None = None,
) -> Path:
    if artifact_root is not None:
        return Path(artifact_root).expanduser().resolve()
    env_value = os.getenv(ARTIFACT_ROOT_ENV, "").strip()
    if env_value:
        return Path(env_value).expanduser().resolve()
    resolved_storage_root = _resolve_storage_root(storage_root)
    return (resolved_storage_root / ARTIFACTS_DIRNAME).resolve()


def load_config(
    artifact_root: str | Path | None = None,
    storage_root: str | Path | None = None,
) -> TajweedMLConfig:
    resolved_storage_root = _resolve_storage_root(storage_root)
    resolved_artifact_root = _resolve_artifact_root(artifact_root, storage_root=resolved_storage_root)
    data_dir = resolved_storage_root / DATA_DIRNAME
    audio_dir = resolved_storage_root / AUDIO_DIRNAME
    ml_dir = resolved_storage_root / ML_DIRNAME
    models_dir = ml_dir / MODELS_DIRNAME
    vendor_dir = ml_dir / VENDOR_DIRNAME
    buraaq_dataset_dir = data_dir / BURAAQ_DIRNAME / WORDS_DIRNAME
    return TajweedMLConfig(
        storage_root=resolved_storage_root,
        artifact_root=resolved_artifact_root,
        data_dir=data_dir,
        audio_dir=audio_dir,
        ml_dir=ml_dir,
        models_dir=models_dir,
        vendor_dir=vendor_dir,
        husary_word_audio_dir=audio_dir / HUSARY_DIRNAME / WORDS_DIRNAME,
        served_word_audio_dir=audio_dir / WORDS_DIRNAME,
        buraaq_dataset_dir=buraaq_dataset_dir,
        buraaq_word_index_path=buraaq_dataset_dir / WORD_INDEX_FILENAME,
        muaalem_model_dir=models_dir / "muaalem",
        segmenter_model_dir=models_dir / "segmenter",
        quran_muaalem_repo_dir=vendor_dir / "quran-muaalem",
        quran_transcript_repo_dir=vendor_dir / "quran-transcript",
    )
