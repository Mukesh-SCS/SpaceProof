# Final evaluation

October 28, 2026. This file separates automated tests, stored sandbox observations, and synthetic image runs. It does not add a physical measurement study.

## 1. Automated tests

Commands run on this machine after the audit fixes:

- `npm test` in `web/`: 14 files, 69 tests, all passed.
- `python -m pytest` in `vision/`: 20 tests, all passed.

These tests mock PayPal and Nebius. They are not live transactions.

| Case | Where it is covered | Result in this run |
| --- | --- | --- |
| Supported image, invalid image, oversized image | `vision/tests/test_analyze.py`, `web/src/lib/uploads.test.ts` | Passed |
| Valid placement JSON, invalid JSON, timeout-style provider error | `vision/tests/test_analyze.py` | Passed |
| Redraw, move, resize, clear | `web/src/lib/placement-session.test.ts` | Passed |
| Replacing the photograph blocks checkout | `web/src/lib/scene-freshness.test.ts` | Passed |
| Missing or unconfirmed measurements | `web/src/lib/geometry/fit.test.ts` | Passed |
| Fits, exceeds the room, clearance, budget | `web/src/lib/geometry/fit.test.ts` | Passed |
| A measurement edit invalidates the scene | `web/src/lib/imperial.test.ts`, `web/src/lib/scene-freshness.test.ts` | Passed |
| 25.4 mm per inch and 304.8 mm per foot | `web/src/lib/imperial.test.ts` | Passed |
| Unfit or uncertain checkout stays closed | `web/src/lib/paypal/orders.test.ts` | Passed |
| Eligible order uses the catalog price and `AUTHORIZE` | `web/src/lib/paypal/orders.test.ts`, `web/src/lib/paypal/gateway.test.ts` | Passed |
| Capture only after revalidation | `web/src/lib/paypal/orders.test.ts` | Passed |
| Changed constraints void instead of capture | `web/src/lib/paypal/orders.test.ts` | Passed |
| Duplicate capture does not call PayPal again | `web/src/lib/paypal/orders.test.ts` | Passed |
| Cancel, decline, and provider failure are not completed payments | `web/src/lib/paypal/orders.test.ts`, `web/src/lib/policy/checkout.test.ts` | Passed |

Representative stored inputs, checked by those tests:

| Space | Product | Expected |
| --- | --- | --- |
| 1500 mm by 1200 mm, 200 mm clearance, $180 | `DESK-NOOK-100`, 1000 mm by 550 mm, $129.00 | `FIT` |
| Same room | `DESK-STUDIO-140`, 1400 mm by 700 mm, $219.00 | `DOES_NOT_FIT` on width and budget |
| 1000 mm wide room | `DESK-STUDIO-140` | `DOES_NOT_FIT` on width |
| Confirmed room, budget below the price | Any catalog item over the budget | `DOES_NOT_FIT` |
| Unconfirmed or blank measurement | Any item | `UNCERTAIN` |
| Dining table with no chair clearance | Catalog dining table | `UNCERTAIN` |

Display of the default room is 4 ft 11.06 in by 3 ft 11.24 in. Nook Desk displays as 3 ft 3.37 in by 1 ft 9.65 in. The fit engine uses the integer millimeters, not those display strings.

## 2. Live PayPal Sandbox observations

Stored in `eval/evidence/`. No new approval was made for this report.

Successful purchase:

- Order `8NN90589CS658724M`, intent `AUTHORIZE`, amount USD 129.00, reference `DESK-NOOK-100`, status `COMPLETED`.
- Authorization `93V392390C594062Y`, status `CAPTURED`.
- Capture `66M90673NA362091J`, status `COMPLETED`, `final_capture: true`, USD 129.00.
- A second capture request returned that same capture id.
- Evidence file: `eval/evidence/paypal-sandbox-capture-20261028T2007Z.json`.

Blocked purchase attempts, from `eval/evidence/paypal-sandbox-20261028.json` and `docs/implementation.md`:

- A failed fit returned HTTP 403 `NOT_ELIGIBLE` and no PayPal order id.
- A client-claimed price of 100 cents was read back as USD 129.00 on orders `4JY697996K476130H` and `4T750388D0073720Y`.
- Authorizing `4T750388D0073720Y` before approval returned HTTP 409 `NOT_APPROVED`.
- After a room moved from version 1 to version 2, the old assessment returned HTTP 403 `STALE_ASSESSMENT`.

No file in `eval/evidence/` records a void of an uncaptured authorization. The owner reports that a void was tested. That report is not a stored provider response, so this document does not treat it as observed.

## 3. Synthetic image experiments

`eval/images/` has ten original diagrams from `vision/scripts/make_eval_images.py`. They are not photographs of measured rooms. `eval/results.json` records one Nebius batch at `2026-10-28T19:09:23Z`.

| Image | Overlap with the painted floor |
| --- | --- |
| room-01-corner | 0.3403 |
| room-02-window | 0.5172 |
| room-03-plant | no box |
| room-04-narrow | 0.3559 |
| room-05-alcove | 0.56 |
| room-06-shelf | 0.4345 |
| room-07-bright | 0.0 |
| room-08-side | 0.3983 |
| room-09-low | 0.6364 |
| room-10-emptyish | 0.329 |

Every stored response has `dimensions_mm: null`. The batch file does not record per-image latency. Buyer correction and a purchase decision were not recorded for these files.

## 4. Actual room photographs

None are in the repository. No physical accuracy number is claimed.

## One measured Nebius call

`eval/evidence/nebius-room-01-corner-20261028T195945Z.json`: success, validated JSON, `dimensions_mm: null`, latency 3278 ms, 935 prompt tokens, 1075 completion tokens, 779 reasoning tokens, 2010 total tokens. PayPal was not part of that call.
