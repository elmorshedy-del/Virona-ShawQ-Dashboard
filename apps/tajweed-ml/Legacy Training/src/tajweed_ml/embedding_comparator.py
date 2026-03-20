from __future__ import annotations

import json
from pathlib import Path
from typing import Callable, Mapping

import numpy as np

from .config import DEFAULT_EMBEDDING_DISTANCE_THRESHOLD, load_config
from .dataset_downloads import load_word_audio_index
from .feature_extractor import extract_embedding
from .optional import MissingDependencyError, require_dependency

CPU_REFERENCE_EMBEDDING_CAP = 512


def _key(surah: int, ayah: int, word_index: int) -> str:
    return f"{surah}:{ayah}:{word_index}"


def _to_numpy(vector) -> np.ndarray:
    if hasattr(vector, "detach"):
        return np.asarray(vector.detach().cpu().numpy(), dtype=np.float32)
    return np.asarray(vector, dtype=np.float32)


def _cosine_similarity(left, right) -> float:
    left_vector = _to_numpy(left)
    right_vector = _to_numpy(right)
    denominator = np.linalg.norm(left_vector) * np.linalg.norm(right_vector)
    if denominator == 0:
        return 0.0
    return float(np.dot(left_vector, right_vector) / denominator)


class EmbeddingComparator:
    def __init__(
        self,
        reference_embeddings_path: str | Path | None = None,
        *,
        threshold: float = DEFAULT_EMBEDDING_DISTANCE_THRESHOLD,
        embedding_extractor: Callable[..., object] | None = None,
        references: Mapping[str, object] | None = None,
    ):
        config = load_config()
        self.reference_embeddings_path = (
            Path(reference_embeddings_path)
            if reference_embeddings_path is not None
            else config.reference_embeddings_path
        )
        self.threshold = threshold
        self.embedding_extractor = embedding_extractor or extract_embedding
        self.references = dict(references) if references is not None else self._load_references()

    def _load_references(self) -> dict[str, object]:
        if not self.reference_embeddings_path.exists():
            return {}
        try:
            torch = require_dependency("torch")
        except MissingDependencyError:
            return {}
        payload = torch.load(self.reference_embeddings_path, map_location="cpu")
        return dict(payload)

    def compare(
        self,
        student_audio_path: str,
        surah: int,
        ayah: int,
        word_index: int,
        start_sec: float | None = None,
        end_sec: float | None = None,
    ) -> dict[str, float | bool]:
        key = _key(surah, ayah, word_index)
        reference = self.references.get(key)
        if reference is None:
            return {
                "distance": 0.0,
                "similarity": 1.0,
                "is_suspicious": False,
                "threshold": self.threshold,
                "reference_key": key,
            }
        student_embedding = self.embedding_extractor(
            student_audio_path,
            start_sec=start_sec,
            end_sec=end_sec,
        )
        similarity = _cosine_similarity(reference, student_embedding)
        distance = 1.0 - similarity
        return {
            "distance": distance,
            "similarity": similarity,
            "is_suspicious": distance > self.threshold,
            "threshold": self.threshold,
            "reference_key": key,
        }


def build_reference_embeddings(
    husary_manifest_dir: str | Path | None = None,
    output_path: str | Path | None = None,
    buraaq_dir: str | Path | None = None,
) -> dict[str, str | int]:
    config = load_config()
    torch = require_dependency("torch")
    resolved_device = "cuda" if torch.cuda.is_available() else "cpu"
    manifest_root = Path(husary_manifest_dir) if husary_manifest_dir is not None else config.husary_manifest_dir
    resolved_output_path = Path(output_path) if output_path is not None else config.reference_embeddings_path
    resolved_buraaq_dir = Path(buraaq_dir) if buraaq_dir is not None else config.buraaq_dataset_dir
    resolved_output_path.parent.mkdir(parents=True, exist_ok=True)

    embeddings: dict[str, object] = {}
    if buraaq_dir is not None and not resolved_buraaq_dir.exists():
        raise FileNotFoundError(f"Buraaq dataset directory not found: {resolved_buraaq_dir}")

    if resolved_buraaq_dir.exists():
        index = load_word_audio_index(resolved_buraaq_dir / "word_index.json")
        for key, payload in sorted(index.items()):
            audio_path = Path(str(payload.get("audio_path", "")))
            if not audio_path.exists():
                continue
            embeddings[str(key)] = extract_embedding(audio_path)
            if resolved_device == "cpu" and len(embeddings) >= CPU_REFERENCE_EMBEDDING_CAP:
                break

    if not embeddings and buraaq_dir is None and manifest_root.exists():
        for surah_dir in sorted(manifest_root.iterdir()):
            if not surah_dir.is_dir():
                continue
            manifest_path = surah_dir / "manifest.json"
            if not manifest_path.exists():
                continue
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            for ayah_key, clips in manifest.items():
                surah, ayah = [int(part) for part in str(ayah_key).split(":")]
                for clip in clips:
                    clip_path = Path(clip["path"])
                    if not clip_path.exists():
                        continue
                    embeddings[_key(surah, ayah, clip["word_index"])] = extract_embedding(clip_path)
                    if resolved_device == "cpu" and len(embeddings) >= CPU_REFERENCE_EMBEDDING_CAP:
                        break
                if resolved_device == "cpu" and len(embeddings) >= CPU_REFERENCE_EMBEDDING_CAP:
                    break
            if resolved_device == "cpu" and len(embeddings) >= CPU_REFERENCE_EMBEDDING_CAP:
                break

    torch.save(embeddings, resolved_output_path)
    return {"output_path": str(resolved_output_path), "count": len(embeddings)}
