from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from .audio import load_audio
from .config import load_config
from .optional import require_dependency


class SegmenterUnavailableError(RuntimeError):
    """Raised when the recitation segmenter cannot be loaded or used."""


def _normalize_text(value: object | None) -> str:
    if value is None:
        return ""
    return " ".join(str(value).split())


def _chunk_timestamp(chunk: dict[str, object]) -> tuple[float | None, float | None]:
    timestamp = chunk.get("timestamp", chunk.get("timestamps"))
    if not isinstance(timestamp, (list, tuple)) or len(timestamp) < 2:
        return None, None
    start = None if timestamp[0] is None else float(timestamp[0])
    end = None if timestamp[1] is None else float(timestamp[1])
    return start, end


def download_segmenter_model(cache_dir: str | Path | None = None) -> dict[str, object]:
    config = load_config()
    resolved_cache_dir = Path(cache_dir) if cache_dir is not None else config.segmenter_model_dir
    resolved_cache_dir.mkdir(parents=True, exist_ok=True)

    huggingface_hub = require_dependency("huggingface_hub")
    from transformers import AutoModelForCTC, AutoProcessor

    huggingface_hub.snapshot_download(
        repo_id=config.segmenter_model_name,
        local_dir=str(resolved_cache_dir),
        resume_download=True,
    )
    AutoProcessor.from_pretrained(str(resolved_cache_dir), trust_remote_code=True)
    AutoModelForCTC.from_pretrained(str(resolved_cache_dir), trust_remote_code=True)
    return {
        "model_name": config.segmenter_model_name,
        "cache_dir": str(resolved_cache_dir.resolve()),
        "cached": True,
    }


class RecitationSegmenter:
    def __init__(self, model_name: str | None = None, device: str | None = None):
        torch = require_dependency("torch")

        self.config = load_config()
        self.model_name = model_name or self.config.segmenter_model_name
        self.device = "cuda" if device == "cuda" and torch.cuda.is_available() else "cpu"
        self._pipeline = None
        self._load_error: str | None = None

    def _model_source(self) -> str:
        if self.config.segmenter_model_dir.exists():
            return str(self.config.segmenter_model_dir)
        return self.model_name

    def report(self) -> dict[str, object]:
        return {
            "model_name": self.model_name,
            "device": self.device,
            "cached": self.config.segmenter_model_dir.exists(),
            "cache_dir": str(self.config.segmenter_model_dir),
            "loaded": self._pipeline is not None,
            "load_error": self._load_error,
        }

    def _build_pipeline(self):
        torch = require_dependency("torch")
        from transformers import AutoModelForCTC, AutoProcessor, pipeline

        source = self._model_source()
        processor = AutoProcessor.from_pretrained(source, trust_remote_code=True)
        model = AutoModelForCTC.from_pretrained(source, trust_remote_code=True)

        kwargs: dict[str, object] = {
            "task": "automatic-speech-recognition",
            "model": model,
            "device": 0 if self.device == "cuda" and torch.cuda.is_available() else -1,
        }
        tokenizer = getattr(processor, "tokenizer", None)
        feature_extractor = getattr(processor, "feature_extractor", None)
        if tokenizer is not None:
            kwargs["tokenizer"] = tokenizer
        if feature_extractor is not None:
            kwargs["feature_extractor"] = feature_extractor
        elif tokenizer is None:
            kwargs["tokenizer"] = processor
        return pipeline(**kwargs)

    def _ensure_pipeline(self):
        if self._pipeline is not None:
            return self._pipeline
        try:
            self._pipeline = self._build_pipeline()
        except Exception as exc:
            self._load_error = str(exc)
            raise SegmenterUnavailableError(f"Unable to load segmenter: {exc}") from exc
        return self._pipeline

    def segment_audio(
        self,
        audio_path: str | Path,
        *,
        transcript_words: list[str] | None = None,
        chunk_length_s: float = 15.0,
        stride_length_s: float = 2.0,
    ) -> dict[str, object]:
        resolved_audio_path = Path(audio_path).expanduser().resolve()
        if not resolved_audio_path.exists():
            raise FileNotFoundError(f"Audio file not found: {resolved_audio_path}")

        waveform, sample_rate = load_audio(resolved_audio_path)
        duration_sec = waveform.shape[-1] / max(1, sample_rate)

        asr_pipeline = self._ensure_pipeline()
        try:
            raw = asr_pipeline(
                str(resolved_audio_path),
                return_timestamps="word",
                chunk_length_s=chunk_length_s,
                stride_length_s=stride_length_s,
            )
        except TypeError:
            raw = asr_pipeline(str(resolved_audio_path))

        if not isinstance(raw, dict):
            raw = {"text": str(raw)}

        chunks = raw.get("chunks", [])
        segments: list[dict[str, object]] = []
        if isinstance(chunks, list):
            for index, chunk in enumerate(chunks):
                if not isinstance(chunk, dict):
                    continue
                start_sec, end_sec = _chunk_timestamp(chunk)
                segments.append(
                    {
                        "index": index,
                        "text": _normalize_text(chunk.get("text")),
                        "start_sec": start_sec,
                        "end_sec": end_sec,
                    }
                )

        payload: dict[str, object] = {
            "audio_path": str(resolved_audio_path),
            "audio_duration_sec": round(duration_sec, 3),
            "model_name": self.model_name,
            "model_source": self._model_source(),
            "text": _normalize_text(raw.get("text")),
            "segments": segments,
            "segment_count": len(segments),
            "segments_available": bool(segments),
        }
        if transcript_words is not None:
            payload["expected_words"] = transcript_words
            payload["expected_word_count"] = len(transcript_words)
        if not segments:
            payload["detail"] = "Segmenter returned transcript output without word timestamps"
        return payload


@lru_cache(maxsize=4)
def load_segmenter(device: str | None = None) -> RecitationSegmenter:
    return RecitationSegmenter(device=device)


def segmenter_status(device: str | None = None) -> dict[str, object]:
    return load_segmenter(device=device).report()


__all__ = [
    "RecitationSegmenter",
    "SegmenterUnavailableError",
    "download_segmenter_model",
    "load_segmenter",
    "segmenter_status",
]
