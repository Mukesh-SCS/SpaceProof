import pytest
from fastapi.testclient import TestClient

from app.auth import token_matches
from app.images import ImageRejected, read_capped, reject_pixel_size
from app.main import app, get_completer
from app.nebius import NebiusError, public_provider_error


class Boom:
    def complete(self, messages: list[dict[str, object]], max_tokens: int) -> str:
        raise NebiusError("The model request timed out.")


def test_token_compare_rejects_a_different_length() -> None:
    assert token_matches("short", "vision-test-token") is False
    assert token_matches("vision-test-token", "vision-test-token") is True


def test_health_stays_public_and_does_not_reveal_a_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VISION_SERVICE_TOKEN", "vision-test-token")
    response = TestClient(app).get("/health")
    assert response.status_code == 200
    assert "vision-test-token" not in response.text
    assert "NEBIUS_API_KEY" not in response.text


def test_anonymous_analyze_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VISION_SERVICE_TOKEN", "vision-test-token")
    response = TestClient(app).post(
        "/analyze-room",
        files={"image": ("room.jpg", b"\xff\xd8\xffnot-a-real-jpeg", "image/jpeg")},
    )
    assert response.status_code == 401
    assert response.json()["code"] == "UNAUTHORIZED"


def test_missing_service_token_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("VISION_SERVICE_TOKEN", raising=False)
    response = TestClient(app).post(
        "/interpret-request",
        headers={"Authorization": "Bearer anything"},
        json={"request_text": "a small desk"},
    )
    assert response.status_code == 503
    assert response.json()["code"] == "VISION_AUTH_NOT_CONFIGURED"


def test_authorized_timeout_does_not_echo_a_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VISION_SERVICE_TOKEN", "vision-test-token")
    app.dependency_overrides[get_completer] = lambda: Boom()
    response = TestClient(app).post(
        "/analyze-room",
        headers={"Authorization": "Bearer vision-test-token"},
        files={"image": ("room.jpg", _jpeg(), "image/jpeg")},
    )
    app.dependency_overrides.clear()
    assert response.status_code == 502
    assert response.json()["code"] == "NEBIUS_ERROR"
    assert "timed out" in response.json()["message"]
    assert "vision-test-token" not in response.text


def test_provider_error_redacts_the_api_key() -> None:
    text = public_provider_error(Exception("rejected sk-live-secret"), "sk-live-secret")
    assert "sk-live-secret" not in text
    assert "[redacted]" in text


def test_read_stops_past_the_byte_cap() -> None:
    class Source:
        def read(self, size: int) -> bytes:
            return b"x" * size

    with pytest.raises(ImageRejected) as caught:
        read_capped(Source(), limit=100)
    assert caught.value.status_code == 413


def test_huge_pixel_dimensions_are_rejected() -> None:
    rejected = reject_pixel_size(9000, 9000)
    assert rejected is not None
    assert rejected.code == "IMAGE_TOO_LARGE"


def _jpeg() -> bytes:
    import cv2
    import numpy as np

    ok, encoded = cv2.imencode(".jpg", np.full((64, 80, 3), 40, dtype=np.uint8))
    assert ok
    return encoded.tobytes()
