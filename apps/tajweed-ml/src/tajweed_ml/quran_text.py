from __future__ import annotations

import re
from pathlib import Path


AL_FATIHA_AYAHS = {
    1: "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ",
    2: "الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ",
    3: "الرَّحْمَٰنِ الرَّحِيمِ",
    4: "مَالِكِ يَوْمِ الدِّينِ",
    5: "إِيَّاكَ نَعْبُدُ وَإِيَّاكَ نَسْتَعِينُ",
    6: "اهْدِنَا الصِّرَاطَ الْمُسْتَقِيمَ",
    7: "صِرَاطَ الَّذِينَ أَنْعَمْتَ عَلَيْهِمْ غَيْرِ الْمَغْضُوبِ عَلَيْهِمْ وَلَا الضَّالِّينَ",
}

ARABIC_DIACRITICS_PATTERN = re.compile(r"[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]")
NON_ARABIC_PATTERN = re.compile(r"[^\u0621-\u063a\u0641-\u064a\s]")
WHITESPACE_PATTERN = re.compile(r"\s+")
ARABIC_LETTER_PATTERN = re.compile(r"[\u0621-\u063a\u0641-\u064a]")
LONG_VOWELS = {"ا", "و", "ي", "ى"}
APP_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_TANZIL_PATH = APP_ROOT / "data" / "quran-simple-enhanced.txt"


def normalize_arabic_text(text: str) -> str:
    normalized = ARABIC_DIACRITICS_PATTERN.sub("", text or "")
    normalized = (
        normalized.replace("ٱ", "ا")
        .replace("إ", "ا")
        .replace("أ", "ا")
        .replace("آ", "ا")
        .replace("ى", "ي")
        .replace("ة", "ه")
        .replace("ؤ", "و")
        .replace("ئ", "ي")
    )
    normalized = NON_ARABIC_PATTERN.sub(" ", normalized)
    normalized = WHITESPACE_PATTERN.sub(" ", normalized).strip()
    return normalized


def split_expected_words(text: str) -> list[str]:
    compact = WHITESPACE_PATTERN.sub(" ", (text or "")).strip()
    if not compact:
        return []
    return compact.split()


def load_quran_text(tanzil_path: str | Path | None = None) -> dict[str, list[str]]:
    resolved_path = Path(tanzil_path) if tanzil_path is not None else DEFAULT_TANZIL_PATH
    quran: dict[str, list[str]] = {
        f"1:{ayah}": split_expected_words(text)
        for ayah, text in AL_FATIHA_AYAHS.items()
    }
    if not resolved_path.exists():
        return quran

    for line in resolved_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        parts = stripped.split("|", maxsplit=2)
        if len(parts) < 3:
            continue
        surah, ayah, text = int(parts[0]), int(parts[1]), parts[2]
        words = split_expected_words(text)
        if words:
            quran[f"{surah}:{ayah}"] = words
    return quran


def extract_arabic_letters(word: str) -> list[str]:
    cleaned_word = normalize_arabic_text(word).replace(" ", "")
    return ARABIC_LETTER_PATTERN.findall(cleaned_word)


def letter_weight(letter: str) -> float:
    if letter in LONG_VOWELS:
        return 1.35
    if letter in {"ع", "ح", "غ", "خ"}:
        return 1.15
    return 1.0


def proportional_edges(weights: list[float], total_duration_sec: float) -> list[tuple[float, float]]:
    if not weights:
        return []
    weight_sum = max(sum(weights), 1e-6)
    boundaries = [0.0]
    running = 0.0
    for weight in weights:
        running += weight / weight_sum
        boundaries.append(total_duration_sec * running)
    return list(zip(boundaries[:-1], boundaries[1:]))
