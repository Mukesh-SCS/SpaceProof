"""SpaceProof vision service.

Nebius can propose a placement region from a photograph.
It does not measure the room, and it cannot approve a payment.
"""

from __future__ import annotations

import cv2
from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.analysis import analyze_room_image, explain_trusted_products, interpret_shopping_request
from app.config import read_settings
from app.images import ImageRejected
from app.nebius import (
    NebiusConfigError,
    NebiusError,
    NebiusVisionClient,
    VisionCompleter,
    missing_settings,
)
from app.parsing import ModelOutputError
from app.pipeline.calibration import estimate_dimensions_from_image

app = FastAPI(
    title="SpaceProof Vision",
    version="0.2.0",
    description="Room-photo proposals from Nebius. Physical fit is decided elsewhere.",
)


class PreferenceBody(BaseModel):
    request_text: str = Field(min_length=1, max_length=2000)


class TrustedProduct(BaseModel):
    sku: str
    title: str
    result: str
    price_minor: int
    reasons: list[str] = Field(default_factory=list)


class RankBody(BaseModel):
    request_text: str = Field(default="", max_length=2000)
    products: list[TrustedProduct] = Field(min_length=1, max_length=20)


def get_completer() -> VisionCompleter:
    settings = read_settings()
    missing = missing_settings(settings)
    if missing:
        raise NebiusConfigError(missing)
    return NebiusVisionClient(settings)


@app.exception_handler(NebiusConfigError)
def nebius_not_configured(_request: Request, exc: NebiusConfigError) -> JSONResponse:
    return JSONResponse(
        status_code=503,
        content={"code": "NEBIUS_NOT_CONFIGURED", "message": "Nebius is not configured.", "missing": exc.missing},
    )


def _provider_http(exc: NebiusError) -> JSONResponse:
    return JSONResponse(
        status_code=502,
        content={"code": "NEBIUS_ERROR", "message": exc.message},
    )


@app.get("/health")
def health() -> dict[str, object]:
    settings = read_settings()
    return {
        "status": "ok",
        "service": "spaceproof-vision",
        "opencv": cv2.__version__,
        "image_measurement": False,
        "nebius_configured": settings.configured,
        "model_id": settings.model_id or None,
    }


@app.get("/contract")
def contract() -> dict[str, object]:
    return {
        "image_measurement": False,
        "note": "SpaceProof does not estimate physical dimensions from a photograph.",
        "analyze_room": {
            "method": "POST",
            "path": "/analyze-room",
            "dimensions_mm": None,
            "requires_user_confirmation": True,
            "bbox": "[x_min, y_min, x_max, y_max] normalized from 0 to 1",
        },
    }


@app.post("/measure")
def measure() -> None:
    try:
        estimate_dimensions_from_image(b"")
    except NotImplementedError as exc:
        raise HTTPException(status_code=501, detail=str(exc)) from exc


@app.post("/analyze-room")
def analyze_room(
    image: UploadFile = File(...),
    completer: VisionCompleter = Depends(get_completer),
) -> JSONResponse:
    data = image.file.read()
    try:
        analysis, width, height = analyze_room_image(data, image.content_type, image.filename, completer)
    except ImageRejected as exc:
        return JSONResponse(status_code=exc.status_code, content={"code": exc.code, "message": exc.message})
    except NebiusConfigError as exc:
        return JSONResponse(
            status_code=503,
            content={"code": "NEBIUS_NOT_CONFIGURED", "message": "Nebius is not configured.", "missing": exc.missing},
        )
    except NebiusError as exc:
        return _provider_http(exc)
    except ModelOutputError as exc:
        return JSONResponse(status_code=422, content={"code": "INVALID_MODEL_OUTPUT", "message": exc.message})
    body = analysis.model_dump()
    body["image_pixels"] = {"width": width, "height": height}
    return JSONResponse(content=body)


@app.post("/interpret-request")
def interpret_request(
    body: PreferenceBody,
    completer: VisionCompleter = Depends(get_completer),
) -> JSONResponse:
    try:
        preferences = interpret_shopping_request(body.request_text, completer)
    except NebiusConfigError as exc:
        return JSONResponse(
            status_code=503,
            content={"code": "NEBIUS_NOT_CONFIGURED", "message": "Nebius is not configured.", "missing": exc.missing},
        )
    except NebiusError as exc:
        return _provider_http(exc)
    except ModelOutputError as exc:
        return JSONResponse(status_code=422, content={"code": "INVALID_MODEL_OUTPUT", "message": exc.message})
    return JSONResponse(content=preferences.model_dump())


@app.post("/rank-products")
def rank_products(
    body: RankBody,
    completer: VisionCompleter = Depends(get_completer),
) -> JSONResponse:
    trusted = [item.model_dump() for item in body.products]
    try:
        ranked = explain_trusted_products(body.request_text, trusted, completer)
    except NebiusConfigError as exc:
        return JSONResponse(
            status_code=503,
            content={"code": "NEBIUS_NOT_CONFIGURED", "message": "Nebius is not configured.", "missing": exc.missing},
        )
    except NebiusError as exc:
        return _provider_http(exc)
    except ModelOutputError as exc:
        return JSONResponse(status_code=422, content={"code": "INVALID_MODEL_OUTPUT", "message": exc.message})
    return JSONResponse(content={"rankings": [item.model_dump() for item in ranked]})
