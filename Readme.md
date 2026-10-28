# SpaceProof

**Verify before you pay.**

> **Status: local prototype, updated October 28, 2026.** Geometry, versioned fit assessments, photo proposals from Nebius, and the PayPal authorize / capture / void server flow are implemented. Two sandbox orders were created and read back as `CREATED`. Buyer approval, capture, and void have not been observed, because that step needs a sandbox buyer login. The vision service does not measure photographs.

SpaceProof is an AI-assisted transaction-verification system for someone buying a desk for a small apartment or home office. A recommendation is not a purchase decision. The buyer confirms room measurements, the server compares them with a trusted catalog, and PayPal Sandbox can authorize a payment only after that server records `FIT`. Before capture, the server reloads the catalog, the current room version, and the linked assessment. If that evidence changed, capture is refused and an outstanding authorization is voided.

SpaceProof does not guarantee that an object will physically fit. It checks the rectangular placement, clearance, budget, and catalog constraints it actually stored. It does not certify doorway, staircase, delivery, structural, or assembly clearance. It does not infer accurate dimensions from a photo.

## The problem

Online shoppers can judge a desk's appearance and price but still choose an item that does not fit a particular corner or leaves insufficient walking clearance. Product photos and conversational recommendations do not prove physical compatibility.

**Our question:** Can an AI shopping agent use visual scene understanding and explicit geometric constraints to reject unsuitable furniture before payment?

**Target user:** A person furnishing a small apartment or home office.

**MVP scenario:** Confirm a room, a clearance, and a budget, then accept only a desk the server marks `FIT`. The running demo defaults to 20 cm of side clearance and 20 cm of depth clearance so a 100 cm desk can pass in a 150 cm room. Clearance is an input, not a hidden assumption.

SpaceProof is **not** a guarantee that an object will fit based on a single photo. The MVP requires measurements, uses user-correctable placement boundaries, and returns `UNCERTAIN` when the evidence is insufficient. It validates the simple placement and clearance constraints it actually models; it does not certify doorway, staircase, delivery, structural, or assembly clearance.

## Why AI and PayPal are both essential

- **AI:** Interprets the natural-language request and room photo, proposes placement boundaries, extracts structured preferences, ranks eligible products, and explains trade-offs.
- **Deterministic geometry:** Checks product dimensions against a calibrated placement area, required clearance, and measurement uncertainty. The LLM cannot override a failed check.
- **PayPal:** Performs actual sandbox order creation, payer approval, authorization, capture, void, and reconciliation. The payment server refuses to capture if the approved SKU, price, assessment version, or user constraints have changed.

**Design principle:** *AI proposes. Geometry verifies. The buyer approves. PayPal authorizes. SpaceProof revalidates. PayPal captures or voids.*

```mermaid
flowchart TD
    A["AI selects a furniture item"] --> B["Server validates spatial fit, price and budget"]
    B --> C{"All constraints satisfied?"}
    C -->|"No / uncertain"| D["Block checkout or ask for clarification"]
    C -->|"Yes"| E["Customer approves PayPal purchase"]
    E --> F["PayPal authorizes payment"]
    F --> G{"Final validation passes?"}
    G -->|"Yes"| H["Capture payment"]
    G -->|"No"| I["Void authorization"]
```

The buyer approves PayPal **after** the initial fit check. The server authorizes that order, then revalidates before capture. An authorization is a temporary hold, **not escrow**, and it is not a completed payment. Sandbox currency is USD and no real money moves.

Orders are created with `intent: AUTHORIZE`. Capture and void use the Payments v2 authorization endpoints. Immediate Orders v2 `CAPTURE` is not the purchase flow.

## MVP scope

### Required

- [x] Photo upload and an editable placement rectangle. The sample diagram is an original drawing, not a measured apartment.
- [x] Buyer-entered width, depth, clearance, and budget. The photograph does not supply those numbers.
- [x] Nebius `nvidia/Nemotron-3.5-Super-VL` returns structured placement JSON. Physical dimensions are rejected.
- [x] Deterministic geometry for **rectangular desk placement areas**, using buyer-entered measurements.
- [x] Seed catalog of 12 fictional desks.
- [x] A natural-language request can propose a budget and clearance. The buyer must apply and confirm those values.
- [x] `FIT`, `DOES_NOT_FIT`, and `UNCERTAIN` decisions with reasons and a policy fingerprint.
- [x] Buyer review of the catalog SKU and price before PayPal approval.
- [ ] Real sandbox buyer approval. An authorize-intent order was created and read back. Capture and void of a live authorization were not observed.
- [ ] PayPal webhook verification.
- [x] Responsive interface with a 2D footprint, loading, error, and payment states. A receipt is shown only after a verified capture.
- [x] Automated geometry and payment-policy tests. PayPal is mocked.

### Explicitly out of scope

- Full single-image metric 3D reconstruction or universal furniture fitting.
- Unattended live-money purchases or stored payment methods.
- Checkout on behalf of unrelated retailers. Payments go only to the app's **demo PayPal sandbox merchant**.
- Automatic claims about shipping, delivery, refunds, or physical installation.
- A real inventory marketplace, multi-vendor payouts, or payment escrow.

## Technical architecture

```mermaid
flowchart TD
    U["Buyer: photo, measurement, constraints"] --> W["Next.js web application"]
    W --> V["FastAPI vision / OpenCV service"]
    V --> S["Versioned spatial scene and evidence"]
    W --> A["LLM agent: intent + recommendations"]
    S --> G["Deterministic fit / policy engine"]
    A --> G
    G -->|"Eligible + buyer approved"| P["Server-side PayPal integration"]
    P --> R["PayPal Sandbox"]
    R --> T["Verified payment state + receipt"]
    G --> D[("PostgreSQL")]
    P --> D
    T --> D
```

| Layer | Selected technology | Responsibility |
| --- | --- | --- |
| Frontend | Next.js, TypeScript, Tailwind CSS | Room workflow, comparison, buyer consent, receipt |
| Visual preview | Three.js or calibrated 2D canvas | Show the placement region and clearances |
| Computer vision | Python, FastAPI, OpenCV | Calibration, geometry extraction, measurement checks |
| Multimodal AI | Nebius Token Factory, `nvidia/Nemotron-3.5-Super-VL` | Scene interpretation and shopping-request extraction. It cannot set a price or a fit result. |
| Database | PostgreSQL with Prisma ORM | Catalog, scene versions, assessments, purchase and payment ledger |
| Payments | PayPal Sandbox Orders v2, Payments v2, webhooks | Buyer approval, authorize/capture/void, verification |
| Hosting | Render or equivalent | Web and vision services, managed PostgreSQL |

**Database hosting:** Supabase is **not required**. Supabase provides hosted PostgreSQL plus optional authentication, storage, and realtime features. SpaceProof initially needs ordinary PostgreSQL only. Use Docker PostgreSQL locally and a managed PostgreSQL provider such as Render for the hosted demo. Do not introduce Supabase Auth or Storage unless an actual requirement appears.

### Repository layout

`web/`, `vision/`, `data/`, `eval/`, `docker-compose.yml`, and `docs/` exist. The license is Apache-2.0. See `LICENSE`.

## Spatial verification contract

The fit engine in `web/src/lib/geometry/fit.ts` receives **server-trusted** product dimensions and **user-confirmed** room measurements. It does not use LLM-generated dimensions or browser prices.

```text
required_width = product_width + required_horizontal_clearance
required_depth = product_depth + required_depth_clearance

FIT only if every required constraint passes.
DOES_NOT_FIT if a reliable constraint fails.
UNCERTAIN if a required measurement is missing, invalid, or unconfirmed.
```

Lengths are integer millimeters. Money is integer cents. The desk is not rotated. `POST /api/assessments` returns the result, machine-readable reasons, a human explanation, the room version, and a policy fingerprint. A missing measurement is never treated as `FIT`.

The catalog has 12 fictional desks. The two used in the payment scenarios are:

| SKU | Size | Price |
| --- | --- | --- |
| `DESK-NOOK-100` | 100 cm wide, 55 cm deep | $129.00 |
| `DESK-STUDIO-140` | 140 cm wide, 70 cm deep | $219.00 |

Default room: 150 cm by 120 cm, 20 cm side clearance, 20 cm depth clearance, $180 budget. That makes the Nook desk `FIT` and the Studio desk `DOES_NOT_FIT`. A 100 cm room makes the Studio desk fail on width.

## Purchase and payment safety rules

1. The LLM must not directly call PayPal or control the amount sent to PayPal.
2. All money is represented as integer minor units, never JavaScript floating-point price arithmetic.
3. Prices, currency, product IDs, and availability are read from server-owned data.
4. A purchase intent stores the buyer-approved catalog amount, assessment, consent time, and policy fingerprint.
5. The server revalidates that intent before capture. On a material change, it refuses capture and voids an uncaptured authorization when PayPal confirms the void.
6. Create, authorize, capture, and void each use a stable `PayPal-Request-Id`.
7. A capture is recorded as completed only after `GET /v2/payments/captures/{id}` matches the catalog amount. Pending, denied, canceled, and unverified results are not completed payments.
8. Webhook signature verification is not implemented yet.
9. PayPal client secrets stay on the server. Do not commit `.env` files.
10. The demo uses sandbox funds only. An authorization is not escrow.

### PayPal endpoints

| Purpose | REST operation | In this prototype |
| --- | --- | --- |
| Create order | `POST /v2/checkout/orders` with `intent: AUTHORIZE` | Implemented |
| Authorize approved order | `POST /v2/checkout/orders/{order_id}/authorize` | Implemented |
| Capture authorization | `POST /v2/payments/authorizations/{authorization_id}/capture` | Implemented |
| Void authorization | `POST /v2/payments/authorizations/{authorization_id}/void` | Implemented. A 204 response is verified with a follow-up read. |
| Read back order | `GET /v2/checkout/orders/{order_id}` | Implemented |
| Read back authorization | `GET /v2/payments/authorizations/{authorization_id}` | Implemented |
| Read back capture | `GET /v2/payments/captures/{capture_id}` | Implemented |
| Verify webhook | `POST /v1/notifications/verify-webhook-signature` | Not implemented |

Sandbox API base: `https://api-m.sandbox.paypal.com`.

Official guides:

- [PayPal Checkout integration](https://developer.paypal.com/checkout/integrate/)
- [Authorize and capture later](https://developer.paypal.com/checkout/delay-capture/)
- [Void authorization](https://developer.paypal.com/checkout/void-authorized-payment/)
- [PayPal webhooks](https://developer.paypal.com/api/rest/webhooks/)

## Data model

Implemented in `web/prisma/schema.prisma` and migration `web/prisma/migrations/20261028180206_init`:

| Entity | Important fields |
| --- | --- |
| `Product` | `id`, `sku`, `title`, `widthMm`, `depthMm`, `heightMm`, `priceMinor`, `currency`, `available` |
| `RoomMeasurement` | width, depth, side clearance, depth clearance, budget, confirmation, `version` |
| `FitAssessment` | product, room, `measurementVersion`, result, reasons, explanation, `policyFingerprint` |
| `PurchaseIntent` | assessment, `approvedPriceMinor`, `buyerConsentAt`, `policyFingerprint`, status |
| `PaymentTransaction` | PayPal order, authorization, and capture IDs, provider status, ledger status, request IDs |

`WebhookEvent` and photo scenes are not stored yet. PayPal order, authorization, and capture IDs are unique.

## Local development

These commands were run on Windows 11 with Node.js 25.2.1, npm 11.6.2, Python 3.11.9, and Docker Desktop. `python` is not on PATH; use the `py` launcher or the virtualenv interpreter.

Prerequisites:

- Node.js and npm
- Python 3.11+ (`py -3.11` on this machine)
- Docker Desktop, with the engine running
- A PayPal Developer sandbox app if you want to approve a real sandbox payment

Copy `web/.env.example` to `web/.env`. The database URL in the example matches `docker-compose.yml`. Fill the PayPal values from the sandbox app. Leave secrets out of git.

```dotenv
DATABASE_URL=postgresql://spaceproof:local_dev_password@localhost:5432/spaceproof?schema=public
PAYPAL_ENVIRONMENT=sandbox
PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
PAYPAL_WEBHOOK_ID=
NEXT_PUBLIC_PAYPAL_CLIENT_ID=
VISION_SERVICE_URL=http://localhost:8000
```

Copy `vision/.env.example` to `vision/.env`:

```dotenv
NEBIUS_API_KEY=
NEBIUS_MODEL_ID=nvidia/Nemotron-3.5-Super-VL
NEBIUS_BASE_URL=https://api.tokenfactory.us-north1.nebius.com/v1
```

`NEXT_PUBLIC_PAYPAL_CLIENT_ID` is the public sandbox client id. It must be the same app as `PAYPAL_CLIENT_ID`. Never put `PAYPAL_CLIENT_SECRET` or `NEBIUS_API_KEY` in a `NEXT_PUBLIC_` variable. The Nebius key is read only by FastAPI.

Verified on October 28, 2026:

```powershell
# From the repository root. Docker Desktop must be running.
docker compose up -d postgres

# Web app
cd web
npm install
npx prisma migrate dev
npm run db:seed
npm test
npm run dev

# Vision service, from the repository root, in another terminal
cd vision
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m pytest
python -m uvicorn app.main:app --reload --port 8000
```

`npx prisma migrate dev` applied `20261028180206_init` and `20261028190753_scene_placement`. `npm run db:seed` loads 12 desks, including `DESK-NOOK-100` and `DESK-STUDIO-140`. On October 28, 2026, `npm test` passed 36 tests and vision `pytest` passed 14 tests. The vision health check returned OpenCV 5.0.0, `"image_measurement": false`, and model id `nvidia/Nemotron-3.5-Super-VL`.

`node_modules` and `vision/.venv` were already present, so `npm install` and virtualenv creation were not repeated on the last run. `pip install -r requirements.txt` installed FastAPI, Uvicorn, OpenCV, pytest, and the OpenAI client used to call Nebius. A fresh clone should still run the full command list above.

Open `http://localhost:3000`. Confirm the measurements, choose the 100 cm room, and check the Studio desk: the server returns `DOES NOT FIT` and checkout stays closed. The 150 cm room and the Nook desk can return `FIT`. PayPal then creates an authorize-intent order for the catalog price. Capture stays unavailable until a sandbox buyer approves that order and the server authorizes it. Unconfirmed measurements return `UNCERTAIN`.

## Acceptance tests

### Geometry

- [x] A desk wider than the room is rejected. Verified by unit test and by `POST /api/assessments` for a 140 cm desk in a 100 cm room.
- [x] A clearance violation is rejected.
- [x] A desk that satisfies the measured constraints is accepted. Verified for the 100 cm Nook desk in a 150 cm room.
- [x] Missing, invalid, or unconfirmed measurements return `UNCERTAIN`, not `FIT`.
- [x] A client-supplied price or fit result cannot override the catalog. A live order created after a claimed price of 100 cents was read back from PayPal as `USD 129.00`.
- [x] `POST /measure` still returns HTTP 501 and does not invent dimensions. Nebius proposals are validated and cannot set millimeters. A model failure returns an error and does not open checkout.

### PayPal

Automated tests mock PayPal. They do not prove a live sandbox payment.

- [x] `DOES_NOT_FIT` and `UNCERTAIN` do not call order creation. A live `POST /api/paypal/orders` for a failed assessment returned HTTP 403 `NOT_ELIGIBLE`.
- [x] A forged client price stays at the catalog amount. PayPal read orders `4JY697996K476130H` and `4T750388D0073720Y` as `USD 129.00` for `DESK-NOOK-100` after the client claimed 100 cents. A forged SKU returned HTTP 403 `SKU_MISMATCH` and created no order.
- [x] A changed room version blocks checkout. After `PATCH /api/rooms/{id}` moved a room from version 1 to version 2, order creation returned HTTP 403 `STALE_ASSESSMENT`.
- [x] Mocked tests cover authorization without capture, a single capture, a duplicate capture that does not call PayPal again, void of an uncaptured authorization, and canceled or declined results that are not completed.
- [x] Two `FIT` assessments created sandbox orders `4JY697996K476130H` and `4T750388D0073720Y`. Both were read back with intent `AUTHORIZE`, status `CREATED`, and amount `USD 129.00`.
- [ ] Buyer approval has not happened. Authorizing `4T750388D0073720Y` before approval returned HTTP 409 `NOT_APPROVED`. Two capture attempts returned HTTP 409 `NOT_AUTHORIZED` and were not sent to PayPal. No authorization id, capture id, or void has been observed.
- [ ] Webhooks are not implemented.

## Evaluation

`eval/images/` has ten original synthetic room diagrams from `vision/scripts/make_eval_images.py`. They are not photographs of measured rooms. `vision/scripts/run_eval.py` calls Nebius and writes `eval/results.json`.

On October 28, 2026, model `nvidia/Nemotron-3.5-Super-VL` returned a placement box for nine diagrams and no box for `room-03-plant`. Where a box existed, overlap with the painted open floor was 0.00, 0.33, 0.34, 0.36, 0.40, 0.43, 0.52, 0.56, and 0.64. Every accepted response had `dimensions_mm: null`. Buyer correction and a purchase decision were not recorded for these files. That overlap is not a physical-fit accuracy score.

A later single-image call on `eval/images/room-01-corner.jpg` succeeded in 3278 ms. PayPal was not involved. Reported usage was 935 prompt tokens, 1075 completion tokens, of which 779 were reasoning tokens, and 2010 total tokens. `dimensions_mm` stayed null. The redacted record is `eval/evidence/nebius-room-01-corner-20261028T195945Z.json`.

Still not measured: calibration error against a real room, false `FIT` rate on photographed apartments, and a completed sandbox capture.

## Build milestones and Cursor working instructions

### Milestone 1: October 28–29, feasibility

- [x] Scaffold the monorepo and local PostgreSQL. Migration `20261028180206_init` applied and both desks seeded.
- [x] Deterministic fit checker for one rectangular space and two desks.
- [ ] Actual PayPal Sandbox buyer approval and verified capture. Orders `4JY697996K476130H` and `4T750388D0073720Y` are still `CREATED`. The buyer has not approved either one.
- [x] Block order creation for a failed fit assessment. Verified with HTTP 403 `NOT_ELIGIBLE`.

**Exit gate still open:** one live fit → buyer approval → verified capture has not been observed.

### Milestone 2: spatial product

- [x] Room photo upload, buyer-entered measurements, and a user-correctable placement rectangle.
- [x] Nebius vision-language integration and Pydantic validation. The model does not supply millimeters.
- [x] Twelve fictional desks, with fit reasons from the geometry engine.
- [ ] A completed sandbox authorization, capture, or void. Buyer approval is still required.

### Milestone 3: November 4–7, payment lifecycle

The authorize, capture, and void code is in the app and covered by mocked tests. These items are not fully done:

- [ ] Live buyer approval against PayPal Sandbox.
- [x] Purchase intent, idempotency keys, and PayPal read-back in code. Webhook verification is not implemented.
- [x] Mocked tests for success, decline, cancel, duplicate capture, stale assessment, and void. Not a live sandbox integration test.

### Milestone 4: November 8–10, proof and polish

- [x] Ten original diagrams, one real Nebius run, and recorded overlap. Not a physical calibration study.
- [x] Responsive 2D placement preview, loading and error states, and explanations for fit and payment status. A capture receipt appears only after the server verifies a capture.
- [ ] Hosted demo using sandbox credentials.

### Milestone 5: November 11–12, submission

- [x] Apache-2.0 `LICENSE` is already at the repository root.
- [x] Setup and test commands in this README were run locally on October 28, 2026.
- [ ] Public hosted demonstration.
- [ ] Under-three-minute public YouTube video.
- [ ] Devpost project description.

**Submission deadline:** November 12, 2026, 3:00 PM EST (12:00 PM PST). The demo should remain free and available throughout judging, which ends December 15, 2026.

### Instructions for Cursor

1. Implement only the active milestone. Do not generate a sprawling marketplace or full 3D reconstruction.
2. Start with working API contracts, database migrations, tests, and one runnable happy path.
3. Use official current PayPal API documentation; never invent legacy SDK methods.
4. Keep all financial decisions and provider calls server-side; treat LLM outputs as untrusted proposals.
5. Write focused tests for each payment state transition and spatial decision.
6. Make small, reviewable commits; report commands run, test outcomes, assumptions and unresolved blockers.
7. Never claim a PayPal API call succeeded unless its real sandbox response was observed and checked.
8. Preserve and update this README as features move from planned to implemented.

## Hackathon submission links

- **Live demo:** Not deployed yet
- **Demo video:** Not recorded yet
- **Source:** https://github.com/Mukesh-SCS/SpaceProof
- **PayPal integration:** Sandbox orders `4JY697996K476130H` and `4T750388D0073720Y` were created and read back as authorize-intent, status `CREATED`, amount `USD 129.00`. Buyer approval, capture, and void are still pending.

## License and attribution

This project is licensed under the Apache License 2.0. The full text is in the top-level `LICENSE` file. Record model, dataset, image, and library licenses in `docs/ATTRIBUTION.md`. Use original or appropriately licensed images in the demo; do not include unlicensed third-party trademarks or copyrighted material.

## References

- [PayPal AI Hackathon official rules](https://paypalaihackathon.devpost.com/rules)
- [PayPal AI Hackathon resources](https://paypalaihackathon.devpost.com/resources)
- [PayPal developer documentation](https://developer.paypal.com/)
- [PayPal sandbox testing](https://developer.paypal.com/sandbox-testing/overview/)
- [Nebius Token Factory](https://docs.tokenfactory.nebius.com/)
- [Render PostgreSQL documentation](https://render.com/docs/postgresql)
