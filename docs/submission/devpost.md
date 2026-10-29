# SpaceProof — Devpost draft

Do not publish this until the owner records the video and confirms the Render Postgres plan will last through December 15, 2026.

## Project

SpaceProof: Verify Before You Pay

A product can look perfect in a photo but still fail a buyer's actual constraints. SpaceProof connects an editable AI suggestion to a verified purchase decision.

## Problem

Someone buying a desk or a compact dining table can see the style and the price and still order an item that does not fit the corner, leaves no walking room, or costs more than they meant to spend. A chat reply cannot safely approve the charge.

## Who it is for

A person furnishing one measured opening in a small apartment or home office. SpaceProof is a demo merchant, not a multi-store marketplace.

## What is different

Nebius `nvidia/Nemotron-3.5-Super-VL` proposes a placement region and can read a shopping sentence. It does not measure the photograph, set a price, or return `FIT`. The server compares catalog millimeters with the buyer's confirmed feet and inches, clearance, and budget. PayPal Sandbox creates an `AUTHORIZE` order for the catalog price. Capture happens only after that evidence is checked again. If the room changed, the server voids the uncaptured authorization when PayPal confirms the void.

## Try it

- App: https://spaceproof.onrender.com/
- Vision health: https://spaceproof-vision.onrender.com/health
- Source: https://github.com/Mukesh-SCS/SpaceProof

Use Sample room if you do not have a photograph. The sample is a drawing. Enter or confirm feet and inches yourself. PayPal stays closed until the server stores `FIT`.

## PayPal APIs used

Sandbox only.

- Orders v2, intent `AUTHORIZE`
- Payments v2 authorization capture
- Payments v2 authorization void

Observed and stored: order `8NN90589CS658724M`, authorization `93V392390C594062Y`, capture `66M90673NA362091J`, status `COMPLETED`, USD 129.00, SKU `DESK-NOOK-100`. The repository does not contain a PayPal read-back of a void. Mocked tests cover void. Webhooks are not implemented.

## Nebius

One recorded call on `eval/images/room-01-corner.jpg` returned a placement box, null dimensions, 3278 ms, and 2010 tokens. Ten synthetic diagrams are scored by overlap with painted floors in `eval/results.json`. That overlap is not physical accuracy.

## Limitations

- The photograph is not a measurement.
- FitPass records checked constraints. It does not guarantee that furniture will fit a real room.
- Delivery, doorways, and installation are not checked.
- The demo video is not recorded.
- A free Render Postgres database expires 30 days after creation. Confirm the plan before judging.
