"""Validate and resize a buyer photograph with OpenCV. Pixel size is not a room size."""

from __future__ import annotations

import cv2
import numpy as np

MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_EDGE_PX = 1280


class ImageRejected(Exception):
    def __init__(self, code: str, message: str, status_code: int) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


def _magic_kind(data: bytes) -> str | None:
    if data.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    return None


def prepare_room_image(data: bytes, content_type: str | None, filename: str | None) -> tuple[bytes, int, int]:
    if len(data) == 0:
        raise ImageRejected("EMPTY_IMAGE", "Choose a JPEG or PNG photograph.", 400)
    if len(data) > MAX_IMAGE_BYTES:
        raise ImageRejected("IMAGE_TOO_LARGE", "The photograph is larger than 8 MB.", 413)
    kind = _magic_kind(data)
    declared = (content_type or "").split(";", 1)[0].strip().lower()
    name = (filename or "").lower()
    declared_ok = declared in {"image/jpeg", "image/jpg", "image/png", "application/octet-stream", ""}
    suffix_ok = name.endswith((".jpg", ".jpeg", ".png")) or name == ""
    if kind is None or not declared_ok or (declared == "" and not suffix_ok):
        raise ImageRejected("UNSUPPORTED_IMAGE", "Upload a JPEG or PNG photograph.", 415)
    if declared == "image/png" and kind != "png":
        raise ImageRejected("UNSUPPORTED_IMAGE", "The file does not match a PNG photograph.", 415)
    if declared in {"image/jpeg", "image/jpg"} and kind != "jpeg":
        raise ImageRejected("UNSUPPORTED_IMAGE", "The file does not match a JPEG photograph.", 415)

    decoded = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if decoded is None:
        raise ImageRejected("UNSUPPORTED_IMAGE", "The photograph could not be read.", 415)
    height, width = decoded.shape[:2]
    if width < 32 or height < 32:
        raise ImageRejected("IMAGE_TOO_SMALL", "The photograph is too small to review.", 400)

    scale = min(1.0, MAX_EDGE_PX / max(width, height))
    if scale < 1:
        decoded = cv2.resize(
            decoded,
            (max(1, int(width * scale)), max(1, int(height * scale))),
            interpolation=cv2.INTER_AREA,
        )
    ok, encoded = cv2.imencode(".jpg", decoded, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
    if not ok:
        raise ImageRejected("UNSUPPORTED_IMAGE", "The photograph could not be prepared.", 415)
    prepared_height, prepared_width = decoded.shape[:2]
    return encoded.tobytes(), prepared_width, prepared_height
