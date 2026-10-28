"""Send one real room diagram to Nebius and save a redacted response.

This script is not part of pytest. It reads vision/.env and does not print the API key.
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
from app.images import ImageRejected  # noqa: E402
from app.nebius import NebiusError, NebiusVisionClient  # noqa: E402
from app.parsing import ModelOutputError  # noqa: E402


def redact(value: object, secret: str) -> object:
    if isinstance(value, str):
        return value.replace(secret, "[redacted]") if secret else value
    if isinstance(value, list):
        return [redact(item, secret) for item in value]
    if isinstance(value, dict):
        return {str(key): redact(item, secret) for key, item in value.items()}
    return value


def main() -> int:
    image_arg = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "eval" / "images" / "room-01-corner.jpg"
    settings = read_settings()
    evidence_dir = ROOT / "eval" / "evidence"
    evidence_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    record: dict[str, object] = {
        "observed_at": stamp,
        "provider": "Nebius Token Factory",
        "base_host": settings.base_host,
        "model_id": settings.model_id,
        "image": str(image_arg.relative_to(ROOT)).replace("\\", "/"),
        "request_succeeded": False,
        "validated": False,
        "analysis": None,
        "error": None,
    }
    if not settings.configured:
        record["error"] = "NEBIUS settings are missing."
        _write(evidence_dir / f"nebius-{image_arg.stem}-{stamp}.json", record, settings.api_key)
        print(json.dumps({"ok": False, "error": record["error"], "model_id": settings.model_id}))
        return 1
    try:
        client = NebiusVisionClient(settings)
        analysis, width, height = analyze_room_image(image_arg.read_bytes(), "image/jpeg", image_arg.name, client)
    except (ImageRejected, NebiusError, ModelOutputError) as exc:
        record["error"] = str(exc)
        _write(evidence_dir / f"nebius-{image_arg.stem}-{stamp}.json", record, settings.api_key)
        print(json.dumps({"ok": False, "error": str(exc)[:300], "model_id": settings.model_id}))
        return 1
    body = analysis.model_dump()
    body["prepared_image_pixels"] = {"width": width, "height": height}
    record["request_succeeded"] = True
    record["validated"] = True
    record["latency_ms"] = client.last_latency_ms
    record["token_usage"] = client.last_usage
    record["analysis"] = body
    path = evidence_dir / f"nebius-{image_arg.stem}-{stamp}.json"
    _write(path, record, settings.api_key)
    print(
        json.dumps(
            {
                "ok": True,
                "model_id": settings.model_id,
                "host": settings.base_host,
                "candidates": len(analysis.placement_candidates),
                "dimensions_mm": analysis.dimensions_mm,
                "evidence": str(path.relative_to(ROOT)).replace("\\", "/"),
            }
        )
    )
    return 0


def _write(path: Path, record: dict[str, object], secret: str) -> None:
    path.write_text(json.dumps(redact(record, secret), indent=2), encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
