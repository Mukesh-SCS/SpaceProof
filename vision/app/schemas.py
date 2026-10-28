"""Structured vision output. Coordinates are fractions of the image, never room sizes."""

from __future__ import annotations

import math
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


def _unit_interval(value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("Coordinate must be a number.")
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("Coordinate must be finite.")
    if number < 0 or number > 1:
        raise ValueError("Coordinate must be between 0 and 1.")
    return number


def normalize_bbox(value: object) -> list[float]:
    if not isinstance(value, (list, tuple)) or len(value) != 4:
        raise ValueError("Bounding box must contain four numbers.")
    numbers: list[float] = []
    for item in value:
        if isinstance(item, bool) or not isinstance(item, (int, float)) or not math.isfinite(float(item)):
            raise ValueError("Bounding box values must be finite numbers.")
        numbers.append(float(item))
    if any(number > 1 for number in numbers) and all(0 <= number <= 100 for number in numbers):
        numbers = [number / 100 for number in numbers]
    coords = [_unit_interval(number) for number in numbers]
    x_min, y_min, x_max, y_max = coords
    if x_max - x_min < 0.01 or y_max - y_min < 0.01:
        raise ValueError("Bounding box is empty or too small.")
    return [round(coord, 4) for coord in (x_min, y_min, x_max, y_max)]


class PlacementCandidate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(min_length=1, max_length=40)
    label: str = Field(min_length=1, max_length=120)
    bbox_normalized: list[float]
    confidence: float
    reason: str = Field(min_length=1, max_length=500)

    @field_validator("bbox_normalized")
    @classmethod
    def check_bbox(cls, value: object) -> list[float]:
        return normalize_bbox(value)

    @field_validator("confidence")
    @classmethod
    def check_confidence(cls, value: float) -> float:
        if isinstance(value, bool) or not math.isfinite(value) or value < 0 or value > 1:
            raise ValueError("Confidence must be between 0 and 1.")
        return round(float(value), 4)


class VisibleObstacle(BaseModel):
    model_config = ConfigDict(extra="ignore")

    label: str = Field(min_length=1, max_length=120)
    bbox_normalized: list[float] | None = None
    note: str = Field(default="", max_length=500)

    @field_validator("bbox_normalized")
    @classmethod
    def check_bbox(cls, value: object) -> list[float] | None:
        if value is None:
            return None
        return normalize_bbox(value)


class RoomAnalysis(BaseModel):
    """What the photograph suggested. It does not contain physical measurements."""

    model_config = ConfigDict(extra="ignore")

    room_description: str = Field(min_length=1, max_length=1200)
    placement_candidates: list[PlacementCandidate]
    visible_obstacles: list[VisibleObstacle]
    measurement_questions: list[str]
    warnings: list[str]
    dimensions_mm: None = None
    requires_user_confirmation: Literal[True] = True


class ShoppingPreferences(BaseModel):
    model_config = ConfigDict(extra="ignore")

    product_category: Literal["desk", "other"]
    maximum_budget_minor: int | None = None
    horizontal_clearance_mm: int | None = None
    depth_clearance_mm: int | None = None
    style_preferences: list[str]
    unresolved_questions: list[str]
    warnings: list[str]
    dimensions_mm: None = None


class RankedExplanation(BaseModel):
    sku: str
    explanation: str
    result: str
    price_minor: int
