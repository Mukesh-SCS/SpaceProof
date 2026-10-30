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

## Service token and request limits

`/analyze-room`, `/interpret-request`, and `/rank-products` require `Authorization: Bearer $VISION_SERVICE_TOKEN`. The same value is set on the Next.js server and the FastAPI server. It is not a `NEXT_PUBLIC_` variable. `/health` stays public and does not return the token or the Nebius key.

The Next.js routes count requests in the `ApiRateWindow` Postgres table: 20 vision calls and 10 order-creation calls per address per minute. A restart does not clear that table, and every web instance using the same database shares it. If the table cannot be updated, those routes return HTTP 503 instead of calling Nebius. The FastAPI process also keeps a 20-request memory window. That second window is lost on restart and is not shared across vision instances. The token is what stops an anonymous client from calling Nebius directly.

Uploads must declare a content length. Files over 8 MB, files that are not JPEG or PNG bytes, and images over 24 million pixels are rejected. The file is read in chunks and stopped at the byte cap. Nebius calls time out after 45 seconds and are not retried by the provider client. Model output is parsed before use. Dimensions and prices from the model are not trusted.

## What is intentionally absent

Webhook signature verification is not implemented. There is no object storage, and there is no path that turns pixels into millimeters. The Postgres limiter does not stop a caller who already has the service token and talks to FastAPI directly, beyond the per-process window.
