from app.limit import allow


def test_request_window_blocks_the_next_call_and_resets() -> None:
    key = "unit-limit"
    assert allow(key, 2, now=10.0) is True
    assert allow(key, 2, now=11.0) is True
    assert allow(key, 2, now=12.0) is False
    assert allow(key, 2, now=71.0) is True
