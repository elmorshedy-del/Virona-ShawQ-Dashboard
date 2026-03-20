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
    from transformers import AutoFeatureExtractor, AutoModelForAudioFrameClassification

    huggingface_hub.snapshot_download(
        repo_id=config.segmenter_model_name,
        local_dir=str(resolved_cache_dir),
        resume_download=True,
    )
    AutoFeatureExtractor.from_pretrained(str(resolved_cache_dir))
    AutoModelForAudioFrameClassification.from_pretrained(str(resolved_cache_dir))
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
        self._runtime = None
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
            "loaded": self._runtime is not None,
            "load_error": self._load_error,
        }

    def _build_runtime(self):
        torch = require_dependency("torch")
        require_dependency("protobuf", "protobuf")
        from recitations_segmenter import clean_speech_intervals, read_audio, segment_recitations
        from transformers import AutoFeatureExtractor, AutoModelForAudioFrameClassification

        source = self._model_source()
        processor = AutoFeatureExtractor.from_pretrained(source)
        model = AutoModelForAudioFrameClassification.from_pretrained(source)
        dtype = torch.bfloat16 if self.device == "cuda" and torch.cuda.is_available() else torch.float32
        device = torch.device(self.device)
        model.to(device, dtype=dtype)
        return {
            "device": device,
            "dtype": dtype,
            "processor": processor,
            "model": model,
            "read_audio": read_audio,
            "segment_recitations": segment_recitations,
            "clean_speech_intervals": clean_speech_intervals,
        }

    def _ensure_runtime(self):
        if self._runtime is not None:
            return self._runtime
        try:
            self._runtime = self._build_runtime()
        except Exception as exc:
            self._load_error = str(exc)
            raise SegmenterUnavailableError(f"Unable to load segmenter: {exc}") from exc
        return self._runtime

    def _extract_segments(self, audio_path: Path) -> tuple[list[tuple[float, float]], bool]:
        runtime = self._ensure_runtime()
        outputs = runtime["segment_recitations"](
            [runtime["read_audio"](str(audio_path))],
            runtime["model"],
            runtime["processor"],
            device=runtime["device"],
            dtype=runtime["dtype"],
            batch_size=1,
        )
        if not outputs:
            return [], False
        output = outputs[0]
        cleaned = runtime["clean_speech_intervals"](
            output.speech_intervals,
            output.is_complete,
            min_silence_duration_ms=30,
            min_speech_duration_ms=30,
            pad_duration_ms=30,
            return_seconds=True,
        )
        intervals = [
            (float(start), float(end))
            for start, end in getattr(cleaned, "clean_speech_intervals", []) or []
        ]
        return intervals, bool(getattr(cleaned, "is_complete", False))

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
        segments: list[dict[str, object]] = []
        intervals, is_complete = self._extract_segments(resolved_audio_path)
        exact_word_alignment = transcript_words is not None and len(transcript_words) == len(intervals)
        merged_text = " ".join(transcript_words or [])
        for index, (start_sec, end_sec) in enumerate(intervals):
            text = ""
            if transcript_words:
                if exact_word_alignment:
                    text = transcript_words[index]
                elif len(intervals) == 1:
                    text = merged_text
            segments.append(
                {
                    "index": index,
                    "text": _normalize_text(text),
                    "start_sec": start_sec,
                    "end_sec": end_sec,
                }
            )

        payload: dict[str, object] = {
            "audio_path": str(resolved_audio_path),
            "audio_duration_sec": round(duration_sec, 3),
            "model_name": self.model_name,
            "model_source": self._model_source(),
            "text": _normalize_text(merged_text),
            "segments": segments,
            "segment_count": len(segments),
            "segments_available": bool(segments),
            "is_complete": is_complete,
            "mode": "pause-segmentation",
            "chunk_length_s": chunk_length_s,
            "stride_length_s": stride_length_s,
        }
        if transcript_words is not None:
            payload["expected_words"] = transcript_words
            payload["expected_word_count"] = len(transcript_words)
            payload["exact_word_alignment"] = exact_word_alignment
        if not segments:
            payload["detail"] = "Segmenter returned no pause intervals"
        elif transcript_words is not None and not exact_word_alignment:
            payload["detail"] = "Pause intervals detected, but they do not map one-to-one to expected words"
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
