from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np

APP_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = APP_ROOT / "src"
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from tajweed_ml.audio import load_audio
from tajweed_ml.config import load_config
from tajweed_ml.optional import require_dependency
from tajweed_ml.vendor_runtime import load_muaalem_vendor


@dataclass
class TajweedError:
    word_index: int
    expected_phoneme: str
    predicted_phoneme: str
    error_type: str
    rule: str
    description_en: str
    description_ar: str
    severity: str
    confidence: float


def _severity_for_error(error_type: str) -> str:
    if error_type in {"makhraj", "tafkheem", "missing"}:
        return "high"
    if error_type in {"madd", "ghunnah", "qalqalah", "vowel"}:
        return "medium"
    return "low"


def _rule_name_parts(rule: object | None) -> tuple[str, str]:
    if rule is None:
        return "", ""
    name = getattr(rule, "name", None)
    if name is None:
        return "", ""
    return str(getattr(name, "en", "") or ""), str(getattr(name, "ar", "") or "")


def _map_tajweed_rule(rule_name_en: str) -> tuple[str, str]:
    lowered = rule_name_en.lower()
    if "madd" in lowered:
        return "madd", "madd"
    if "ghonn" in lowered or "ghunn" in lowered:
        return "ghunnah", "ghunnah"
    if "qalqalah" in lowered:
        return "qalqalah", "qalqalah"
    return "tajweed", lowered.replace(" ", "_") or "tajweed"


TAFKHEEM_ERRORS = {
    ("s", "sˤ"): "ص sounds like س - raise the back of your tongue for tafkheem",
    ("t", "tˤ"): "ط sounds like ت - press tongue firmly with emphasis",
    ("d", "dˤ"): "ض sounds like د - use the side of your tongue with emphasis",
    ("ð", "ðˤ"): "ظ sounds like ذ - add emphasis with tongue retraction",
    ("sˤ", "s"): "س sounds too heavy - lighten, no tongue retraction",
    ("tˤ", "t"): "ت sounds too heavy - pronounce lightly",
    ("dˤ", "d"): "د sounds too heavy - pronounce lightly",
    ("ðˤ", "ð"): "ذ sounds too heavy - pronounce lightly",
}

MAKHRAJ_ERRORS = {
    ("ʔ", "ʕ"): "ع sounds like hamza - use the middle of the throat, not the glottis",
    ("ʕ", "ʔ"): "Hamza sounds like ع - sharp glottal stop, not pharyngeal",
    ("h", "ħ"): "ح sounds like ه - use the middle of the throat",
    ("ħ", "h"): "ه sounds like ح - lighter, from the glottis",
    ("x", "ɣ"): "غ sounds like خ - add voicing",
    ("ɣ", "x"): "خ sounds like غ - remove voicing",
    ("k", "q"): "ق sounds like ك - press the very back of the tongue against the uvula",
    ("q", "k"): "ك sounds like ق - bring the contact point forward",
    ("s", "θ"): "ث sounds like س - put tongue tip between the teeth",
    ("θ", "s"): "س sounds like ث - keep tongue behind the teeth",
    ("z", "ð"): "ذ sounds like ز - put tongue tip between the teeth",
    ("ð", "z"): "ز sounds like ذ - keep tongue behind the teeth",
    ("dʒ", "ʃ"): "ش sounds like ج - remove the stop component",
    ("ʃ", "dʒ"): "ج sounds like ش - add the stop before the fricative",
}

VOWEL_ERRORS = {
    ("a", "i"): "Kasra read as fatha - lower your jaw less",
    ("a", "u"): "Damma read as fatha - round your lips",
    ("i", "a"): "Fatha read as kasra - open your mouth more",
    ("i", "u"): "Damma read as kasra - round your lips",
    ("u", "a"): "Fatha read as damma - unround your lips, open more",
    ("u", "i"): "Kasra read as damma - spread your lips, unround",
    ("aː", "a"): "Madd not elongated - hold the alif for 2 counts",
    ("iː", "i"): "Madd not elongated - hold the yaa for 2 counts",
    ("uː", "u"): "Madd not elongated - hold the waaw for 2 counts",
    ("a", "aː"): "Short vowel where madd expected - elongate",
    ("i", "iː"): "Short vowel where madd expected - elongate",
    ("u", "uː"): "Short vowel where madd expected - elongate",
}


def classify_phoneme_error(predicted: str, expected: str) -> tuple[str, str, str]:
    pair = (predicted, expected)
    if pair in TAFKHEEM_ERRORS:
        return "tafkheem", "tafkheem/tarqeeq", TAFKHEEM_ERRORS[pair]
    if pair in MAKHRAJ_ERRORS:
        return "makhraj", "makhraj", MAKHRAJ_ERRORS[pair]
    if pair in VOWEL_ERRORS:
        description = VOWEL_ERRORS[pair]
        if "madd" in description.lower() or "elongat" in description.lower():
            return "madd", "madd", description
        return "vowel", "harakat", description
    return "pronunciation", "general", f"Expected [{expected}], heard [{predicted}]"


class MuaalemChecker:
    def __init__(self, model_name: str = "obadx/muaalem-model-v3_2", device: str = "cpu"):
        torch = require_dependency("torch")
        config = load_config()
        vendor = load_muaalem_vendor(config)

        self.config = config
        self.device = "cuda" if device == "cuda" and torch.cuda.is_available() else "cpu"
        self.model_name = model_name
        self.Aya = vendor["Aya"]
        self.chunck_phonemes = vendor["chunck_phonemes"]
        self.explain_error = vendor["explain_error"]
        self.quran_phonetizer = vendor["quran_phonetizer"]
        self.moshaf = vendor["MoshafAttributes"](
            rewaya="hafs",
            madd_monfasel_len=4,
            madd_mottasel_len=4,
            madd_mottasel_waqf=4,
            madd_aared_len=4,
        )
        dtype = torch.bfloat16 if self.device == "cuda" else torch.float32
        self.runtime = vendor["Muaalem"](
            model_name_or_path=str(config.muaalem_model_dir) if config.muaalem_model_dir.exists() else model_name,
            device=self.device,
            dtype=dtype,
        )
        self.processor = self.runtime.processor
        self.model = self.runtime.model
        self.vocab = self.runtime.multi_level_tokenizer.id_to_vocab["phonemes"]
        self.id_to_token = {index: token for index, token in self.vocab.items()}

    def report(self) -> dict[str, object]:
        return {
            "model_name": self.model_name,
            "device": self.device,
            "vocab_size": len(self.vocab),
            "muaalem_cache_dir": str(self.config.muaalem_model_dir),
            "quran_muaalem_repo_dir": str(self.config.quran_muaalem_repo_dir),
            "quran_transcript_repo_dir": str(self.config.quran_transcript_repo_dir),
        }

    def _reference_text(self, words: list[str], surah: int | None = None, ayah: int | None = None) -> str:
        if len(words) == 1:
            return words[0]
        if surah is not None and ayah is not None:
            try:
                return str(self.Aya(surah, ayah).get().uthmani)
            except Exception:
                pass
        return " ".join(words)

    def _reference_script(
        self,
        words: list[str],
        *,
        surah: int | None = None,
        ayah: int | None = None,
    ):
        reference_text = self._reference_text(words, surah=surah, ayah=ayah)
        return reference_text, self.quran_phonetizer(reference_text, self.moshaf, remove_spaces=True)

    def _tokenizer_fallback(self, words: list[str]) -> list[str]:
        tokenizer = getattr(getattr(self, "processor", None), "tokenizer", None)
        if tokenizer is None:
            return []
        expected: list[str] = []
        for word in words:
            expected.extend(tokenizer.tokenize(word))
        return expected

    @staticmethod
    def _char_to_word_index(reference_text: str) -> list[int]:
        mapping: list[int] = []
        current = 0
        in_word = False
        for char in reference_text:
            if char.isspace():
                mapping.append(-1)
                in_word = False
                continue
            if not in_word:
                in_word = True
                word_index = current
                current += 1
            mapping.append(word_index)
        return mapping

    def _word_index_for_char_span(self, reference_text: str, span: tuple[int, int]) -> int:
        char_to_word = self._char_to_word_index(reference_text)
        start, end = span
        for index in range(max(0, start), min(len(char_to_word), max(start + 1, end))):
            if char_to_word[index] >= 0:
                return char_to_word[index]
        for index in range(min(start, len(char_to_word) - 1), -1, -1):
            if char_to_word[index] >= 0:
                return char_to_word[index]
        return 0

    def predict_phonemes(
        self,
        audio: np.ndarray,
        expected_words: list[str],
        *,
        sr: int = 16_000,
        surah: int | None = None,
        ayah: int | None = None,
    ) -> list[str]:
        audio_array = np.asarray(audio, dtype=np.float32).reshape(-1)
        _, reference_script = self._reference_script(expected_words, surah=surah, ayah=ayah)
        output = self.runtime([audio_array], [reference_script], sampling_rate=sr)[0]
        return self.chunck_phonemes(output.phonemes.text)

    def get_expected_phonemes(
        self,
        words: list[str],
        *,
        surah: int | None = None,
        ayah: int | None = None,
    ) -> list[str]:
        if not hasattr(self, "quran_phonetizer") or not hasattr(self, "chunck_phonemes"):
            return self._tokenizer_fallback(words)
        try:
            _, reference_script = self._reference_script(words, surah=surah, ayah=ayah)
        except Exception:
            return self._tokenizer_fallback(words)
        return self.chunck_phonemes(reference_script.phonemes)

    def align_and_compare(self, predicted: list[str], expected: list[str]) -> list[dict[str, object]]:
        n, m = len(predicted), len(expected)
        dp = [[0] * (m + 1) for _ in range(n + 1)]
        for i in range(n + 1):
            dp[i][0] = i
        for j in range(m + 1):
            dp[0][j] = j

        for i in range(1, n + 1):
            for j in range(1, m + 1):
                if predicted[i - 1] == expected[j - 1]:
                    dp[i][j] = dp[i - 1][j - 1]
                else:
                    dp[i][j] = 1 + min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])

        alignment: list[tuple[str, str | None, str | None, int]] = []
        i, j = n, m
        while i > 0 or j > 0:
            if i > 0 and j > 0 and predicted[i - 1] == expected[j - 1]:
                alignment.append(("match", predicted[i - 1], expected[j - 1], j - 1))
                i -= 1
                j -= 1
            elif i > 0 and j > 0 and dp[i][j] == dp[i - 1][j - 1] + 1:
                alignment.append(("sub", predicted[i - 1], expected[j - 1], j - 1))
                i -= 1
                j -= 1
            elif i > 0 and dp[i][j] == dp[i - 1][j] + 1:
                alignment.append(("ins", predicted[i - 1], None, j))
                i -= 1
            else:
                alignment.append(("del", None, expected[j - 1], j - 1))
                j -= 1

        alignment.reverse()
        errors: list[dict[str, object]] = []
        for operation, predicted_phoneme, expected_phoneme, position in alignment:
            if operation == "match":
                continue
            if operation == "sub":
                error_type, rule, description = classify_phoneme_error(
                    str(predicted_phoneme),
                    str(expected_phoneme),
                )
                severity = "high" if error_type in ("makhraj", "tafkheem") else "medium"
            elif operation == "del":
                error_type, rule, description = "missing", "missing_sound", f"Sound [{expected_phoneme}] was skipped"
                severity = "high"
            else:
                error_type, rule, description = "extra", "extra_sound", f"Extra sound [{predicted_phoneme}] added"
                severity = "medium"

            errors.append(
                {
                    "position": position,
                    "predicted": predicted_phoneme or "(skipped)",
                    "expected": expected_phoneme or "(none)",
                    "error_type": error_type,
                    "rule": rule,
                    "description": description,
                    "severity": severity,
                }
            )
        return errors

    def check(
        self,
        audio: np.ndarray,
        expected_words: list[str],
        sr: int = 16_000,
        *,
        surah: int | None = None,
        ayah: int | None = None,
    ) -> list[TajweedError]:
        audio_array = np.asarray(audio, dtype=np.float32).reshape(-1)
        reference_text, reference_script = self._reference_script(
            expected_words,
            surah=surah,
            ayah=ayah,
        )
        output = self.runtime([audio_array], [reference_script], sampling_rate=sr)[0]
        predicted_text = output.phonemes.text
        explained_errors = self.explain_error(
            reference_text,
            reference_script.phonemes,
            predicted_text,
            reference_script.mappings,
        )
        fallback_errors = self.align_and_compare(
            self.chunck_phonemes(predicted_text),
            self.chunck_phonemes(reference_script.phonemes),
        )

        results: list[TajweedError] = []
        for index, error in enumerate(explained_errors):
            rule_obj = None
            for attribute in (
                "missing_tajweed_rules",
                "replaced_tajweed_rules",
                "ref_tajweed_rules",
                "inserted_tajweed_rules",
            ):
                candidates = getattr(error, attribute, None) or []
                if candidates:
                    rule_obj = candidates[0]
                    break
            rule_name_en, rule_name_ar = _rule_name_parts(rule_obj)
            if error.error_type == "tajweed" and rule_name_en:
                error_type, rule = _map_tajweed_rule(rule_name_en)
                if getattr(error, "expected_len", None) is not None and getattr(error, "predicted_len", None) is not None:
                    description_en = (
                        f"{rule_name_en}: expected {error.expected_len}, heard {error.predicted_len}"
                    )
                else:
                    description_en = f"{rule_name_en} mismatch"
                description_ar = rule_name_ar
            else:
                fallback = fallback_errors[index] if index < len(fallback_errors) else None
                fallback_pred = str(getattr(error, "preditected_ph", "") or "")
                fallback_exp = str(getattr(error, "expected_ph", "") or "")
                error_type, rule, description_en = classify_phoneme_error(fallback_pred, fallback_exp)
                if fallback is not None:
                    description_en = str(fallback["description"])
                description_ar = ""

            results.append(
                TajweedError(
                    word_index=self._word_index_for_char_span(reference_text, error.uthmani_pos),
                    expected_phoneme=str(getattr(error, "expected_ph", "") or "(none)"),
                    predicted_phoneme=str(getattr(error, "preditected_ph", "") or "(skipped)"),
                    error_type=error_type,
                    rule=rule,
                    description_en=description_en,
                    description_ar=description_ar,
                    severity=_severity_for_error(error_type),
                    confidence=0.95,
                )
            )
        return results

    def check_file(self, audio_path: str | Path, expected_words: list[str]) -> list[TajweedError]:
        waveform, sample_rate = load_audio(audio_path)
        return self.check(waveform.squeeze(0).cpu().numpy(), expected_words, sr=sample_rate)
