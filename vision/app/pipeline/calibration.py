"""Placeholder for a future calibration pipeline.

Milestone 1 does not estimate physical dimensions from photographs.
Calling this module is an error, not a guess.
"""


def estimate_dimensions_from_image(image_bytes: bytes) -> None:
    del image_bytes
    raise NotImplementedError(
        "Image measurement is not implemented. SpaceProof never infers accurate physical dimensions from a photo."
    )
