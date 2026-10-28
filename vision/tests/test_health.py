import cv2
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.pipeline.calibration import estimate_dimensions_from_image

client = TestClient(app)


def test_opencv_imports() -> None:
    assert isinstance(cv2.__version__, str)
    assert cv2.__version__


def test_health_reports_no_image_measurement() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "spaceproof-vision"
    assert body["image_measurement"] is False
    assert body["opencv"] == cv2.__version__


def test_contract_does_not_invent_dimensions() -> None:
    response = client.get("/contract")
    assert response.status_code == 200
    body = response.json()
    assert body["image_measurement"] is False
    assert body["analyze_room"]["dimensions_mm"] is None
    assert body["analyze_room"]["requires_user_confirmation"] is True


def test_measure_is_not_implemented() -> None:
    with pytest.raises(NotImplementedError):
        estimate_dimensions_from_image(b"not-a-photo")

    response = client.post("/measure")
    assert response.status_code == 501
    assert "width" not in response.json()
    assert "not implemented" in response.json()["detail"].lower()
