# PayPal verification

Read-only check on October 30, 2026. No order was created, authorized, captured, or voided for this review. Credentials stayed in `web/.env` and are not copied here.

The read used the local sandbox app through `web/scripts/verify-paypal-readonly.ts` against `https://api-m.sandbox.paypal.com`.

## LIVE SANDBOX: Nook Desk capture

| Field | Value |
| --- | --- |
| Scenario | Buyer-approved authorization, then a verified capture |
| SKU | `DESK-NOOK-100` |
| Fit assessment | The stored note says the server had recorded `FIT` before the order. This read did not reload that assessment row. |
| Order ID | `8NN90589CS658724M` |
| Order status | `COMPLETED` |
| Intent recorded earlier | `AUTHORIZE` |
| Authorization ID | `93V392390C594062Y` |
| Authorization status | `CAPTURED` |
| Capture ID | `66M90673NA362091J` |
| Capture status | `COMPLETED` |
| Amount | USD 129.00 |
| Observation | October 30, 2026, read back from PayPal. The October 28 file is `eval/evidence/paypal-sandbox-capture-20261028T2007Z.json`. |
| Result class | LIVE SANDBOX |

`CAPTURED` on the authorization means the hold was captured. It is not a void. A completed capture is not evidence that a later void happened.

A duplicate capture request on October 28 returned the same capture id. That earlier observation is in the same evidence file. It was not repeated on October 30.

## LIVE SANDBOX: orders that are no longer readable

On October 28, orders `4JY697996K476130H` and `4T750388D0073720Y` were read as `CREATED`, intent `AUTHORIZE`, USD 129.00, reference `DESK-NOOK-100`. Authorizing one of them before buyer approval returned HTTP 409 `NOT_APPROVED`.

On October 30 both IDs returned HTTP 404 `INVALID_RESOURCE_ID`. That is not a void. PayPal no longer has those resources for this app. Do not describe them as voided or captured.

## LIVE SANDBOX: blocked checkout, from the October 28 notes

These were observed then and were not repeated on October 30, because repeating them would create or reject new payment calls. The notes are in `eval/evidence/paypal-sandbox-20261028.json` and `docs/implementation.md`.

| Scenario | Result class | What was observed |
| --- | --- | --- |
| Unfit product | LIVE SANDBOX | HTTP 403 `NOT_ELIGIBLE`. No PayPal order id. |
| Client claimed 100 cents | LIVE SANDBOX | PayPal read the orders above as USD 129.00. |
| Stale room version | LIVE SANDBOX | HTTP 403 `STALE_ASSESSMENT` after the room moved from version 1 to version 2. |
| Authorize before approval | LIVE SANDBOX | HTTP 409 `NOT_APPROVED`. |

## Void

| Field | Value |
| --- | --- |
| Result class | UNVERIFIED |
| What is missing | No authorization in the evidence files, and no authorization read on October 30, has status `VOIDED`. PayPal did not return a separate void transaction id because no void was read. |

The owner reports that a live void works on the deployed app. This review did not find a provider resource that confirms it. Mocked tests in `web/src/lib/paypal/orders.test.ts` do cover the void path. A mocked test is not a live void.

## MOCKED TEST coverage

`npm test` on October 30 passed these cases without calling PayPal:

- An unfit or uncertain assessment does not create an order.
- A changed measurement voids an uncaptured authorization instead of capturing.
- A valid authorization is captured once, and a duplicate capture does not call PayPal again.
- Cancellation and provider failure are not stored as completed payments.

The payment code was not changed in this review.
