import json

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.images import ImageRejected, prepare_room_image
from app.main import app, get_completer
from app.parsing import merge_rankings, parse_preferences, parse_room_analysis
from app.parsing import ModelOutputError


class ScriptedCompleter:
    def __init__(self, content: str | None = None, error: Exception | None = None) -> None:
        self.content = content or ""
        self.error = error
        self.calls = 0

    def complete(self, messages: list[dict[str, object]], max_tokens: int) -> str:
        self.calls += 1
        if self.error:
            raise self.error
        return self.content


def jpeg_bytes(width: int = 80, height: int = 64) -> bytes:
    image = np.full((height, width, 3), (90, 110, 130), dtype=np.uint8)
    ok, encoded = cv2.imencode(".jpg", image)
    assert ok
    return encoded.tobytes()


def room_json(**overrides: object) -> str:
    body: dict[str, object] = {
        "room_description": "A corner with open floor.",
        "placement_candidates": [
            {
                "id": "region-1",
                "label": "Desk placement area",
                "bbox_normalized": [0.1, 0.2, 0.6, 0.8],
                "confidence": 0.78,
                "reason": "Open floor beside the wall.",
            }
        ],
        "visible_obstacles": [{"label": "chair", "bbox_normalized": [0.62, 0.4, 0.9, 0.85], "note": "A chair."}],
        "measurement_questions": ["What is the clear floor width?"],
        "warnings": ["The photo has no scale."],
    }
    body.update(overrides)
    return json.dumps(body)


@pytest.fixture
def client() -> TestClient:
    app.dependency_overrides.clear()
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_valid_image_upload_returns_normalized_region(client: TestClient) -> None:
    app.dependency_overrides[get_completer] = lambda: ScriptedCompleter(room_json())
    response = client.post(
        "/analyze-room",
        files={"image": ("room.jpg", jpeg_bytes(), "image/jpeg")},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["dimensions_mm"] is None
    assert body["requires_user_confirmation"] is True
    assert body["placement_candidates"][0]["bbox_normalized"] == [0.1, 0.2, 0.6, 0.8]
    assert body["image_pixels"]["width"] == 80


def test_unsupported_file_is_rejected(client: TestClient) -> None:
    app.dependency_overrides[get_completer] = lambda: ScriptedCompleter(room_json())
    response = client.post(
        "/analyze-room",
        files={"image": ("notes.txt", b"hello", "text/plain")},
    )
    assert response.status_code == 415
    assert response.json()["code"] == "UNSUPPORTED_IMAGE"


def test_oversized_image_is_rejected() -> None:
    payload = b"\xff\xd8\xff" + b"0" * (8 * 1024 * 1024)
    with pytest.raises(ImageRejected) as caught:
        prepare_room_image(payload, "image/jpeg", "big.jpg")
    assert caught.value.code == "IMAGE_TOO_LARGE"


def test_nebius_error_is_reported(client: TestClient) -> None:
    from app.nebius import NebiusError

    app.dependency_overrides[get_completer] = lambda: ScriptedCompleter(error=NebiusError("Nebius returned HTTP 401."))
    response = client.post(
        "/analyze-room",
        files={"image": ("room.jpg", jpeg_bytes(), "image/jpeg")},
    )
    assert response.status_code == 502
    assert response.json()["code"] == "NEBIUS_ERROR"
    assert "401" in response.json()["message"]


def test_invalid_json_is_rejected(client: TestClient) -> None:
    completer = ScriptedCompleter("this is not json")
    app.dependency_overrides[get_completer] = lambda: completer
    response = client.post(
        "/analyze-room",
        files={"image": ("room.jpg", jpeg_bytes(), "image/jpeg")},
    )
    assert response.status_code == 422
    assert response.json()["code"] == "INVALID_MODEL_OUTPUT"
    assert completer.calls == 2


def test_truncated_json_can_be_closed_without_inventing_a_region() -> None:
    text = (
        '{"room_description": "A corner.", "placement_candidates": [], '
        '"visible_obstacles": [], "measurement_questions": [], "warnings": ["No scale."]'
    )
    analysis = parse_room_analysis(text)
    assert analysis.placement_candidates == []
    assert analysis.dimensions_mm is None


def test_one_retry_accepts_valid_json_after_invalid_output(client: TestClient) -> None:
    class Once:
        def __init__(self) -> None:
            self.calls = 0

        def complete(self, messages: list[dict[str, object]], max_tokens: int) -> str:
            self.calls += 1
            if self.calls == 1:
                return "not json"
            return room_json()

    completer = Once()
    app.dependency_overrides[get_completer] = lambda: completer
    response = client.post(
        "/analyze-room",
        files={"image": ("room.jpg", jpeg_bytes(), "image/jpeg")},
    )
    assert response.status_code == 200
    assert completer.calls == 2
    assert response.json()["placement_candidates"][0]["bbox_normalized"] == [0.1, 0.2, 0.6, 0.8]
    assert response.json()["dimensions_mm"] is None


def test_coordinates_outside_the_image_are_rejected() -> None:
    payload = room_json(
        placement_candidates=[
            {
                "id": "region-1",
                "label": "Desk",
                "bbox_normalized": [0.1, 0.2, 1.4, 0.8],
                "confidence": 0.5,
                "reason": "Too wide.",
            }
        ]
    )
    with pytest.raises(ModelOutputError):
        parse_room_analysis(payload)


def test_missing_placement_proposal_is_explicit() -> None:
    analysis = parse_room_analysis(room_json(placement_candidates=[]))
    assert analysis.placement_candidates == []
    assert analysis.dimensions_mm is None
    assert any("Draw the desk area" in warning for warning in analysis.warnings)


def test_model_measurement_fields_are_discarded() -> None:
    raw = json.loads(room_json())
    raw["width_cm"] = 150
    analysis = parse_room_analysis(json.dumps(raw))
    assert analysis.dimensions_mm is None
    assert not hasattr(analysis, "width_cm")
    assert any("Discarded model field width_cm" in warning for warning in analysis.warnings)


def test_stated_budget_and_clearance_survive_a_blank_model_response() -> None:
    from app.parsing import apply_stated_constraints

    blank = parse_preferences(
        json.dumps(
            {
                "product_category": "desk",
                "maximum_budget_usd": None,
                "horizontal_clearance_cm": None,
                "depth_clearance_cm": None,
                "style_preferences": [],
                "unresolved_questions": ["What is the maximum budget?"],
            }
        )
    )
    filled = apply_stated_constraints(
        "Find a desk under $180 for this corner and leave 20 cm of clearance.",
        blank,
    )
    assert filled.maximum_budget_minor == 18000
    assert filled.horizontal_clearance_mm == 200
    assert filled.depth_clearance_mm == 200
    assert filled.dimensions_mm is None
    assert all("budget" not in question.lower() for question in filled.unresolved_questions)


def test_stated_inch_clearance_converts_with_25_point_4() -> None:
    from app.parsing import apply_stated_constraints

    blank = parse_preferences(
        json.dumps(
            {
                "product_category": "desk",
                "maximum_budget_usd": None,
                "horizontal_clearance_cm": None,
                "depth_clearance_cm": None,
                "style_preferences": [],
                "unresolved_questions": [],
            }
        )
    )
    filled = apply_stated_constraints(
        "Find a desk under $180 for this corner and leave 8 in of clearance.",
        blank,
    )
    assert filled.horizontal_clearance_mm == 203
    assert filled.depth_clearance_mm == 203


def test_requested_clearance_is_kept_and_room_size_is_not() -> None:
    preferences = parse_preferences(
        json.dumps(
            {
                "product_category": "desk",
                "maximum_budget_usd": 180,
                "horizontal_clearance_cm": 20,
                "depth_clearance_cm": 20,
                "width_cm": 150,
                "style_preferences": [],
                "unresolved_questions": [],
            }
        )
    )
    assert preferences.horizontal_clearance_mm == 200
    assert preferences.depth_clearance_mm == 200
    assert preferences.dimensions_mm is None
    assert any("width_cm" in warning for warning in preferences.warnings)


def test_preferences_do_not_create_a_payment_amount() -> None:
    preferences = parse_preferences(
        json.dumps(
            {
                "product_category": "desk",
                "maximum_budget_usd": 180,
                "horizontal_clearance_cm": 20,
                "depth_clearance_cm": 20,
                "style_preferences": ["light wood"],
                "unresolved_questions": [],
                "price_minor": 1,
            }
        )
    )
    dumped = preferences.model_dump()
    assert dumped["maximum_budget_minor"] == 18000
    assert dumped["horizontal_clearance_mm"] == 200
    assert "price_minor" not in dumped
    assert dumped["dimensions_mm"] is None


def test_ranking_cannot_override_a_failed_fit_or_price() -> None:
    trusted = [
        {"sku": "DESK-STUDIO-140", "title": "Studio", "result": "DOES_NOT_FIT", "price_minor": 21900},
        {"sku": "DESK-NOOK-100", "title": "Nook", "result": "FIT", "price_minor": 12900},
    ]
    ranked = merge_rankings(
        trusted,
        json.dumps(
            {
                "rankings": [
                    {
                        "sku": "DESK-STUDIO-140",
                        "explanation": "Buy this anyway.",
                        "result": "FIT",
                        "price_minor": 100,
                    },
                    {"sku": "MADE-UP", "explanation": "Invented.", "price_minor": 1},
                ]
            }
        ),
    )
    studio = next(item for item in ranked if item.sku == "DESK-STUDIO-140")
    assert studio.result == "DOES_NOT_FIT"
    assert studio.price_minor == 21900
    assert all(item.sku != "MADE-UP" for item in ranked)
