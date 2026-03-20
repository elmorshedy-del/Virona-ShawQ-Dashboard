from __future__ import annotations

import json
from pathlib import Path

from .config import load_config
from .optional import require_dependency


def download_tarteel_dataset(
    output_dir: str | Path | None = None,
    dataset_name: str = "tarteel-ai/quran-recitations",
    split: str = "train",
):
    datasets = require_dependency("datasets")
    config = load_config()
    resolved_output_dir = Path(output_dir) if output_dir is not None else config.tarteel_dataset_dir
    resolved_output_dir.mkdir(parents=True, exist_ok=True)
    dataset = datasets.load_dataset(dataset_name, split=split)
    dataset = dataset.cast_column("audio", datasets.Audio(sampling_rate=config.sample_rate))
    dataset.save_to_disk(str(resolved_output_dir / "hf_cache"))
    return {
        "dataset_name": dataset_name,
        "split": split,
        "output_dir": str(resolved_output_dir),
        "rows": len(dataset),
    }


def prepare_reference_dataset(husary_dir: str | Path | None = None) -> list[dict]:
    config = load_config()
    root = Path(husary_dir) if husary_dir is not None else config.husary_manifest_dir
    references: list[dict] = []
    if not root.exists():
        return references

    for surah_dir in sorted(root.iterdir()):
        if not surah_dir.is_dir():
            continue
        manifest_path = surah_dir / "manifest.json"
        if not manifest_path.exists():
            continue
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        surah = int(surah_dir.name)
        for ayah_key, clips in manifest.items():
            ayah = int(str(ayah_key).split(":")[1])
            for clip in clips:
                references.append(
                    {
                        "audio_path": clip["path"],
                        "surah": surah,
                        "ayah": ayah,
                        "word_index": clip["word_index"],
                        "word": clip.get("word"),
                        "start": clip.get("start"),
                        "end": clip.get("end"),
                        "is_correct": True,
                        "source": "husary",
                    }
                )
    return references


def create_tajweed_pairs(
    reference_data: list[dict],
    student_data: list[dict],
    output_path: str | Path | None = None,
) -> dict[str, str | int]:
    config = load_config()
    resolved_output_path = (
        Path(output_path)
        if output_path is not None
        else config.data_dir / "tajweed_pairs.json"
    )
    resolved_output_path.parent.mkdir(parents=True, exist_ok=True)

    reference_index = {
        f"{item['surah']}:{item['ayah']}:{item['word_index']}": item for item in reference_data
    }
    pairs: list[dict] = []
    for student in student_data:
        key = f"{student['surah']}:{student['ayah']}:{student['word_index']}"
        reference = reference_index.get(key)
        if reference is None:
            continue
        pairs.append(
            {
                "reference_path": reference["audio_path"],
                "student_path": student["audio_path"],
                "word": reference.get("word"),
                "surah": student["surah"],
                "ayah": student["ayah"],
                "word_index": student["word_index"],
                "label": student.get("label", "unknown"),
            }
        )

    resolved_output_path.write_text(
        json.dumps(pairs, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return {"output_path": str(resolved_output_path), "pairs": len(pairs)}
