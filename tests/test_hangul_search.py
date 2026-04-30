from backend.core.hangul_search import build_search_text, build_trigram_search_text, get_choseong, make_search_snippet
from backend.core.normalizer import normalize_key, normalize_value, values_equal


def test_get_choseong_extracts_hangul_initials_without_latin_noise():
    assert get_choseong("주간 회의록 ABC ㄱ") == "ㅈㄱㅎㅇㄹㄱ"


def test_build_search_text_keeps_bounded_two_character_helpers_without_choseong_tokens():
    text = build_search_text("주간 회의록 작성")
    tokens = set(text.split())

    assert "주간" in tokens
    assert "회의록" in tokens
    assert "회의" in tokens
    assert "의록" in tokens
    assert "ㅎㅇㄹ" not in tokens


def test_trigram_text_stays_compact_original_text_only():
    assert build_trigram_search_text("  프로젝트   상태 보고서  ") == "프로젝트 상태 보고서"


def test_snippet_can_highlight_choseong_query_without_promising_search_recall():
    snippet = make_search_snippet("주간 회의록 작성 후 공유", "ㅎㅇㄹ")

    assert "**회의록**" in snippet


def test_normalizer_keeps_exact_text_semantics_and_numeric_equivalence():
    assert normalize_key("  _Report  Final._ ") == "report final"
    assert normalize_value("  A\n\tB  ") == "A B"
    assert values_equal("1,000", "1000.0") is True
    assert values_equal("보고서", "보고 서") is False
