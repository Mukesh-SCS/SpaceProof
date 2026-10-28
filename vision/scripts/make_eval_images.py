"""Draw original room diagrams with a known open-floor rectangle.

These are synthetic diagrams, not photographs of measured apartments.
The expected box is the floor area this script paints, excluding the obstacle.
"""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "eval" / "images"
WIDTH = 960
HEIGHT = 640

SCENES = [
    {"id": "room-01-corner", "wall": (186, 196, 176), "floor": (120, 146, 168), "obstacle": (0.62, 0.55, 0.84, 0.86), "window": (0.08, 0.08, 0.28, 0.28)},
    {"id": "room-02-window", "wall": (196, 188, 170), "floor": (132, 150, 140), "obstacle": (0.08, 0.58, 0.28, 0.88), "window": (0.35, 0.06, 0.62, 0.24)},
    {"id": "room-03-plant", "wall": (170, 184, 196), "floor": (150, 138, 118), "obstacle": (0.72, 0.48, 0.9, 0.78), "window": (0.1, 0.1, 0.22, 0.3)},
    {"id": "room-04-narrow", "wall": (180, 176, 168), "floor": (110, 128, 150), "obstacle": (0.4, 0.62, 0.58, 0.9), "window": (0.7, 0.08, 0.9, 0.26)},
    {"id": "room-05-alcove", "wall": (168, 176, 160), "floor": (142, 154, 164), "obstacle": (0.05, 0.5, 0.22, 0.82), "window": (0.55, 0.08, 0.8, 0.22)},
    {"id": "room-06-shelf", "wall": (190, 184, 176), "floor": (128, 118, 108), "obstacle": (0.78, 0.36, 0.94, 0.7), "window": (0.12, 0.1, 0.34, 0.28)},
    {"id": "room-07-bright", "wall": (210, 206, 196), "floor": (160, 168, 150), "obstacle": (0.3, 0.7, 0.48, 0.92), "window": (0.4, 0.05, 0.7, 0.2)},
    {"id": "room-08-side", "wall": (176, 170, 188), "floor": (118, 140, 132), "obstacle": (0.84, 0.5, 0.97, 0.9), "window": (0.06, 0.08, 0.2, 0.32)},
    {"id": "room-09-low", "wall": (188, 180, 168), "floor": (136, 144, 128), "obstacle": (0.15, 0.72, 0.4, 0.94), "window": (0.62, 0.1, 0.88, 0.28)},
    {"id": "room-10-emptyish", "wall": (174, 186, 178), "floor": (146, 156, 166), "obstacle": (0.7, 0.78, 0.86, 0.94), "window": (0.2, 0.06, 0.42, 0.22)},
]


def rect(box: tuple[float, float, float, float]) -> tuple[int, int, int, int]:
    x1, y1, x2, y2 = box
    return (int(x1 * WIDTH), int(y1 * HEIGHT), int(x2 * WIDTH), int(y2 * HEIGHT))


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    expected = []
    for scene in SCENES:
        image = np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8)
        image[:260] = scene["wall"]
        image[260:] = scene["floor"]
        cv2.line(image, (0, 260), (WIDTH, 260), (80, 80, 80), 2)
        wx1, wy1, wx2, wy2 = rect(scene["window"])
        cv2.rectangle(image, (wx1, wy1), (wx2, wy2), (230, 236, 240), -1)
        cv2.rectangle(image, (wx1, wy1), (wx2, wy2), (90, 100, 110), 3)
        ox1, oy1, ox2, oy2 = rect(scene["obstacle"])
        cv2.rectangle(image, (ox1, oy1), (ox2, oy2), (70, 90, 70), -1)
        # Open floor the script intends as the desk region: right or left of the obstacle, on the floor.
        if scene["obstacle"][0] > 0.5:
            placement = (0.08, 0.48, 0.55, 0.9)
        else:
            placement = (0.4, 0.48, 0.9, 0.9)
        path = OUT / f"{scene['id']}.jpg"
        cv2.imwrite(str(path), image, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
        expected.append(
            {
                "id": scene["id"],
                "file": f"eval/images/{scene['id']}.jpg",
                "kind": "original synthetic room diagram",
                "expected_placement": {
                    "label": "Open floor drawn by the eval script",
                    "bbox_normalized": list(placement),
                },
                "obstacle_bbox_normalized": list(scene["obstacle"]),
                "ai_proposed_placement": None,
                "user_correction_required": None,
                "final_assessment_valid": None,
                "notes": "Physical millimeters are not encoded in the image. Assessment validity stays null until a buyer confirms measurements.",
            }
        )
    (ROOT / "eval" / "expected.json").write_text(json.dumps({"scenes": expected}, indent=2), encoding="utf-8")
    print(f"wrote {len(expected)} images")


if __name__ == "__main__":
    main()
