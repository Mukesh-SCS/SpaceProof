# SpaceProof — Devpost draft

Do not publish this draft until the hosted demo, the video, and a live void are finished.

## Project

SpaceProof: Verify Before You Pay

A buyer shopping for a desk or a compact dining table confirms the usable floor area. Nebius proposes a placement region on the photograph. A deterministic checker decides whether that item fits the confirmed centimeters, clearance, and budget. PayPal Sandbox authorizes the catalog price. SpaceProof revalidates the same evidence before capture, and voids the authorization when the constraints no longer hold.

## Problem

Furniture that looks right online often does not fit the corner it was bought for. A chat reply or a product photo cannot safely approve the charge. The buyer needs to see the checked constraints before money moves, and the payment should stop if those constraints change.

## Who it is for

Someone buying one piece of small-space furniture for a measured opening: a desk or a compact dining table. SpaceProof is a demo merchant, not a multi-store marketplace.

## What is different

The model may suggest where to place the item and what the buyer asked for. It cannot set a millimeter, a price, or a fit result. The server owns those decisions. PayPal authorization is a temporary hold. Capture happens only after the stored assessment still matches the room, the product, and the catalog price.

## Architecture

Next.js holds the buyer flow, the fit policy, and the PayPal calls. FastAPI and OpenCV prepare the photograph. Nebius Token Factory model `nvidia/Nemotron-3.5-Super-VL` returns a placement region and a shopping interpretation. PostgreSQL stores the catalog, the room version, the FitPass assessment, and the payment ledger.

## PayPal APIs used

Sandbox only.

- Orders v2, intent `AUTHORIZE`
- Payments v2 authorization capture
- Payments v2 authorization void, implemented and covered by mocked tests

Observed on October 28, 2026: order `8NN90589CS658724M`, authorization `93V392390C594062Y`, capture `66M90673NA362091J`, status `COMPLETED`, USD 129.00, SKU `DESK-NOOK-100`. A live void of an uncaptured authorization has not been observed. Webhooks are not implemented.

## Nebius

One recorded call on a synthetic diagram returned a placement box, null dimensions, 3278 ms, and 2010 tokens. The ten-diagram overlap scores are visual overlap with painted floors, not physical accuracy. A licensed real-room evaluation set has not been built.

## Limitations

- The photograph is not a measurement.
- FitPass is a record of checked constraints, not a guarantee that the item will fit a real room.
- Delivery, doorways, and installation are not checked.
- The public demo and the demo video are not finished.
- Live void and webhook verification are not finished.

## Setup

See the repository README. Local PostgreSQL comes from Docker Compose. PayPal and Nebius secrets stay in uncommitted `.env` files. Do not deploy live PayPal credentials.
