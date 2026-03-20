from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from .audio import load_audio, slice_audio
from .config import load_config
from .dataset_downloads import load_word_audio_index
from .quran_text import load_quran_text
from .schemas import CheckResult, RuleAnnotation, RuleKind, TajweedCheckResult
from .segmenter import segmenter_status
from .sifaat_checker import check_ghunnah, check_madd, check_qalqalah_burst


def _result_from_payload(rule: RuleKind, payload: dict[str, object], detail_key: str = "detail") -> TajweedCheckResult:
    raw_result = str(payload.get("result", payload.get("status", "uncertain"))).lower()
    if raw_result == "correct":
        result = CheckResult.CORRECT
    elif raw_result == "error":
        result = CheckResult.ERROR
    else:
        result = CheckResult.UNCERTAIN
    student_value = payload.get("student_duration_ms")
    if student_value is None:
        student_value = payload.get("student_nasal_ratio")
    expected_value = payload.get("reference_duration_ms")
    if expected_value is None:
        expected_value = payload.get("reference_nasal_ratio")
    return TajweedCheckResult(
        rule=rule,
        result=result,
        confidence=float(payload.get("confidence", 0.0) or 0.0),
        student_value=student_value,
        expected_value=expected_value,
        detail=str(payload.get(detail_key, "")),
    )


class AppChecker:
    def __init__(self, device: str | None = None):
        from server.muaalem_checker import MuaalemChecker

        self.config = load_config()
        self.device = device or self.config.default_device
        self.muaalem = MuaalemChecker(
            model_name=self.config.muaalem_model_name,
            device=self.device,
        )
        self.quran_data = load_quran_text()
        self.word_audio_index = load_word_audio_index(self.config.buraaq_word_index_path)

    def doctor_report(self) -> dict[str, object]:
        return {
            "device": self.device,
            "config": self.config.as_dict(),
            "muaalem": self.muaalem.report(),
            "segmenter": segmenter_status(self.device),
            "muaalem_cached": self.config.muaalem_model_dir.exists(),
            "segmenter_cached": self.config.segmenter_model_dir.exists(),
            "buraaq_word_index_exists": self.config.buraaq_word_index_path.exists(),
            "served_word_audio_dir_exists": self.config.served_word_audio_dir.exists(),
            "quran_muaalem_repo_exists": self.config.quran_muaalem_repo_dir.exists(),
            "quran_transcript_repo_exists": self.config.quran_transcript_repo_dir.exists(),
        }

    def _load_reference_audio(
        self,
        *,
        surah: int | None,
        ayah: int | None,
        word_index: int,
        sample_rate: int,
    ):
        if surah is None or ayah is None:
            return None
        key = f"{surah}:{ayah}:{word_index}"
        indexed = self.word_audio_index.get(key)
        if indexed is not None:
            path = Path(str(indexed.get("audio_path", "")))
            if path.exists():
                waveform, _ = load_audio(path, target_sample_rate=sample_rate)
                return waveform

        manifest_path = self.config.husary_word_audio_dir / str(surah) / "manifest.json"
        if not manifest_path.exists():
            return None
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        for clip in manifest.get(f"{surah}:{ayah}", []):
            if int(clip.get("word_index", -1)) != word_index:
                continue
            clip_path = Path(str(clip.get("path", "")))
            if not clip_path.exists():
                return None
            waveform, _ = load_audio(clip_path, target_sample_rate=sample_rate)
            return waveform
        return None

    def _expected_words(self, surah: int | None, ayah: int | None) -> list[str]:
        if surah is None or ayah is None:
            return []
        return self.quran_data.get(f"{surah}:{ayah}", [])

    def compare_word(
        self,
        student_audio_path: str,
        *,
        surah: int,
        ayah: int,
        word_index: int,
        start_sec: float | None = None,
        end_sec: float | None = None,
    ) -> dict[str, object]:
        waveform, sample_rate = load_audio(student_audio_path)
        waveform = slice_audio(waveform, sample_rate, start_sec, end_sec)
        words = self._expected_words(surah, ayah)
        if word_index >= len(words):
            raise ValueError(f"No word {word_index} for {surah}:{ayah}")
        errors = self.muaalem.check(
            waveform.squeeze(0).cpu().numpy(),
            [words[word_index]],
            sr=sample_rate,
            surah=surah,
            ayah=ayah,
        )
        return {
            "student_audio_path": str(Path(student_audio_path).resolve()),
            "surah": surah,
            "ayah": ayah,
            "word_index": word_index,
            "expected_word": words[word_index],
            "errors": [error.__dict__ for error in errors],
            "is_correct": len(errors) == 0,
        }

    def check_rule(
        self,
        audio_path: str,
        rule: RuleAnnotation,
        *,
        surah: int | None = None,
        ayah: int | None = None,
        word_index: int = 0,
        start_sec: float | None = None,
        end_sec: float | None = None,
    ) -> TajweedCheckResult:
        waveform, sample_rate = load_audio(audio_path)
        waveform = slice_audio(waveform, sample_rate, start_sec, end_sec)
        student_audio = waveform.squeeze(0).cpu().numpy()
        reference_waveform = self._load_reference_audio(
            surah=surah,
            ayah=ayah,
            word_index=word_index,
            sample_rate=sample_rate,
        )
        reference_audio = (
            reference_waveform.squeeze(0).cpu().numpy()
            if reference_waveform is not None
            else student_audio
        )

        if rule.rule == RuleKind.MADD:
            return _result_from_payload(rule.rule, check_madd(student_audio, reference_audio, sample_rate))
        if rule.rule == RuleKind.GHUNNAH:
            return _result_from_payload(rule.rule, check_ghunnah(student_audio, reference_audio, sample_rate))
        if rule.rule == RuleKind.QALQALAH:
            payload = check_qalqalah_burst(student_audio, sample_rate)
            return _result_from_payload(rule.rule, {"result": payload["status"], **payload})

        expected_words = self._expected_words(surah, ayah)
        if not expected_words:
            return TajweedCheckResult(
                rule=rule.rule,
                result=CheckResult.UNCERTAIN,
                confidence=0.0,
                detail="Expected Quran text not available for this segment",
            )

        errors = self.muaalem.check(
            student_audio,
            expected_words,
            sr=sample_rate,
            surah=surah,
            ayah=ayah,
        )
        if rule.rule in {RuleKind.TAFKHEEM, RuleKind.TARQEEQ}:
            target_error_type = "tafkheem"
        elif rule.rule == RuleKind.MAKHRAJ:
            target_error_type = "makhraj"
        else:
            target_error_type = None

        if target_error_type is None:
            return TajweedCheckResult(
                rule=rule.rule,
                result=CheckResult.UNCERTAIN,
                confidence=0.0,
                detail="Rule not wired to the Muaalem runtime",
            )

        for error in errors:
            if error.error_type != target_error_type:
                continue
            return TajweedCheckResult(
                rule=rule.rule,
                result=CheckResult.ERROR,
                confidence=error.confidence,
                student_value=error.predicted_phoneme,
                expected_value=error.expected_phoneme,
                word_index=error.word_index,
                letter_index=rule.letter_index,
                letter=rule.letter,
                description_ar=rule.description_ar,
                description_en=rule.description_en or error.description_en,
                detail=error.description_en,
            )

        return TajweedCheckResult(
            rule=rule.rule,
            result=CheckResult.CORRECT,
            confidence=0.95,
            word_index=word_index,
            letter_index=rule.letter_index,
            letter=rule.letter,
            description_ar=rule.description_ar,
            description_en=rule.description_en,
            detail="No matching tajweed error detected by the Muaalem model",
        )


@lru_cache(maxsize=1)
def load_checker() -> AppChecker:
    return AppChecker()


MLTajweedChecker = AppChecker

__all__ = ["AppChecker", "MLTajweedChecker", "check_madd", "check_ghunnah", "load_checker"]
