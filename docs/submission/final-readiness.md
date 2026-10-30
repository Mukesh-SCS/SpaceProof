# Submission readiness

October 30, 2026. This is not a claim that the entry is ready to submit.

| Requirement | Status | Evidence | Remaining action |
| --- | --- | --- | --- |
| Public GitHub repository | Present | https://github.com/Mukesh-SCS/SpaceProof | Push this review after you accept it. It is not pushed. |
| Open-source license | Present | Apache-2.0 `LICENSE` | None |
| Hosted demo | Present, sleeping when idle | https://spaceproof.onrender.com/ responded. Vision health returned ok after a cold start on October 30. | Keep the services awake during judging, or accept about a minute of wake time. |
| Nebius AI usage | Present | Health reports `nvidia/Nemotron-3.5-Super-VL`. Synthetic results are in `eval/results.json`. | Set `VISION_SERVICE_TOKEN` on both Render services before deploying the auth change, or paid routes will reject traffic. |
| Fit verification | Present | Geometry tests passed. The live catalog was listed on October 28. | None for the demo path. |
| PayPal authorization | Present in code and in one captured order | Authorization `93V392390C594062Y` is `CAPTURED`, which means it was authorized and then captured. | None for that historical order. |
| PayPal capture | Verified live | October 30 read-back: capture `66M90673NA362091J` is `COMPLETED`, USD 129.00. | None |
| PayPal void | Unverified live | No `VOIDED` authorization was read. Mocked tests pass. | Record a provider read-back of an uncaptured authorization after void, or leave the video narration honest. |
| API security | Implemented locally, not deployed | Server token, Postgres-backed web limiter, capped uploads. | Deploy only after the token and `prisma migrate deploy`. |
| Database availability | At risk | Owner reports free Postgres expiry on November 27, 2026. Render's free policy matches a 30-day lifetime. | Approve Option A or B in `docs/deployment/database-continuity.md` before November 27. |
| Automated tests | Unit tests passed | Web 71 tests, vision 28 tests, `tsc`, and `next build` passed on October 30. | Playwright launched no browser: the Chromium binary was not installed. That is not a product-assertion failure. Local Postgres was also stopped, so `prisma migrate deploy` was not applied locally. |
| Evaluation | Partial | Synthetic overlap and policy tests are measured. Real-room measurement is not. | Optional later study in `eval/final-evaluation.md`. Do not quote the overlap as centimeter accuracy. |
| README | Updated in this working tree | Describes the hosted app, feet and inches, and unimplemented webhooks. | Push with the rest of the review. |
| Devpost description | Draft only | `docs/submission/devpost.md` | Publish after the video and the database decision. |
| YouTube video | Pending | `docs/submission/demo-script.md` | The owner records it. No video was generated here. |
