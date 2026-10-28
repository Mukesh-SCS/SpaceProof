# SpaceProof

**Verify before you pay.**

> **Status: local prototype, verified October 28, 2026.** Geometry, versioned fit assessments, and the PayPal authorize / capture / void server flow are implemented. A live PayPal Sandbox buyer approval has not been observed, because this workspace has no sandbox credentials. The vision service does not measure photographs.

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

- [ ] Photo upload and editable placement-area selection.
- [ ] At least one explicit scale/reference measurement and the other dimensions required by the fit calculation.
- [ ] Vision-assisted scene/placement interpretation with structured output.
- [x] Deterministic geometry for **rectangular desk placement areas**, using buyer-entered measurements.
- [ ] Seed catalog of 12–20 demo desks. Two fictional desks are seeded.
- [ ] Natural-language budget and clearance constraints. The form accepts numbers directly.
- [x] `FIT`, `DOES_NOT_FIT`, and `UNCERTAIN` decisions with reasons and a policy fingerprint.
- [x] Buyer review of the catalog SKU and price before PayPal approval. The PayPal button stays hidden until sandbox credentials are set.
- [ ] Real sandbox order approval. Authorize, capture, and void are implemented and tested with mocks.
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
| Multimodal AI | Provider to be selected, structured JSON outputs | Scene interpretation, user intent, candidate explanations |
| Database | PostgreSQL with Prisma ORM | Catalog, scene versions, assessments, purchase and payment ledger |
| Payments | PayPal Sandbox Orders v2, Payments v2, webhooks | Buyer approval, authorize/capture/void, verification |
| Hosting | Render or equivalent | Web and vision services, managed PostgreSQL |

**Database hosting:** Supabase is **not required**. Supabase provides hosted PostgreSQL plus optional authentication, storage, and realtime features. SpaceProof initially needs ordinary PostgreSQL only. Use Docker PostgreSQL locally and a managed PostgreSQL provider such as Render for the hosted demo. Do not introduce Supabase Auth or Storage unless an actual requirement appears.

### Repository layout

`web/`, `vision/`, `data/`, `docker-compose.yml`, and `docs/` exist. `eval/` is still planned. The license is Apache-2.0. See `LICENSE`.

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

The current demo uses two fictional desks:

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
AI_PROVIDER_API_KEY=
```

`NEXT_PUBLIC_PAYPAL_CLIENT_ID` is the public sandbox client id. It must be the same app as `PAYPAL_CLIENT_ID`. Never put `PAYPAL_CLIENT_SECRET` in a `NEXT_PUBLIC_` variable.

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

`npx prisma migrate dev` created and applied `20261028180206_init` against PostgreSQL 16. `npm run db:seed` loaded `DESK-NOOK-100` and `DESK-STUDIO-140`. `npm test` passed 31 tests. Vision `pytest` passed 4 tests. `npx next build` compiled successfully. The vision health check returned OpenCV 5.0.0 and `"image_measurement": false`.

`node_modules` and `vision/.venv` were already present, so `npm install` and `py -3.11 -m venv .venv` were not repeated. `pip install -r requirements.txt` was run and installed FastAPI, Uvicorn, OpenCV, and pytest. A fresh clone should still run the full command list above.

Open `http://localhost:3000`. The 100 cm room button plus the Studio desk shows `DOES NOT FIT` and leaves checkout closed. The 150 cm room button plus the Nook desk shows `FIT`. Without sandbox credentials, the page explains that PayPal is not configured and does not show a successful payment.

## Acceptance tests

### Geometry

- [x] A desk wider than the room is rejected. Verified by unit test and by `POST /api/assessments` for a 140 cm desk in a 100 cm room.
- [x] A clearance violation is rejected.
- [x] A desk that satisfies the measured constraints is accepted. Verified for the 100 cm Nook desk in a 150 cm room.
- [x] Missing, invalid, or unconfirmed measurements return `UNCERTAIN`, not `FIT`.
- [x] A client-supplied price or fit result cannot override the catalog. Photo measurement is not an input.
- [ ] A vision or LLM failure path is not wired into checkout yet. `POST /vision/measure` returns HTTP 501 and does not invent dimensions.

### PayPal

Automated tests mock PayPal. They do not prove a live sandbox payment.

- [x] `DOES_NOT_FIT` and `UNCERTAIN` do not call order creation. A live `POST /api/paypal/orders` for a failed assessment returned HTTP 403 `NOT_ELIGIBLE`.
- [x] A forged client price stays at the catalog amount in the mocked create call. A forged SKU is rejected.
- [x] A changed room version blocks checkout. After `PATCH /api/rooms/{id}` moved a room from version 1 to version 2, order creation returned HTTP 403 `STALE_ASSESSMENT`.
- [x] Mocked tests cover authorization without capture, a single capture, a duplicate capture that does not call PayPal again, void of an uncaptured authorization, and canceled or declined results that are not completed.
- [ ] An eligible decision has not created a real sandbox order in this workspace. Credentials are empty, and the API returns HTTP 503 `PAYPAL_NOT_CONFIGURED` instead of a fake success.
- [ ] Authorization and capture IDs from PayPal Sandbox have not been observed.
- [ ] Webhooks are not implemented.

## Evaluation plan

Collect an original or properly licensed set of room photos with known measurements and product dimensions. Keep train/development examples separate from the held-out evaluation scenes.

Report at least:

1. Spatial calibration error against physical measurements.
2. False `FIT` approvals on genuinely incompatible product-scene pairs.
3. Correct rejection rate and `UNCERTAIN` / abstention rate.
4. Payment-policy violations blocked, duplicate-capture prevention, and end-to-end sandbox status reconciliation.

Provide labeled cases and a reproducible runner under `eval/`. **Do not invent accuracy, cost-savings, or transaction-success metrics.**

## Build milestones and Cursor working instructions

### Milestone 1: October 28–29, feasibility

- [x] Scaffold the monorepo and local PostgreSQL. Migration `20261028180206_init` applied and both desks seeded.
- [x] Deterministic fit checker for one rectangular space and two desks.
- [ ] Actual PayPal Sandbox buyer approval and verified capture. The code path exists; sandbox credentials were empty, so no live order was created.
- [x] Block order creation for a failed fit assessment. Verified with HTTP 403 `NOT_ELIGIBLE`.

**Exit gate still open:** one live fit → sandbox payment case has not been observed.

### Milestone 2: October 30–November 3, spatial product

This is the next milestone. Do not start it until a live sandbox authorization can be configured, or continue it in parallel only after that credential check is explicit.

- [ ] Room photo upload, reference measurements, user-correctable placement area.
- [ ] Vision model integration and structured output validation.
- [ ] Seed 12–20 desk products and show spatial eligibility with reasons.

### Milestone 3: November 4–7, payment lifecycle

The authorize, capture, and void code is in the app and covered by mocked tests. These items are not fully done:

- [ ] Live buyer approval against PayPal Sandbox.
- [x] Purchase intent, idempotency keys, and PayPal read-back in code. Webhook verification is not implemented.
- [x] Mocked tests for success, decline, cancel, duplicate capture, stale assessment, and void. Not a live sandbox integration test.

### Milestone 4: November 8–10, proof and polish

- [ ] Evaluation cases and repeatable metrics.
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
- **PayPal integration:** Sandbox code only. No sandbox transaction has been verified.

## License and attribution

This project is licensed under the Apache License 2.0. The full text is in the top-level `LICENSE` file. Record model, dataset, image, and library licenses in `docs/ATTRIBUTION.md`. Use original or appropriately licensed images in the demo; do not include unlicensed third-party trademarks or copyrighted material.

## References

- [PayPal AI Hackathon official rules](https://paypalaihackathon.devpost.com/rules)
- [PayPal AI Hackathon resources](https://paypalaihackathon.devpost.com/resources)
- [PayPal developer documentation](https://developer.paypal.com/)
- [PayPal sandbox testing](https://developer.paypal.com/sandbox-testing/overview/)
- [Render PostgreSQL documentation](https://render.com/docs/postgresql)
