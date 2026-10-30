"""Server-to-server token for paid Nebius routes. Health stays public."""

from __future__ import annotations

import os
import secrets

from fastapi import Request
from fastapi.responses import JSONResponse


def configured_token() -> str:
    return os.environ.get("VISION_SERVICE_TOKEN", "").strip()


def token_matches(provided: str, expected: str) -> bool:
    if not expected or len(provided) != len(expected):
        return False
    return secrets.compare_digest(provided, expected)


def reject_anonymous(request: Request) -> JSONResponse | None:
    expected = configured_token()
    if not expected:
        return JSONResponse(
            status_code=503,
            content={
                "code": "VISION_AUTH_NOT_CONFIGURED",
                "message": "The vision service token is not configured.",
            },
        )
    header = request.headers.get("authorization", "")
    provided = header.removeprefix("Bearer ").strip() if header.startswith("Bearer ") else ""
    if not token_matches(provided, expected):
        return JSONResponse(
            status_code=401,
            content={"code": "UNAUTHORIZED", "message": "This vision endpoint requires the server token."},
        )
    return None
