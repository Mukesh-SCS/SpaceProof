# Attribution

SpaceProof is licensed under the Apache License 2.0. The full text is in the repository root `LICENSE` file.

## Catalog

The desks in `data/products.json` are fictional. The file does not use retailer trademarks or product photography.

## Room images

`eval/images/` contains ten original synthetic room diagrams drawn by `vision/scripts/make_eval_images.py` for this project. They are not photographs of real apartments and they do not encode physical millimeters. `web/public/samples/room-01-corner.jpg` is a copy of `eval/images/room-01-corner.jpg`.

No third-party room photographs are included.

## Model

Room proposals and shopping-request extraction call Nebius Token Factory with the vision-language model `nvidia/Nemotron-3.5-Super-VL`. The OpenAI-compatible base URL used in this workspace is `https://api.tokenfactory.us-north1.nebius.com/v1/`. Nebius and NVIDIA retain their own model and service terms. SpaceProof does not redistribute model weights.

A real response for `eval/images/room-01-corner.jpg` is stored, without credentials, in `eval/evidence/`. The model output is a placement suggestion. It is not a measurement.

## Libraries

Runtime dependencies include Next.js, React, Prisma, Tailwind CSS, FastAPI, OpenCV, and the OpenAI Python client used only as an HTTP client for Nebius. Their licenses stay with those projects.
