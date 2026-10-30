# Production audit

Reviewed October 28, 2026 from the repository and from the public URLs. No new PayPal approval was sent.

On October 30, 2026 the in-memory web limiter described below was replaced. The public Next.js routes now count in Postgres (`ApiRateWindow`), and the paid vision routes require `VISION_SERVICE_TOKEN`. See `docs/architecture.md`. The October 28 notes are kept as the record of what was found then.

## Hosted checks

| Check | Result |
| --- | --- |
| https://spaceproof.onrender.com/ | Responded. The page listed demo desks, including Mini Desk and Slim Desk, in feet and inches. |
| https://spaceproof-vision.onrender.com/health | `status: ok`, OpenCV 5.0.0, `image_measurement: false`, Nebius configured, model `nvidia/Nemotron-3.5-Super-VL`. |
| Which git commit Render is serving | Not visible from the public page. |
| Render Postgres plan and creation date | Not visible. See the hosting finding below. |
| Secrets in `git ls-files` | No `.env` file is tracked. |

## Findings

### High: the web upload proxy accepted a body before checking it

The page checked type and size, and FastAPI checked magic bytes, but `POST /api/vision/analyze` forwarded any multipart file. A direct caller could send a non-image or a large body through the Next.js process.

**Resolution:** the route now rejects a declared body over 8 MB before parsing, then rejects an empty file, a non-JPEG/PNG content type, or a file over 8 MB. FastAPI still checks the bytes.

### High: a Nebius call could hang the vision worker

`NebiusVisionClient` constructed the OpenAI client with no timeout. Next.js also waited on the vision fetch with no timeout.

**Resolution:** the provider client uses a 45 second timeout and `max_retries=0`. The Next.js proxy aborts vision fetches after 50 seconds. The buyer can still draw a placement area. The page already says an AI failure does not invent a measurement.

### High: vision and order creation had no request limit

Nothing slowed repeated calls to Nebius or PayPal order creation.

**Resolution:** each web process allows 20 vision analyze, preference, or rank requests per address per minute, and 10 order-creation requests. FastAPI allows 20 requests per bucket per address per minute. The counters are in memory. A restart clears them, and a second instance does not share them. That is recorded as a remaining limitation, not a Redis design.

### Medium: a vision outage said the service was on port 8000

That text is true for local development and false on Render.

**Resolution:** the proxy now says the vision service could not be reached and that the buyer can draw the area.

### Medium: payment words were provider codes

The panel showed `AUTHORIZED`, `CAPTURED`, and `VOIDED` without the buyer labels requested for the demo.

**Resolution:** the panel now leads with Awaiting approval, Authorized, Captured, Voided, Cancelled, or Declined, and still shows the PayPal status code. A blocked product is labeled Not eligible. Checkout still opens only after the existing server eligibility check.

### Medium: an AI rectangle and a buyer rectangle used the same solid outline

The label already said which one it was. The outline did not.

**Resolution:** an AI suggestion is a dashed outline. A buyer edit is a solid teal outline. Confirming the area marks it as the buyer selection.

### Low: stored explanations still name millimeters

The cards, bars, and confirmation sentence use feet and inches. The stored explanation still says, for example, that the desk is 1400 mm wide. That text is the assessment record. It was left unchanged so the fit decision and its existing tests stay the same.

### Low: feet and inches keep two-decimal remainders

1000 mm displays as 3 ft 3.37 in, and 200 mm of clearance displays as 7.87 in. Those strings match the stored millimeters at 25.4 mm per inch. Rounding to the nearest inch would disagree with the stored value. The display is not written back unless the buyer changes the field. Left as is.

### Accepted: photographs are not durable

Rooms, assessments, and payments are in PostgreSQL. The photograph and the unsaved rectangle are in the browser. A refresh or a Render restart removes that picture. Completed payments stay in the ledger. Adding object storage would be a new subsystem and was not added.

### Accepted: webhook verification is not implemented

Capture and void still depend on the server calling PayPal and reading the result back. A webhook cannot currently move the ledger.

### Hosting: a free Render Postgres database expires before judging ends

Render's published policy expires a free Postgres database 30 days after creation, then deletes it after a 14-day grace period unless it is upgraded. This database already exists on October 28, 2026, so a free database created on or before that date expires on or before November 27, 2026. Judging runs through December 15, 2026. The public site does not show the plan or the creation date, so this is conditional: it applies if the database is on the free plan.

**Smallest paid option, not purchased:** Render Postgres compute `0.1c-256mb` at $6 per month, 256 MB RAM, from the Render pricing page checked on October 28, 2026. Upgrading removes the 30-day expiration. Owner approval is required. Nothing was upgraded.

Free web services also sleep after about 15 minutes. The first request after sleep can take about a minute. That is a demo limitation, not a code defect.

## Not changed

PayPal authorize, capture, and void logic, catalog prices, the Nebius model id, the Prisma models, and the fit formulas were not changed.
