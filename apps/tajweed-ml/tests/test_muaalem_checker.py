from __future__ import annotations

from server.muaalem_checker import MuaalemChecker, classify_phoneme_error


def test_classify_phoneme_error_detects_tafkheem_pair() -> None:
    error_type, rule, description = classify_phoneme_error("s", "sˤ")
    assert error_type == "tafkheem"
    assert rule == "tafkheem/tarqeeq"
    assert "ص sounds like س" in description


def test_align_and_compare_marks_substitution() -> None:
    checker = MuaalemChecker.__new__(MuaalemChecker)
    errors = checker.align_and_compare(["s"], ["sˤ"])
    assert len(errors) == 1
    assert errors[0]["error_type"] == "tafkheem"


def test_get_expected_phonemes_falls_back_to_tokenizer() -> None:
    checker = MuaalemChecker.__new__(MuaalemChecker)
    checker._phonemizer = None

    class _Tokenizer:
        @staticmethod
        def tokenize(word: str):
            return [f"tok:{word}"]

    class _Processor:
        tokenizer = _Tokenizer()

    checker.processor = _Processor()
    phonemes = checker.get_expected_phonemes(["بِسْمِ", "ٱللَّهِ"])
    assert phonemes == ["tok:بِسْمِ", "tok:ٱللَّهِ"]
