"""Image and shopping analysis. Geometry and PayPal stay outside this module."""

from __future__ import annotations

import json
from typing import Any

from app.images import prepare_room_image
from app.nebius import VisionCompleter, preference_messages, rank_messages, room_messages
from app.parsing import apply_stated_constraints, merge_rankings, parse_preferences, parse_room_analysis
from app.schemas import RankedExplanation, RoomAnalysis, ShoppingPreferences


def analyze_room_image(
    data: bytes,
    content_type: str | None,
    filename: str | None,
    completer: VisionCompleter,
) -> tuple[RoomAnalysis, int, int]:
    jpeg, width, height = prepare_room_image(data, content_type, filename)
    raw = completer.complete(room_messages(jpeg), max_tokens=2200)
    return parse_room_analysis(raw), width, height


def interpret_shopping_request(request_text: str, completer: VisionCompleter) -> ShoppingPreferences:
    raw = completer.complete(preference_messages(request_text), max_tokens=1400)
    return apply_stated_constraints(request_text, parse_preferences(raw))


def explain_trusted_products(
    request_text: str,
    trusted: list[dict[str, Any]],
    completer: VisionCompleter,
) -> list[RankedExplanation]:
    payload = json.dumps(
        {
            "request": request_text[:2000],
            "products": [
                {
                    "sku": item["sku"],
                    "title": item["title"],
                    "result": item["result"],
                    "price_usd": f"{int(item['price_minor']) / 100:.2f}",
                    "reasons": item.get("reasons") or [],
                }
                for item in trusted
            ],
        }
    )
    raw = completer.complete(rank_messages(payload), max_tokens=1800)
    return merge_rankings(trusted, raw)
