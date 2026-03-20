from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

from datasets import load_dataset
from huggingface_hub import snapshot_download

APP_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = APP_ROOT / "src"
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from tajweed_ml.config import load_config
from tajweed_ml.dataset_downloads import build_word_audio_index
from tajweed_ml.optional import require_dependency
from tajweed_ml.segmenter import download_segmenter_model
from tajweed_ml.vendor_runtime import load_muaalem_vendor


def setup_muaalem(cache_dir: str | Path | None = None):
    config = load_config()
    resolved_cache_dir = Path(cache_dir) if cache_dir is not None else config.muaalem_model_dir
    resolved_cache_dir.mkdir(parents=True, exist_ok=True)
    torch = require_dependency("torch")
    vendor = load_muaalem_vendor(config)

    print("Downloading Muaalem model v3.2 (~1.2GB)...")
    snapshot_download(
        repo_id=config.muaalem_model_name,
        local_dir=str(resolved_cache_dir),
        resume_download=True,
    )
    runtime = vendor["Muaalem"](
        model_name_or_path=str(resolved_cache_dir),
        device="cuda" if torch.cuda.is_available() else "cpu",
        dtype=torch.bfloat16 if torch.cuda.is_available() else torch.float32,
    )
    print(f"Model parameters: {sum(parameter.numel() for parameter in runtime.model.parameters()):,}")
    print("Muaalem model ready")
    return runtime.processor, runtime.model


def setup_segmenter(cache_dir: str | Path | None = None):
    print("Downloading recitation segmenter v2 (~1.2GB)...")
    payload = download_segmenter_model(cache_dir)
    print("Segmenter model ready")
    return payload


def _export_buraaq_audio_tree(index: dict[str, dict[str, object]], destination_root: Path) -> int:
    copied = 0
    for payload in index.values():
        surah = int(payload.get("surah", 0))
        ayah = int(payload.get("ayah", 0))
        word_index = int(payload.get("word_index", 0))
        source_path = Path(str(payload.get("audio_path", "")))
        if not source_path.exists():
            continue
        target_dir = destination_root / str(surah) / str(ayah)
        target_dir.mkdir(parents=True, exist_ok=True)
        target_path = target_dir / f"{word_index}.mp3"
        if not target_path.exists():
            shutil.copyfile(source_path, target_path)
        copied += 1
    return copied


def setup_word_audio(cache_dir: str | Path | None = None):
    config = load_config()
    resolved_cache_dir = (
        Path(cache_dir).expanduser().resolve()
        if cache_dir is not None
        else config.buraaq_dataset_dir.parent
    )
    resolved_cache_dir.mkdir(parents=True, exist_ok=True)

    print("Downloading Buraaq word audio dataset...")
    dataset = load_dataset("Buraaq/quran-audio-text-dataset", split="train")
    words_dir = resolved_cache_dir / "words"
    dataset.save_to_disk(str(words_dir))
    print(f"Downloaded {len(dataset)} word entries")

    index = build_word_audio_index(words_dir)
    copied = _export_buraaq_audio_tree(index, config.served_word_audio_dir)
    print(f"Prepared {copied} served word audio files")
    return dataset


def setup_quran_text():
    print("Quran text available via Buraaq dataset (word_ar field)")


def setup_runtime_models(preload_segmenter: bool | None = None):
    should_preload_muaalem = os.getenv("TAJWEED_ML_PRELOAD_MUAALEM", "").strip().lower()
    if should_preload_muaalem in {"0", "false", "no", "off"}:
        print("Skipping Muaalem preload (TAJWEED_ML_PRELOAD_MUAALEM disables it)")
    else:
        setup_muaalem()
    should_preload_segmenter = preload_segmenter
    if should_preload_segmenter is None:
        should_preload_segmenter = os.getenv("TAJWEED_ML_PRELOAD_SEGMENTER", "").strip().lower() in {
            "1",
            "true",
            "yes",
            "on",
        }
    if should_preload_segmenter:
        setup_segmenter()
    else:
        print("Skipping segmenter preload (set TAJWEED_ML_PRELOAD_SEGMENTER=1 to include it)")


def verify_setup():
    config = load_config()
    print("\n" + "=" * 60)
    print("Verifying setup...")
    print("=" * 60)

    try:
        vendor = load_muaalem_vendor(config)
        torch = require_dependency("torch")
        runtime = vendor["Muaalem"](
            model_name_or_path=str(config.muaalem_model_dir),
            device="cuda" if torch.cuda.is_available() else "cpu",
            dtype=torch.bfloat16 if torch.cuda.is_available() else torch.float32,
        )
        del runtime
        print("  Muaalem model: OK")
    except Exception as exc:
        print(f"  Muaalem model: FAILED - {exc}")

    try:
        from transformers import AutoFeatureExtractor, AutoModelForAudioFrameClassification

        AutoFeatureExtractor.from_pretrained(str(config.segmenter_model_dir))
        AutoModelForAudioFrameClassification.from_pretrained(str(config.segmenter_model_dir))
        print("  Segmenter model: OK")
    except Exception as exc:
        print(f"  Segmenter model: FAILED - {exc}")

    print("Setup complete")


if __name__ == "__main__":
    setup_muaalem()
    setup_segmenter()
    setup_word_audio()
    setup_quran_text()
    verify_setup()
