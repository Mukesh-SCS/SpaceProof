# Final evaluation

October 30, 2026. Measured results are separated from work that has not been run.

## Measured: automated policy tests

`npm test` in `web/`: 15 files, 71 tests, passed. `pytest` in `vision/`: 28 tests, passed. PayPal and Nebius were mocked.

| Decision | Covered by | This run |
| --- | --- | --- |
| Correct `FIT` for the 1000 mm Nook desk in a 1500 mm room | `web/src/lib/geometry/fit.test.ts` | Passed |
| Correct `DOES_NOT_FIT` for width, clearance, and budget | same | Passed |
| `UNCERTAIN` when a measurement is missing or unconfirmed | same | Passed |
| Dining table with no chair clearance stays `UNCERTAIN` | same | Passed |
| Client price or client fit result cannot open checkout | `web/src/lib/paypal/orders.test.ts` | Passed |
| Stale assessment is not captured | same | Passed |
| Duplicate capture does not call the provider again | same | Passed |
| Failed or canceled provider results are not completed payments | same | Passed |

No false `FIT` count on photographed rooms is available. The tests use stored millimeters, not pictures.

## Measured: one live capture

October 30 read-back: order `8NN90589CS658724M` is `COMPLETED`, authorization `93V392390C594062Y` is `CAPTURED`, capture `66M90673NA362091J` is `COMPLETED`, USD 129.00. Details are in `docs/evidence/paypal-verification.md`.

No live `VOIDED` authorization was read.

## Measured: synthetic placement images

`eval/results.json`, batch at `2026-10-28T19:09:23Z`, model `nvidia/Nemotron-3.5-Super-VL`. The images are drawings from `vision/scripts/make_eval_images.py`, not owned room photographs. Overlap is with the painted floor. It is not a centimeter error.

| Image | Overlap | Proposal |
| --- | --- | --- |
| room-01-corner | 0.3403 | box |
| room-02-window | 0.5172 | box |
| room-03-plant | none | no box |
| room-04-narrow | 0.3559 | box |
| room-05-alcove | 0.56 | box |
| room-06-shelf | 0.4345 | box |
| room-07-bright | 0.0 | box, no overlap |
| room-08-side | 0.3983 | box |
| room-09-low | 0.6364 | box |
| room-10-emptyish | 0.329 | box |

Nine of ten returned a box. One returned none. Every stored response has `dimensions_mm: null`. The batch file does not record per-image latency or a buyer correction.

One later call on `room-01-corner.jpg` took 3278 ms and 2010 tokens. File: `eval/evidence/nebius-room-01-corner-20261028T195945Z.json`.

## Not measured: real room photographs

No licensed or owner-supplied room photographs, and no independently measured rooms, are in the repository. Real-photo evaluation is incomplete. Bounding-box overlap on the drawings above is not physical-fit accuracy.

### How to run that study later

Use 10 to 20 photographs the owner took or has a license to publish. Record the source and permission in `docs/ATTRIBUTION.md` before adding the files under `eval/photos/`. Do not add pictures of other people's homes without permission.

For each photo, a person draws the usable floor rectangle in normalized coordinates and stores it in `eval/photos/expected.json`. Do not ask the model for that rectangle first. Then run `vision/scripts/run_eval.py` against those files, or the same client the script already uses, and record:

- whether a box was returned
- overlap with the hand-drawn rectangle
- invalid JSON or timeout
- whether a person still moved the rectangle before confirming

Keep `dimensions_mm` null. A high overlap still does not mean the desk fits.

For fit decisions, use a tape measure or a fixture whose width and depth are written down before the test. Enter those feet and inches. Compare the server result with the known product millimeters. Count correct `FIT`, correct `DOES_NOT_FIT`, `UNCERTAIN`, and any `FIT` that the tape measure contradicts. Those counts are not in this file because that measurement pass was not done.
