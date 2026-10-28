"""SpaceProof vision service.

Reports health, proves OpenCV imports, and describes the future image API.
It does not measure rooms.
"""

import cv2
from fastapi import FastAPI, HTTPException

from app.pipeline.calibration import estimate_dimensions_from_image

app = FastAPI(
    title="SpaceProof Vision",
    version="0.1.0",
    description="Foundation for later calibration. Image measurement is not implemented.",
)


@app.get("/health")
def health() -> dict[str, object]:
    return {
        "status": "ok",
        "service": "spaceproof-vision",
        "opencv": cv2.__version__,
        "image_measurement": False,
    }


@app.get("/contract")
def contract() -> dict[str, object]:
    """Describes the future image API. It does not analyze an image."""
    return {
        "image_measurement": False,
        "note": "SpaceProof does not estimate physical dimensions from a photograph.",
        "planned": {
            "method": "POST",
            "path": "/scenes",
            "request": {
                "image": "A room photograph supplied by the buyer.",
                "corrections": "A placement region the buyer can edit before anything is trusted.",
            },
            "response": {
                "proposed_region": "An untrusted suggestion for the buyer to correct.",
                "requires_user_confirmation": True,
                "dimensions_mm": None,
            },
        },
    }


@app.post("/measure")
def measure() -> None:
    try:
        estimate_dimensions_from_image(b"")
    except NotImplementedError as exc:
        raise HTTPException(status_code=501, detail=str(exc)) from exc
