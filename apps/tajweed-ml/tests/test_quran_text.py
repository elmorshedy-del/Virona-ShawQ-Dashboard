from tajweed_ml.quran_text import extract_arabic_letters, normalize_arabic_text, proportional_edges


def test_normalize_arabic_text_removes_diacritics_and_normalizes_alef() -> None:
    assert normalize_arabic_text("ٱلرَّحْمَٰنِ") == "الرحمن"


def test_extract_arabic_letters_uses_normalized_word() -> None:
    assert extract_arabic_letters("صِرَاط") == ["ص", "ر", "ا", "ط"]


def test_proportional_edges_cover_total_duration() -> None:
    edges = proportional_edges([1.0, 2.0, 1.0], 4.0)

    assert edges[0] == (0.0, 1.0)
    assert edges[-1] == (3.0, 4.0)
