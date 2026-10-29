"""Nebius Token Factory client. The API key stays in this process."""

from __future__ import annotations

import base64
import time
from typing import Protocol

from openai import OpenAI

from app.config import Settings

ROOM_INSTRUCTIONS = """You analyze indoor photographs for possible desk placement.
Return one JSON object and no other text.
Use this shape:
{
  "room_description": "what is visible",
  "placement_candidates": [
    {
      "id": "region-1",
      "label": "Desk placement area",
      "bbox_normalized": [0.1, 0.2, 0.6, 0.8],
      "confidence": 0.7,
      "reason": "why this floor area might hold a desk"
    }
  ],
  "visible_obstacles": [
    {"label": "chair", "bbox_normalized": [0.2, 0.3, 0.4, 0.6], "note": "what is visible"}
  ],
  "measurement_questions": ["Which distance should the buyer measure?"],
  "warnings": ["what is uncertain"]
}
bbox_normalized is [x_min, y_min, x_max, y_max], each a fraction of the image from 0 to 1.
Do not estimate width, depth, height, centimeters, millimeters, or any physical size.
A single uncalibrated photograph cannot prove that furniture fits.
If no usable floor area is visible, return an empty placement_candidates list and say why.
Mention only obstacles you can see. Do not invent objects or products.
"""

REQUEST_INSTRUCTIONS = """Extract desk-shopping constraints from the buyer's sentence.
Return one JSON object and no other text:
{
  "product_category": "desk or other",
  "maximum_budget_usd": null,
  "horizontal_clearance_cm": null,
  "depth_clearance_cm": null,
  "style_preferences": [],
  "unresolved_questions": []
}
Use null when the buyer did not state that constraint.
Clearance values are whole centimeters. Budget is US dollars.
Do not invent a budget, a clearance, a product dimension, or a price.
"""

RANK_INSTRUCTIONS = """You explain desks that a geometry engine already scored.
The user message is JSON with the buyer's sentence and the trusted products.
Each product includes sku, title, result, price_usd, and reasons. Those values are authoritative.
Return one JSON object:
{"rankings": [{"sku": "existing sku", "explanation": "trade-off in one or two sentences"}]}
Order rankings from the strongest match to the weakest.
Do not add a sku. Do not change result or price. Do not say a DOES_NOT_FIT or UNCERTAIN desk can be purchased.
"""


class VisionCompleter(Protocol):
    def complete(self, messages: list[dict[str, object]], max_tokens: int) -> str: ...


class NebiusError(Exception):
    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class NebiusConfigError(Exception):
    def __init__(self, missing: list[str]) -> None:
        super().__init__("Nebius is not configured.")
        self.missing = missing


def missing_settings(settings: Settings) -> list[str]:
    missing: list[str] = []
    if not settings.api_key:
        missing.append("NEBIUS_API_KEY")
    if not settings.model_id:
        missing.append("NEBIUS_MODEL_ID")
    if not settings.base_url:
        missing.append("NEBIUS_BASE_URL")
    return missing


def public_provider_error(exc: Exception, secret: str) -> str:
    status = getattr(exc, "status_code", None)
    detail = getattr(exc, "message", None)
    text = str(detail or exc.__class__.__name__)
    if secret:
        text = text.replace(secret, "[redacted]")
    text = " ".join(text.split())[:240]
    if status:
        return f"Nebius returned HTTP {status}. {text}"
    return f"Nebius request failed. {text}"


class NebiusVisionClient:
    def __init__(self, settings: Settings) -> None:
        missing = missing_settings(settings)
        if missing:
            raise NebiusConfigError(missing)
        self.model_id = settings.model_id
        self._secret = settings.api_key
        self.last_latency_ms: int | None = None
        self.last_usage: dict[str, int | None] | None = None
        self._client = OpenAI(
            base_url=f"{settings.base_url}/",
            api_key=settings.api_key,
            timeout=45.0,
            max_retries=0,
        )

    def complete(self, messages: list[dict[str, object]], max_tokens: int) -> str:
        started = time.perf_counter()
        try:
            response = self._client.chat.completions.create(
                model=self.model_id,
                messages=messages,  # type: ignore[arg-type]
                max_tokens=max_tokens,
                temperature=0.2,
                reasoning_effort="low",
            )
        except Exception as exc:
            raise NebiusError(public_provider_error(exc, self._secret), getattr(exc, "status_code", None)) from exc
        self.last_latency_ms = round((time.perf_counter() - started) * 1000)
        usage = getattr(response, "usage", None)
        self.last_usage = None
        if usage is not None:
            details = getattr(usage, "completion_tokens_details", None)
            self.last_usage = {
                "prompt_tokens": getattr(usage, "prompt_tokens", None),
                "completion_tokens": getattr(usage, "completion_tokens", None),
                "total_tokens": getattr(usage, "total_tokens", None),
                "reasoning_tokens": getattr(details, "reasoning_tokens", None) if details is not None else None,
            }
        choice = response.choices[0]
        content = choice.message.content
        if isinstance(content, list):
            parts: list[str] = []
            for part in content:
                text = getattr(part, "text", None)
                if isinstance(text, str):
                    parts.append(text)
            content = "".join(parts)
        if not isinstance(content, str) or not content.strip():
            raise NebiusError(
                f"The model returned no JSON. Finish reason: {choice.finish_reason or 'unknown'}."
            )
        return content


def room_messages(jpeg_bytes: bytes) -> list[dict[str, object]]:
    encoded = base64.b64encode(jpeg_bytes).decode("ascii")
    return [
        {"role": "system", "content": ROOM_INSTRUCTIONS},
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": (
                        "Analyze this room. Identify possible desk placement areas, "
                        "visible obstacles, spatial restrictions, and uncertainty. "
                        "Do not invent physical measurements."
                    ),
                },
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{encoded}"}},
            ],
        },
    ]


def preference_messages(request_text: str) -> list[dict[str, object]]:
    return [
        {"role": "system", "content": REQUEST_INSTRUCTIONS},
        {"role": "user", "content": request_text[:2000]},
    ]


def rank_messages(payload: str) -> list[dict[str, object]]:
    return [
        {"role": "system", "content": RANK_INSTRUCTIONS},
        {"role": "user", "content": payload},
    ]
