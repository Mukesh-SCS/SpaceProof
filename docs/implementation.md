# What is implemented

October 28, 2026. This note is a status record, not a claim that the hackathon demo is finished.

## Working locally

- Docker Compose PostgreSQL 16, Prisma migration `20261028180206_init`, and two seeded desks.
- `POST /api/assessments` runs the deterministic fit engine and stores a versioned `FitAssessment` with a policy fingerprint.
- `PATCH /api/rooms/{id}` increments the room version when a relevant measurement changes. An older assessment can no longer start or capture a payment.
- PayPal orders are created with `intent: AUTHORIZE` only after a current `FIT` assessment. Amounts come from the catalog.
- After buyer approval, `POST /api/paypal/orders/{id}/authorize` authorizes on the server and stores the authorization id only when a follow-up order read matches.
- `POST /api/paypal/orders/{id}/capture` reloads the product, room, assessment, consent, and fingerprint. A valid authorization is captured once. A stale assessment voids the authorization when PayPal confirms the void.
- `POST /api/paypal/orders/{id}/void` voids an uncaptured authorization.
- The Next.js page can show `FIT`, `DOES_NOT_FIT`, `UNCERTAIN`, and, after a real PayPal session, `AUTHORIZED`, `CAPTURED`, or `VOIDED`.
- FastAPI `/health` reports the installed OpenCV version and `"image_measurement": false`. `POST /measure` returns HTTP 501. `GET /contract` describes the future upload API and returns no dimensions.

## Verified without PayPal Sandbox

- Nook Desk, 100 cm wide, in a 150 cm room with 20 cm clearance and a $180 budget: `FIT`.
- Studio Desk, 140 cm wide, in a 100 cm room: `DOES_NOT_FIT` (`WIDTH_EXCEEDS_ROOM`). At the default $180 budget it is also `OVER_BUDGET`.
- Order creation for that failed assessment: HTTP 403 `NOT_ELIGIBLE`.
- After the room version changed, order creation for the old assessment: HTTP 403 `STALE_ASSESSMENT`.
- A `FIT` assessment with empty PayPal credentials: HTTP 503 `PAYPAL_NOT_CONFIGURED`. No successful payment was fabricated.

## Not verified

- No PayPal Sandbox order, authorization, capture, or void has been observed.
- Webhooks, photo upload, a vision-language model, and a catalog beyond two desks are not implemented.

## Next milestone

Room photo upload, a buyer-correctable placement region, structured vision output that cannot invent millimeters, and a larger desk catalog. Configure sandbox credentials before treating the payment path as demo-complete.
