"""Turn model text into validated proposals. Physical measurements are discarded."""

from __future__ import annotations

import json
import math
import re
from typing import Any, Literal

from pydantic import ValidationError

from app.schemas import PlacementCandidate, RankedExplanation, RoomAnalysis, ShoppingPreferences, VisibleObstacle

INVENTED_SIZE_KEY = re.compile(
    r"^(width|depth|height|length|dimensions?)(_?(mm|cm|m))?$|dimensions_mm|room_size",
    re.IGNORECASE,
)


class ModelOutputError(Exception):
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


def _strip_trailing_commas(text: str) -> str:
    return re.sub(r",\s*([}\]])", r"\1", text)


def _close_truncated_json(text: str) -> str | None:
    """Close braces that were cut off after a complete value. Do not invent a missing string or number."""
    stack: list[str] = []
    in_string = False
    escape = False
    for char in text:
        if in_string:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            stack.append("}")
        elif char == "[":
            stack.append("]")
        elif char in "}]":
            if not stack or stack[-1] != char:
                return None
            stack.pop()
    if in_string or escape or not stack:
        return None
    return text + "".join(reversed(stack))


def extract_json_object(text: str) -> dict[str, Any]:
    cleaned = text.strip().lstrip("\ufeff")
    fenced = re.search(r"```(?:json)?\s*(\{.*)\s*```", cleaned, re.DOTALL)
    if fenced:
        cleaned = fenced.group(1).strip()
    else:
        start = cleaned.find("{")
        if start < 0:
            raise ModelOutputError("The model did not return a JSON object.")
        end = cleaned.rfind("}")
        cleaned = cleaned[start : end + 1] if end > start else cleaned[start:]
    cleaned = _strip_trailing_commas(cleaned)
    candidates = [cleaned]
    closed = _close_truncated_json(cleaned)
    if closed and closed != cleaned:
        candidates.append(_strip_trailing_commas(closed))
    last_error: json.JSONDecodeError | None = None
    for candidate in candidates:
        try:
            value = json.loads(candidate)
        except json.JSONDecodeError as exc:
            last_error = exc
            continue
        if not isinstance(value, dict):
            raise ModelOutputError("The model response was not a JSON object.")
        return value
    raise ModelOutputError("The model returned invalid JSON.") from last_error


def _discard_measurements(value: dict[str, Any]) -> list[str]:
    warnings: list[str] = []
    for key in list(value):
        if INVENTED_SIZE_KEY.search(key):
            value.pop(key)
            warnings.append(
                f"Discarded model field {key}. A photograph is not a measurement of the room."
            )
    return warnings


def _string_list(value: object, limit: int = 8) -> list[str]:
    if not isinstance(value, list):
        return []
    items: list[str] = []
    for item in value:
        if isinstance(item, str) and item.strip():
            items.append(item.strip()[:400])
        if len(items) >= limit:
            break
    return items


def _slug(value: object, fallback: str) -> str:
    text = value.strip().lower() if isinstance(value, str) else ""
    text = re.sub(r"[^a-z0-9-]+", "-", text).strip("-")[:40]
    return text or fallback


def parse_room_analysis(text: str) -> RoomAnalysis:
    raw = extract_json_object(text)
    discarded = _discard_measurements(raw)
    candidates_in = raw.get("placement_candidates")
    if candidates_in is None:
        candidates_in = []
    if not isinstance(candidates_in, list):
        raise ModelOutputError("placement_candidates must be a list.")
    candidates: list[PlacementCandidate] = []
    for index, item in enumerate(candidates_in, start=1):
        if not isinstance(item, dict):
            raise ModelOutputError("A placement candidate was not an object.")
        _discard_measurements(item)
        try:
            candidates.append(
                PlacementCandidate(
                    id=_slug(item.get("id"), f"region-{index}"),
                    label=str(item.get("label") or "Desk placement area")[:120],
                    bbox_normalized=item.get("bbox_normalized"),
                    confidence=item.get("confidence", 0),
                    reason=str(item.get("reason") or "The model suggested this region.")[:500],
                )
            )
        except (ValidationError, ValueError) as exc:
            raise ModelOutputError(
                "The model returned a placement region with invalid coordinates. Draw the region yourself."
            ) from exc

    obstacles_in = raw.get("visible_obstacles") or []
    if not isinstance(obstacles_in, list):
        raise ModelOutputError("visible_obstacles must be a list.")
    obstacles: list[VisibleObstacle] = []
    for item in obstacles_in[:12]:
        if not isinstance(item, dict):
            continue
        bbox = item.get("bbox_normalized")
        try:
            obstacles.append(
                VisibleObstacle(
                    label=str(item.get("label") or "Obstacle")[:120],
                    bbox_normalized=bbox if bbox is not None else None,
                    note=str(item.get("note") or item.get("reason") or "")[:500],
                )
            )
        except (ValidationError, ValueError) as exc:
            raise ModelOutputError("The model returned an obstacle box outside the image.") from exc

    description = str(raw.get("room_description") or "").strip()
    if not description:
        raise ModelOutputError("The model did not describe the room.")
    warnings = _string_list(raw.get("warnings"), 12)
    if not candidates:
        warnings.append("No placement region was proposed. Draw the desk area yourself.")
    warnings.extend(discarded)
    warnings.append("These regions are visual suggestions. Confirm the available width and depth yourself.")
    try:
        return RoomAnalysis(
            room_description=description[:1200],
            placement_candidates=candidates,
            visible_obstacles=obstacles,
            measurement_questions=_string_list(raw.get("measurement_questions")),
            warnings=warnings[:16],
        )
    except ValidationError as exc:
        raise ModelOutputError("The model response did not match the room-analysis schema.") from exc


def _whole_centimeters(value: object) -> int | None:
    if value is None or isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    if not math.isfinite(number) or abs(number - round(number)) > 1e-6:
        return None
    centimeters = int(round(number))
    if centimeters < 0 or centimeters > 1000:
        return None
    return centimeters * 10


def _usd_to_minor(value: object) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    cents = round(number * 100)
    if abs(number * 100 - cents) > 0.001:
        return None
    if cents < 0 or cents > 100_000_000:
        return None
    return cents


def apply_stated_constraints(request_text: str, preferences: ShoppingPreferences) -> ShoppingPreferences:
    """Use numbers the buyer actually wrote when the model leaves them blank."""
    warnings = list(preferences.warnings)
    questions = list(preferences.unresolved_questions)
    budget = preferences.maximum_budget_minor
    side = preferences.horizontal_clearance_mm
    depth = preferences.depth_clearance_mm
    if budget is None:
        amount = re.search(r"\$\s*(\d+(?:\.\d{1,2})?)", request_text)
        if amount:
            budget = _usd_to_minor(float(amount.group(1)))
            if budget is not None:
                warnings.append("The budget was read from the dollar amount in the request.")
                questions = [item for item in questions if "budget" not in item.lower()]
    if side is None and depth is None:
        clearance_cm = re.search(r"(\d+)\s*cm of clearance", request_text, re.IGNORECASE)
        clearance_in = re.search(
            r"(\d+(?:\.\d+)?)\s*(?:inches|inch|in)\s+of clearance",
            request_text,
            re.IGNORECASE,
        )
        millimeters = None
        if clearance_cm:
            millimeters = int(clearance_cm.group(1)) * 10
        elif clearance_in:
            millimeters = int(round(float(clearance_in.group(1)) * 25.4))
        if millimeters is not None and 0 <= millimeters <= 10000:
            side = millimeters
            depth = millimeters
            warnings.append(
                "One clearance amount was copied to both side and depth. Correct either value before confirming."
            )
    return preferences.model_copy(
        update={
            "maximum_budget_minor": budget,
            "horizontal_clearance_mm": side,
            "depth_clearance_mm": depth,
            "warnings": warnings,
            "unresolved_questions": questions,
        }
    )


def parse_preferences(text: str) -> ShoppingPreferences:
    raw = extract_json_object(text)
    discarded = _discard_measurements(raw)
    category_raw = str(raw.get("product_category") or "").strip().lower()
    category: Literal["desk", "other"] = "desk" if category_raw in {"desk", "desks", "table"} else "other"
    warnings = list(discarded)
    if category == "other":
        warnings.append("SpaceProof currently checks desks only.")
    budget = _usd_to_minor(raw.get("maximum_budget_usd"))
    if raw.get("maximum_budget_usd") not in (None, "") and budget is None:
        warnings.append("The budget in the request was not a clear dollar amount, so it was not applied.")
    side = _whole_centimeters(raw.get("horizontal_clearance_cm"))
    depth = _whole_centimeters(raw.get("depth_clearance_cm"))
    if raw.get("horizontal_clearance_cm") not in (None, "") and side is None:
        warnings.append("Side clearance was not a whole number of centimeters, so it was not applied.")
    if raw.get("depth_clearance_cm") not in (None, "") and depth is None:
        warnings.append("Depth clearance was not a whole number of centimeters, so it was not applied.")
    return ShoppingPreferences(
        product_category=category,
        maximum_budget_minor=budget,
        horizontal_clearance_mm=side,
        depth_clearance_mm=depth,
        style_preferences=_string_list(raw.get("style_preferences")),
        unresolved_questions=_string_list(raw.get("unresolved_questions")),
        warnings=warnings,
    )


def merge_rankings(trusted: list[dict[str, Any]], model_text: str) -> list[RankedExplanation]:
    """Keep the geometry result and catalog price. The model may only explain."""
    raw = extract_json_object(model_text)
    rankings = raw.get("rankings")
    explanations: dict[str, str] = {}
    order: list[str] = []
    if isinstance(rankings, list):
        for item in rankings:
            if not isinstance(item, dict):
                continue
            sku = item.get("sku")
            if not isinstance(sku, str):
                continue
            order.append(sku)
            explanation = item.get("explanation")
            if isinstance(explanation, str) and explanation.strip():
                explanations[sku] = explanation.strip()[:500]
    by_sku = {str(item["sku"]): item for item in trusted}
    ranked: list[RankedExplanation] = []
    seen: set[str] = set()
    for sku in order:
        item = by_sku.get(sku)
        if item is None or sku in seen:
            continue
        seen.add(sku)
        ranked.append(
            RankedExplanation(
                sku=sku,
                explanation=explanations.get(sku) or "Geometry already scored this desk.",
                result=str(item["result"]),
                price_minor=int(item["price_minor"]),
            )
        )
    for item in trusted:
        sku = str(item["sku"])
        if sku in seen:
            continue
        ranked.append(
            RankedExplanation(
                sku=sku,
                explanation="The model did not comment on this desk. The geometry result is unchanged.",
                result=str(item["result"]),
                price_minor=int(item["price_minor"]),
            )
        )
    return ranked
