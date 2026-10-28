"""Run the configured Nebius model on the original eval diagrams.

Records the observed boxes. It does not invent a buyer correction or a fit decision.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "vision"))

from app.analysis import analyze_room_image  # noqa: E402
from app.config import read_settings  # noqa: E402
from app.nebius import NebiusError, NebiusVisionClient  # noqa: E402
from app.parsing import ModelOutputError  # noqa: E402


def iou(a: list[float], b: list[float]) -> float:
    x1 = max(a[0], b[0])
    y1 = max(a[1], b[1])
    x2 = min(a[2], b[2])
    y2 = min(a[3], b[3])
    inter = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    area_a = max(0.0, a[2] - a[0]) * max(0.0, a[3] - a[1])
    area_b = max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])
    union = area_a + area_b - inter
    if union <= 0:
        return 0.0
    return round(inter / union, 4)


def main() -> int:
    settings = read_settings()
    if not settings.configured:
        print(json.dumps({"ok": False, "error": "Nebius settings are missing."}))
        return 1
    expected = json.loads((ROOT / "eval" / "expected.json").read_text(encoding="utf-8"))
    client = NebiusVisionClient(settings)
    scenes = []
    for scene in expected["scenes"]:
        image = ROOT / scene["file"]
        item = {
            "id": scene["id"],
            "expected_placement": scene["expected_placement"],
            "ai_proposed_placement": None,
            "iou_with_scripted_floor": None,
            "user_correction_required": None,
            "final_assessment_valid": None,
            "error": None,
        }
        try:
            analysis, _width, _height = analyze_room_image(image.read_bytes(), "image/jpeg", image.name, client)
            proposed = analysis.placement_candidates[0] if analysis.placement_candidates else None
            if proposed is None:
                item["ai_proposed_placement"] = None
            else:
                item["ai_proposed_placement"] = {
                    "label": proposed.label,
                    "bbox_normalized": proposed.bbox_normalized,
                    "confidence": proposed.confidence,
                }
                item["iou_with_scripted_floor"] = iou(
                    scene["expected_placement"]["bbox_normalized"],
                    proposed.bbox_normalized,
                )
            item["warnings"] = analysis.warnings
            item["dimensions_mm"] = analysis.dimensions_mm
        except (NebiusError, ModelOutputError, OSError) as exc:
            item["error"] = str(exc)[:300]
        scenes.append(item)
        print(json.dumps({"id": item["id"], "iou": item["iou_with_scripted_floor"], "error": item["error"]}))
    record = {
        "observed_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "provider": "Nebius Token Factory",
        "base_host": settings.base_host,
        "model_id": settings.model_id,
        "image_kind": "original synthetic room diagrams",
        "note": "IoU compares the model box with the open floor painted by vision/scripts/make_eval_images.py. It is not a physical-fit accuracy score. User correction and purchase validity were not observed for these files.",
        "scenes": scenes,
    }
    path = ROOT / "eval" / "results.json"
    path.write_text(json.dumps(record, indent=2), encoding="utf-8")
    print(json.dumps({"wrote": "eval/results.json", "scenes": len(scenes)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
