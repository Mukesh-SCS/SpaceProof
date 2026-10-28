# SpaceProof

**See the space. Verify the fit. Pay with confidence.**

> **Status: In development for the PayPal AI Hackathon (2026).** This README is the implementation specification and build checklist. Features, test results, transaction IDs, and demo links must not be described as completed until they are verified.

SpaceProof is an AI-assisted spatial commerce application that helps people buying furniture for small spaces. It interprets a photo of a room, combines it with user-confirmed measurements, compares furniture against geometric and budget constraints, and enables a buyer-approved **PayPal Sandbox** purchase only after a server-side validation succeeds.

## The problem

Online shoppers can judge a desk's appearance and price but still choose an item that does not fit a particular corner or leaves insufficient walking clearance. Product photos and conversational recommendations do not prove physical compatibility.

**Our question:** Can an AI shopping agent use visual scene understanding and explicit geometric constraints to reject unsuitable furniture before payment?

**Target user:** A person furnishing a small apartment or home office.

**MVP scenario:** "Find a desk under $180 for this corner and preserve at least 80 cm of walking space."

SpaceProof is **not** a guarantee that an object will fit based on a single photo. The MVP requires measurements, uses user-correctable placement boundaries, and returns `UNCERTAIN` when the evidence is insufficient. It validates the simple placement and clearance constraints it actually models; it does not certify doorway, staircase, delivery, structural, or assembly clearance.

## Why AI and PayPal are both essential

- **AI:** Interprets the natural-language request and room photo, proposes placement boundaries, extracts structured preferences, ranks eligible products, and explains trade-offs.
- **Deterministic geometry:** Checks product dimensions against a calibrated placement area, required clearance, and measurement uncertainty. The LLM cannot override a failed check.
- **PayPal:** Performs actual sandbox order creation, payer approval, authorization, capture, void, and reconciliation. The payment server refuses to capture if the approved SKU, price, assessment version, or user constraints have changed.

**Design principle:** *AI proposes. Geometry verifies. The buyer approves. PayPal processes.*

## End-to-end purchase flow

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

The buyer approves PayPal **after** the initial fit check. Final validation handles changes or stale assessments after the approval step. An authorization is a temporary hold, **not escrow**. Sandbox currency is USD and no real money moves.

For the earliest integration milestone, a basic buyer-approved Orders v2 `CAPTURE` flow may be used to prove connectivity. Replace it with the documented `AUTHORIZE` → `capture` / `void` flow before claiming the full conditional payment experience.

## MVP scope

### Required

- [ ] Photo upload and editable placement-area selection.
- [ ] At least one explicit scale/reference measurement and the other dimensions required by the fit calculation.
- [ ] Vision-assisted scene/placement interpretation with structured output.
- [ ] Deterministic geometry for **rectangular desk placement areas**.
- [ ] Seed catalog of 12–20 demo-merchant desks with authoritative dimensions and prices.
- [ ] Natural-language budget and clearance constraints.
- [ ] `FIT`, `DOES_NOT_FIT`, and `UNCERTAIN` decisions with reasons and evidence.
- [ ] Buyer review of exact SKU, price, and constraints before PayPal approval.
- [ ] Real sandbox order approval, authorization, capture, and void paths.
- [ ] PayPal status readback and verified, idempotent webhook processing.
- [ ] Evidence-linked receipt and accessible responsive interface.
- [ ] Automated geometry, payment-policy, and integration tests.

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

### Proposed repository structure (Cursor should create it)

```text
spaceproof/
├── README.md
├── LICENSE                       # Add an OSI-approved open-source license
├── .gitignore
├── docker-compose.yml            # Local PostgreSQL
├── web/                          # Next.js + TypeScript + Tailwind
│   ├── src/app/
│   ├── src/lib/geometry/
│   ├── src/lib/paypal/
│   ├── src/lib/policy/
│   ├── src/lib/db/
│   ├── prisma/schema.prisma
│   └── .env.example
├── vision/                       # FastAPI + OpenCV
│   ├── app/main.py
│   ├── app/pipeline/
│   ├── requirements.txt
│   └── .env.example
├── data/                          # Clearly labeled demo catalog and licensed test images
├── eval/                          # Labeled measurements and evaluation scripts
└── docs/                          # Architecture, API contracts, test and demo instructions
```

This structure is planned and may be refined when the first implementation is scaffolded.

## Spatial verification contract

The fit engine receives **server-trusted** product dimensions and **user-confirmed** room measurements. It does not use LLM-generated dimensions as ground truth.

For each candidate desk, check at minimum:

```text
required_width = product_width + required_horizontal_clearance
required_depth = product_depth + required_depth_clearance

FIT only if:
  required_width <= conservative_available_width
  AND required_depth <= conservative_available_depth
  AND budget, item identity and stock constraints pass

DOES_NOT_FIT if a reliable constraint is violated.
UNCERTAIN if the measurement, scene boundary or catalog evidence is insufficient.
```

For measurements expressed as an interval, use the conservative lower bound to approve a fit. Product rotation is disabled in the initial MVP unless explicitly modeled. The engine must return structured reasons rather than just a confidence number.

Example response shape (proposed, not yet implemented):

```json
{
  "productId": "DESK-003",
  "sceneVersion": 4,
  "assessment": "FIT",
  "availableWidthCm": { "min": 137, "max": 141 },
  "requiredWidthCm": 130,
  "reasons": ["Required width is below the conservative available width"],
  "requiresUserConfirmation": true
}
```

## Purchase and payment safety rules

1. The LLM must not directly call PayPal or control the amount sent to PayPal.
2. All money is represented as integer minor units, never JavaScript floating-point price arithmetic.
3. Prices, currency, merchant identity, product IDs and stock are read from server-owned data.
4. Create a payment intent tied to the buyer-approved product, amount, assessment version and policy fingerprint.
5. Revalidate this exact intent before authorization settlement. On material change, refuse capture and void an existing uncaptured authorization where permitted.
6. Use stable `PayPal-Request-Id` values for retried operations and prevent duplicate capture/void attempts.
7. Verify webhook signatures, deduplicate events, and reconcile the transaction status directly with PayPal after ambiguous outcomes.
8. Never label `PENDING`, `DENIED`, or an unverified client callback as `COMPLETED`.
9. Keep PayPal client secrets and AI keys on the server. Do not commit `.env` files or sandbox test-buyer credentials.
10. The hosted demo uses only sandbox funds and a demo merchant; disclose this clearly.

### PayPal endpoints to implement

| Purpose | REST operation |
| --- | --- |
| Create order | `POST /v2/checkout/orders` with `intent: AUTHORIZE` |
| Authorize approved order | `POST /v2/checkout/orders/{order_id}/authorize` |
| Capture authorization | `POST /v2/payments/authorizations/{authorization_id}/capture` |
| Void authorization | `POST /v2/payments/authorizations/{authorization_id}/void` |
| Read back order | `GET /v2/checkout/orders/{order_id}` |
| Read back capture | `GET /v2/payments/captures/{capture_id}` |
| Verify webhook | `POST /v1/notifications/verify-webhook-signature` |

Sandbox API base: `https://api-m.sandbox.paypal.com`.

Official guides:

- [PayPal Checkout integration](https://developer.paypal.com/checkout/integrate/)
- [Authorize and capture later](https://developer.paypal.com/checkout/delay-capture/)
- [Void authorization](https://developer.paypal.com/checkout/void-authorized-payment/)
- [PayPal webhooks](https://developer.paypal.com/api/rest/webhooks/)

## Data model (proposed)

| Entity | Important fields |
| --- | --- |
| `Product` | `id`, `sku`, `title`, `widthMm`, `depthMm`, `heightMm`, `priceMinor`, `currency`, `stock` |
| `RoomScene` | `id`, `imageRef`, `version`, `placementPolygon`, `createdAt` |
| `Measurement` | `sceneId`, `referenceType`, `widthMinMm`, `widthMaxMm`, `depthMinMm`, `depthMaxMm`, `confirmedByUser` |
| `FitAssessment` | `id`, `sceneVersion`, `productId`, `result`, `reasons`, `evidenceDigest` |
| `PurchaseIntent` | `id`, `assessmentId`, `productId`, `priceMinor`, `currency`, `consentAt`, `policyDigest`, `state` |
| `PaymentTransaction` | `intentId`, `paypalOrderId`, `authorizationId`, `captureId`, `providerStatus`, `lastCheckedAt` |
| `WebhookEvent` | `paypalEventId`, `eventType`, `verifiedAt`, `processedAt` |

Enforce unique identifiers on PayPal provider resources and webhook events to support safe retries and deduplication.

## Local development (instructions to complete during scaffolding)

Prerequisites:

- Node.js compatible with the selected Next.js release, npm
- Python 3.11+ and pip
- Docker / Docker Compose, or a locally running PostgreSQL instance
- PayPal Developer Sandbox app and separate sandbox buyer / business accounts
- An AI model provider key if required by the chosen vision-language model

Cursor should create `.env.example` files with variable **names only**, not real secrets. The web server will require approximately:

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

`NEXT_PUBLIC_PAYPAL_CLIENT_ID` is the public sandbox client identifier; **never** expose `PAYPAL_CLIENT_SECRET` or API keys through `NEXT_PUBLIC_` variables.

After Cursor has generated `docker-compose.yml`, the Next.js and FastAPI applications, and migration scripts, document verified commands here. Intended workflow:

```bash
docker compose up -d postgres

# Terminal 1: Python vision service
cd vision
python -m venv .venv
# Activate .venv using the command appropriate for your OS
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Terminal 2: Next.js
cd web
npm install
npx prisma migrate dev
npm run dev
```

> These commands are **planned setup instructions**, not yet verified against a completed repository. Update them after the first successful local run. Include Windows-specific activation notes if targeting judges on Windows.

## Acceptance tests

### Geometry and AI

- [ ] A desk wider than the usable placement area is rejected.
- [ ] A desk that violates a required walkway clearance is rejected.
- [ ] A desk satisfying all measured constraints is accepted.
- [ ] Missing scale/reference information yields `UNCERTAIN`, not `FIT`.
- [ ] A vision/LLM failure cannot force a purchase-eligible outcome.
- [ ] LLM-generated price or product identifiers cannot override catalog records.

### PayPal

- [ ] Incompatible and uncertain decisions cause **zero** order creation requests.
- [ ] An eligible decision creates a real sandbox order and prompts buyer approval.
- [ ] Correct authorization ID is stored after approval.
- [ ] Matching, fresh intent captures only once; the resulting status is verified with PayPal.
- [ ] Changed SKU, amount, or assessment blocks capture; uncaptured authorization is voided where applicable.
- [ ] Canceled, failed, pending, and duplicate operations are handled correctly.
- [ ] Replayed or invalid-signature webhooks do not change the payment ledger.

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

- [ ] Scaffold the monorepo and local PostgreSQL.
- [ ] Implement a deterministic fit checker for one rectangular space and two desks.
- [ ] Complete an actual PayPal Sandbox buyer-approved order and verified capture.
- [ ] Block order creation for a failed fit assessment.

**Exit gate:** One fit → payment case and one no-fit → no-payment case run locally with actual sandbox evidence.

### Milestone 2: October 30–November 3, spatial product

- [ ] Room photo upload, reference measurements, user-correctable placement area.
- [ ] Vision model integration and structured output validation.
- [ ] Seed 12–20 desk products and show spatial eligibility with reasons.

### Milestone 3: November 4–7, payment lifecycle

- [ ] `AUTHORIZE` → `capture` / `void` and buyer approval flow.
- [ ] Immutable purchase intent, idempotency, webhook verification, PayPal status readback.
- [ ] Integration tests covering success and failures.

### Milestone 4: November 8–10, proof and polish

- [ ] Evaluation cases and repeatable metrics.
- [ ] Responsive placement preview, loading states, clear explanations, accessible UI.
- [ ] Hosted demo using sandbox credentials and safe test access.

### Milestone 5: November 11–12, submission

- [ ] Public open-source GitHub repository with detectable top-level `LICENSE`.
- [ ] Real, verified setup instructions and test commands in this README.
- [ ] Public hosted demonstration or complete runnable instructions.
- [ ] Under-three-minute public YouTube video showing the application functioning.
- [ ] Devpost project description, architecture, tools, limitations and measured results.

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
- **Source:** Add the public GitHub repository URL
- **PayPal integration:** Sandbox only

## License and attribution

Add a top-level `LICENSE` before submitting (MIT is a reasonable choice if all included code and assets permit it). Record model, dataset, image and library licenses in `docs/ATTRIBUTION.md`. Use original or appropriately licensed images in the demo; do not include unlicensed third-party trademarks or copyrighted material.

## References

- [PayPal AI Hackathon official rules](https://paypalaihackathon.devpost.com/rules)
- [PayPal AI Hackathon resources](https://paypalaihackathon.devpost.com/resources)
- [PayPal developer documentation](https://developer.paypal.com/)
- [PayPal sandbox testing](https://developer.paypal.com/sandbox-testing/overview/)
- [Render PostgreSQL documentation](https://render.com/docs/postgresql)
