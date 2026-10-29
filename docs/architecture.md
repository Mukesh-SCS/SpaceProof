# Architecture

SpaceProof keeps four decisions in different places. Nebius proposes. The geometry engine verifies. The buyer confirms. PayPal moves money only after the server agrees.

## Request path

1. The buyer uploads a JPEG or PNG, or loads the sample diagram, in the Next.js page.
2. Next.js rejects a file that is empty, over 8 MB, or not a JPEG or PNG, then forwards it to FastAPI.
3. FastAPI checks the file bytes again, resizes the long edge to at most 1280 pixels, and asks Nebius `nvidia/Nemotron-3.5-Super-VL` for a placement box. The call times out after 45 seconds and does not retry the provider automatically.
4. Pydantic drops any physical dimensions the model returns. `POST /measure` stays HTTP 501.
5. The buyer draws, moves, resizes, or clears the rectangle and types feet and inches. Those fractions are not converted into millimeters.
6. `POST /api/assessments` loads catalog millimeters and the confirmed room, then stores `FIT`, `DOES_NOT_FIT`, or `UNCERTAIN` with a policy fingerprint.
7. PayPal Sandbox order creation uses `intent: AUTHORIZE` and the catalog price. Capture reloads the same evidence. A material change voids an uncaptured authorization when PayPal confirms the void.

## Stored state

PostgreSQL, through Prisma, stores products, room versions, fit assessments, purchase intents, and payment transactions. Photographs are not stored. They live in the browser until the tab closes. A Render restart keeps the database and drops the in-memory request limiter.

## Hosted processes

| Process | URL | Role |
| --- | --- | --- |
| Next.js | https://spaceproof.onrender.com/ | Page, fit policy, PayPal |
| FastAPI | https://spaceproof-vision.onrender.com/health | Image check and Nebius |
| PostgreSQL | Render managed database | Catalog and ledger |

PayPal secrets and the Nebius key stay in service environment variables. The browser receives only the public sandbox client id.

## What is intentionally absent

Webhook signature verification is not implemented. There is no object storage, no shared rate-limit store, and no path that turns pixels into millimeters.
