from backend.core.ppt_analysis import _coerce_position


def test_coerce_position_accepts_float_like_string():
    assert _coerce_position("3520440.0") == 3520440


def test_coerce_position_falls_back_for_invalid_value():
    assert _coerce_position("not-a-number") == 0
