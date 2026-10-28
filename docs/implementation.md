# What is implemented

October 28, 2026. This note records what was observed. It is not a claim that capture or void has been completed in the PayPal sandbox.

## Working locally

- Docker Compose PostgreSQL 16. Migrations `20261028180206_init` and `20261028190753_scene_placement`. Twelve fictional desks are seeded.
- `POST /api/assessments` runs the deterministic fit engine and stores a versioned `FitAssessment`.
- A placement rectangle can be stored with the room. Moving it, or changing a confirmed measurement, increments the room version. The rectangle is not a source of millimeters.
- `PATCH /api/rooms/{id}` increments that version when a relevant measurement or placement coordinate changes.
- PayPal orders are created with `intent: AUTHORIZE` only after a current `FIT` assessment. Amounts come from the catalog.
- Authorize, capture, and void routes exist. Capture reloads the product, room, assessment, consent, and fingerprint. A stale assessment is coded to void an uncaptured authorization when PayPal confirms the void.
- FastAPI `POST /analyze-room` sends a JPEG to Nebius `nvidia/Nemotron-3.5-Super-VL`, validates the JSON with Pydantic, and returns normalized boxes. `dimensions_mm` stays null. `POST /measure` still returns HTTP 501.
- The page can upload a photo or load the sample diagram, edit a placement rectangle, confirm centimeters, check the twelve desks, and open PayPal only for a current `FIT`.
- If the model leaves a dollar amount or a single clearance blank, the service copies those numbers from the buyer's sentence and still requires confirmation. It does not turn them into a PayPal amount.

## Observed against PayPal Sandbox

Recorded in `eval/evidence/paypal-sandbox-20261028.json`. No secrets are in that file.

- OAuth succeeded. Sandbox app id `APP-5LW178562X8882401`.
- App order `4JY697996K476130H` for the Nook Desk was read back as `CREATED`, intent `AUTHORIZE`, `USD 129.00`, reference `DESK-NOOK-100`. The client had claimed a price of 100 cents and a result of `DOES_NOT_FIT`.
- Authorizing that order before buyer approval returned HTTP 409 `NOT_APPROVED`. Capture was not sent to PayPal. A second capture attempt returned the same refusal.
- A 140 cm desk in a 100 cm room returned `DOES_NOT_FIT`, and order creation returned HTTP 403 `NOT_ELIGIBLE` with no PayPal order id.
- After the room moved from version 1 to version 2, order creation for the old assessment returned HTTP 403 `STALE_ASSESSMENT`.

## Observed against Nebius

Model `nvidia/Nemotron-3.5-Super-VL` at `api.tokenfactory.us-north1.nebius.com`. The first call used a 700-token budget and returned empty text because those tokens were spent on reasoning. A later call with low reasoning effort and a larger token budget returned valid JSON. Evidence: `eval/evidence/nebius-room-01-corner-20261028T190832Z.json`. `dimensions_mm` was null.

`eval/results.json` records ten original diagrams. Nine produced a box. `room-03-plant` produced none. Intersection-over-union with the painted floor, where a box existed, was 0.00, 0.33, 0.34, 0.36, 0.40, 0.43, 0.52, 0.56, and 0.64. That number is overlap with a drawing, not a physical-fit score. Buyer correction and purchase validity were not recorded for those files.

## Not observed

- A sandbox buyer login, so no authorization id, capture id, or void of a live authorization.
- Webhook signature verification.
- A photograph of a measured apartment. The evaluation images are synthetic diagrams.
