import { randomUUID } from "node:crypto";
import type { CatalogProduct } from "@/lib/geometry/fit";
import { minorToPayPalValue, payPalValueToMinor } from "@/lib/money";
import type { EvidenceRoom } from "@/lib/policy/fingerprint";
import {
  buyerFacingStatus,
  decideAuthorization,
  decideCapture,
  decideOrderCreation,
  decideVoid,
  evaluateEligibility,
  interpretAuthorization,
  interpretCancellation,
  interpretCapture,
  interpretVoid,
  type LedgerStatus,
  type PolicyRejection,
  type StoredAssessment,
} from "@/lib/policy/checkout";
import { PayPalConfigError, PayPalRequestError, type PayPalGateway } from "@/lib/paypal/gateway";
import type { PayPalOrderSnapshot } from "@/lib/paypal/snapshot";

export interface CheckoutContext {
  assessment: StoredAssessment;
  room: EvidenceRoom;
  product: CatalogProduct & { id: string; title: string };
}

export interface ReservedOrder {
  intentId: string;
  requestId: string;
  authorizeRequestId: string;
  captureRequestId: string;
  voidRequestId: string;
}

export interface TransactionRecord {
  intentId: string;
  orderId: string;
  ledgerStatus: LedgerStatus;
  amountMinor: number;
  currency: string;
  authorizationId: string | null;
  captureId: string | null;
  authorizeRequestId: string;
  captureRequestId: string;
  voidRequestId: string;
  providerStatus: string;
  policyFingerprint: string;
  buyerConsentAt: Date | null;
  assessment: StoredAssessment;
  room: EvidenceRoom;
  product: CatalogProduct & { id: string; title: string };
}

export type OpenPayment =
  | { kind: "reuse"; orderId: string; status: string }
  | { kind: "authorized"; orderId: string }
  | { kind: "completed"; orderId: string };

export interface CheckoutRepository {
  getContext(assessmentId: string): Promise<CheckoutContext | null>;
  findOpenPayment(assessmentId: string, amountMinor: number, currency: string): Promise<OpenPayment | null>;
  reserve(input: {
    assessmentId: string;
    productId: string;
    amountMinor: number;
    currency: string;
    consentAt: Date;
    policyDigest: string;
    requestId: string;
    authorizeRequestId: string;
    captureRequestId: string;
    voidRequestId: string;
  }): Promise<ReservedOrder>;
  attachOrder(intentId: string, order: { id: string; status: string }): Promise<void>;
  failOrder(intentId: string, providerStatus: string): Promise<void>;
  getTransactionByOrderId(orderId: string): Promise<TransactionRecord | null>;
  recordOutcome(input: {
    intentId: string;
    ledgerStatus: LedgerStatus;
    providerStatus: string;
    authorizationId?: string | null;
    captureId?: string | null;
  }): Promise<void>;
}

export type ApiFailure = {
  ok: false;
  httpStatus: number;
  code: string;
  message: string;
  missing?: string[];
};

export type CreateOrderResult =
  | {
      ok: true;
      orderId: string;
      status: string;
      amountMinor: number;
      currency: string;
      sku: string;
      reused: boolean;
    }
  | ApiFailure;

export type PaymentActionResult =
  | {
      ok: true;
      completed: boolean;
      ledgerStatus: LedgerStatus;
      displayStatus: string;
      providerStatus: string;
      orderId: string;
      authorizationId: string | null;
      captureId: string | null;
      amountMinor: number;
      currency: string;
      message: string;
    }
  | ApiFailure;

interface OrderDeps {
  repo: CheckoutRepository;
  gateway: PayPalGateway;
  now?: () => Date;
  newRequestId?: () => string;
}

function failureFromUnknown(error: unknown): ApiFailure {
  if (error instanceof PayPalConfigError) {
    return {
      ok: false,
      httpStatus: 503,
      code: "PAYPAL_NOT_CONFIGURED",
      message: "PayPal sandbox credentials are missing. No PayPal call was completed.",
      missing: error.missing,
    };
  }
  const message = error instanceof Error ? error.message : "PayPal request failed.";
  return { ok: false, httpStatus: 502, code: "PAYPAL_ERROR", message };
}

function fromPolicy(rejection: PolicyRejection): ApiFailure {
  return {
    ok: false,
    httpStatus: rejection.httpStatus,
    code: rejection.code,
    message: rejection.message,
  };
}

function minorOf(snapshot: PayPalOrderSnapshot): number | null {
  if (!snapshot.amountValue) return null;
  return payPalValueToMinor(snapshot.amountValue);
}

function action(input: {
  interpretation: { ledgerStatus: LedgerStatus; completed: boolean; providerStatus: string; message: string };
  orderId: string;
  authorizationId: string | null;
  captureId: string | null;
  amountMinor: number;
  currency: string;
  message?: string;
}): PaymentActionResult {
  const completed =
    input.interpretation.completed &&
    input.interpretation.ledgerStatus === "COMPLETED" &&
    typeof input.captureId === "string" &&
    input.captureId.length > 0;
  const ledgerStatus = completed ? "COMPLETED" : input.interpretation.ledgerStatus === "COMPLETED" ? "FAILED" : input.interpretation.ledgerStatus;
  return {
    ok: true,
    completed,
    ledgerStatus,
    displayStatus: buyerFacingStatus(ledgerStatus, completed),
    providerStatus: input.interpretation.providerStatus,
    orderId: input.orderId,
    authorizationId: input.authorizationId,
    captureId: completed ? input.captureId : input.interpretation.ledgerStatus === "COMPLETED" ? null : input.captureId,
    amountMinor: input.amountMinor,
    currency: input.currency,
    message: input.message ?? input.interpretation.message,
  };
}

export async function createPayPalOrder(
  deps: OrderDeps,
  input: {
    assessmentId: string;
    consent: unknown;
    claimedResult?: unknown;
    claimedPriceMinor?: unknown;
    claimedSku?: unknown;
  },
): Promise<CreateOrderResult> {
  const now = (deps.now ?? (() => new Date()))();
  const context = await deps.repo.getContext(input.assessmentId);
  const gate = decideOrderCreation({
    assessment: context?.assessment ?? null,
    product: context?.product ?? null,
    room: context?.room ?? null,
    claimedResult: input.claimedResult,
    claimedPriceMinor: input.claimedPriceMinor,
    claimedSku: input.claimedSku,
    consent: input.consent,
    now,
  });
  if (!gate.ok) return fromPolicy(gate);
  if (!context) {
    return { ok: false, httpStatus: 404, code: "NOT_FOUND", message: "No server assessment exists for that id." };
  }

  const existing = await deps.repo.findOpenPayment(context.assessment.id, gate.amountMinor, gate.currency);
  if (existing?.kind === "reuse") {
    return {
      ok: true,
      orderId: existing.orderId,
      status: existing.status,
      amountMinor: gate.amountMinor,
      currency: gate.currency,
      sku: gate.sku,
      reused: true,
    };
  }
  if (existing?.kind === "authorized") {
    return {
      ok: false,
      httpStatus: 409,
      code: "ALREADY_AUTHORIZED",
      message: "This fit assessment already has a PayPal authorization. Capture it or void it before starting another.",
    };
  }
  if (existing?.kind === "completed") {
    return {
      ok: false,
      httpStatus: 409,
      code: "ALREADY_COMPLETED",
      message: "This fit assessment already has a captured payment.",
    };
  }

  const newId = deps.newRequestId ?? randomUUID;
  const requestId = newId();
  const authorizeRequestId = newId();
  const captureRequestId = newId();
  const voidRequestId = newId();
  const reserved = await deps.repo.reserve({
    assessmentId: context.assessment.id,
    productId: context.product.id,
    amountMinor: gate.amountMinor,
    currency: gate.currency,
    consentAt: now,
    policyDigest: gate.fingerprint,
    requestId,
    authorizeRequestId,
    captureRequestId,
    voidRequestId,
  });

  try {
    const created = await deps.gateway.createOrder({
      requestId: reserved.requestId,
      amountValue: minorToPayPalValue(gate.amountMinor),
      currency: gate.currency,
      sku: gate.sku,
      description: context.product.title,
      customId: reserved.intentId,
    });
    await deps.repo.attachOrder(reserved.intentId, { id: created.id, status: created.status });
    return {
      ok: true,
      orderId: created.id,
      status: created.status,
      amountMinor: gate.amountMinor,
      currency: gate.currency,
      sku: gate.sku,
      reused: false,
    };
  } catch (error) {
    await deps.repo.failOrder(reserved.intentId, "CREATE_FAILED");
    return failureFromUnknown(error);
  }
}

async function loadTransaction(deps: OrderDeps, orderId: string): Promise<TransactionRecord | PaymentActionResult> {
  const transaction = await deps.repo.getTransactionByOrderId(orderId);
  if (!transaction) {
    return {
      ok: false,
      httpStatus: 404,
      code: "NOT_FOUND",
      message: "No SpaceProof payment exists for that PayPal order.",
    };
  }
  return transaction;
}

function isTransaction(value: TransactionRecord | PaymentActionResult): value is TransactionRecord {
  return "intentId" in value;
}

export async function authorizePayPalOrder(deps: OrderDeps, orderId: string): Promise<PaymentActionResult> {
  const loaded = await loadTransaction(deps, orderId);
  if (!isTransaction(loaded)) return loaded;
  const transaction = loaded;

  if (transaction.ledgerStatus === "COMPLETED" && transaction.captureId) {
    return action({
      interpretation: {
        ledgerStatus: "COMPLETED",
        completed: true,
        providerStatus: transaction.providerStatus,
        message: "This payment was already captured.",
      },
      orderId,
      authorizationId: transaction.authorizationId,
      captureId: transaction.captureId,
      amountMinor: transaction.amountMinor,
      currency: transaction.currency,
    });
  }

  if (transaction.ledgerStatus === "AUTHORIZED" && transaction.authorizationId) {
    return action({
      interpretation: {
        ledgerStatus: "AUTHORIZED",
        completed: false,
        providerStatus: transaction.providerStatus,
        message: "This order is already authorized. The payment is not captured.",
      },
      orderId,
      authorizationId: transaction.authorizationId,
      captureId: null,
      amountMinor: transaction.amountMinor,
      currency: transaction.currency,
    });
  }

  const now = (deps.now ?? (() => new Date()))();
  const eligibility = evaluateEligibility({
    assessment: transaction.assessment,
    product: transaction.product,
    room: transaction.room,
    consent: Boolean(transaction.buyerConsentAt),
    now,
  });
  const gate = decideAuthorization({ ledgerStatus: transaction.ledgerStatus, eligibility });
  if (!gate.ok) return fromPolicy(gate);

  try {
    const authorized = await deps.gateway.authorizeOrder({
      orderId,
      requestId: transaction.authorizeRequestId,
    });
    return await verifyAuthorization(deps, transaction, authorized);
  } catch (error) {
    if (error instanceof PayPalRequestError && error.issue === "ORDER_NOT_APPROVED") {
      return {
        ok: false,
        httpStatus: 409,
        code: "NOT_APPROVED",
        message: "The buyer has not approved this PayPal order yet.",
      };
    }
    if (
      error instanceof PayPalRequestError &&
      (error.issue === "ORDER_ALREADY_AUTHORIZED" || error.issue === "ORDER_ALREADY_CAPTURED")
    ) {
      try {
        const readback = await deps.gateway.getOrder(orderId);
        return await verifyAuthorization(deps, transaction, readback);
      } catch (readError) {
        return failureFromUnknown(readError);
      }
    }
    const failed = failureFromUnknown(error);
    if (failed.code !== "PAYPAL_NOT_CONFIGURED") {
      await deps.repo.recordOutcome({
        intentId: transaction.intentId,
        ledgerStatus: "FAILED",
        providerStatus: "AUTHORIZATION_FAILED",
      });
    }
    return failed;
  }
}

async function verifyAuthorization(
  deps: OrderDeps,
  transaction: TransactionRecord,
  authorized: PayPalOrderSnapshot,
): Promise<PaymentActionResult> {
  let readback: PayPalOrderSnapshot;
  try {
    readback = await deps.gateway.getOrder(transaction.orderId);
  } catch (error) {
    await deps.repo.recordOutcome({
      intentId: transaction.intentId,
      ledgerStatus: "FAILED",
      providerStatus: authorized.status,
    });
    const failed = failureFromUnknown(error);
    return {
      ...failed,
      code: "UNVERIFIED",
      message: "PayPal authorization was not verified by a follow-up read. It was not recorded as authorized.",
    };
  }

  const agrees =
    authorized.authorizationId === readback.authorizationId &&
    (authorized.authorizationStatus ?? readback.authorizationStatus) === readback.authorizationStatus;
  const interpreted = interpretAuthorization({
    authorizationStatus: readback.authorizationStatus,
    authorizationId: readback.authorizationId,
    amountMinor: minorOf(readback),
    currency: readback.currency,
    expectedAmountMinor: transaction.amountMinor,
    expectedCurrency: transaction.currency,
    verifiedByReadback: agrees,
  });

  await deps.repo.recordOutcome({
    intentId: transaction.intentId,
    ledgerStatus: interpreted.ledgerStatus,
    providerStatus: interpreted.providerStatus,
    authorizationId: interpreted.ledgerStatus === "AUTHORIZED" ? readback.authorizationId : undefined,
  });

  return action({
    interpretation: interpreted,
    orderId: transaction.orderId,
    authorizationId: interpreted.ledgerStatus === "AUTHORIZED" ? readback.authorizationId : transaction.authorizationId,
    captureId: null,
    amountMinor: transaction.amountMinor,
    currency: transaction.currency,
  });
}

export async function capturePayPalOrder(deps: OrderDeps, orderId: string): Promise<PaymentActionResult> {
  const loaded = await loadTransaction(deps, orderId);
  if (!isTransaction(loaded)) return loaded;
  const transaction = loaded;

  if (transaction.ledgerStatus === "COMPLETED" && transaction.captureId) {
    return action({
      interpretation: {
        ledgerStatus: "COMPLETED",
        completed: true,
        providerStatus: transaction.providerStatus,
        message: "This payment was already verified.",
      },
      orderId,
      authorizationId: transaction.authorizationId,
      captureId: transaction.captureId,
      amountMinor: transaction.amountMinor,
      currency: transaction.currency,
    });
  }

  const now = (deps.now ?? (() => new Date()))();
  const gate = decideCapture({
    ledgerStatus: transaction.ledgerStatus,
    transactionAmountMinor: transaction.amountMinor,
    transactionCurrency: transaction.currency,
    intentFingerprint: transaction.policyFingerprint,
    buyerConsentAt: transaction.buyerConsentAt,
    assessment: transaction.assessment,
    product: transaction.product,
    room: transaction.room,
    now,
  });
  if (!gate.ok) {
    if (gate.voidOutstanding && transaction.authorizationId) {
      const voided = await voidRecordedAuthorization(deps, transaction, gate.message);
      return voided;
    }
    return fromPolicy(gate);
  }

  if (!transaction.authorizationId) {
    return {
      ok: false,
      httpStatus: 409,
      code: "NOT_AUTHORIZED",
      message: "PayPal has not authorized this order yet. Capture was not requested.",
    };
  }

  try {
    const captured = await deps.gateway.captureAuthorization({
      authorizationId: transaction.authorizationId,
      requestId: transaction.captureRequestId,
    });
    return await verifyCapture(deps, transaction, captured);
  } catch (error) {
    if (error instanceof PayPalRequestError && error.issue === "AUTHORIZATION_ALREADY_CAPTURED") {
      try {
        const order = await deps.gateway.getOrder(orderId);
        if (order.captureId) {
          const readback = await deps.gateway.getCapture(order.captureId);
          return await verifyCapture(deps, transaction, readback);
        }
      } catch (readError) {
        return failureFromUnknown(readError);
      }
    }
    const failed = failureFromUnknown(error);
    if (failed.code !== "PAYPAL_NOT_CONFIGURED") {
      await deps.repo.recordOutcome({
        intentId: transaction.intentId,
        ledgerStatus: "FAILED",
        providerStatus: "CAPTURE_FAILED",
      });
    }
    return failed;
  }
}

async function verifyCapture(
  deps: OrderDeps,
  transaction: TransactionRecord,
  captured: PayPalOrderSnapshot,
): Promise<PaymentActionResult> {
  if (!captured.captureId || captured.captureStatus !== "COMPLETED") {
    const interpreted = interpretCapture({
      captureStatus: captured.captureStatus,
      captureId: captured.captureId,
      amountMinor: minorOf(captured),
      currency: captured.currency,
      expectedAmountMinor: transaction.amountMinor,
      expectedCurrency: transaction.currency,
      verifiedByReadback: false,
    });
    await deps.repo.recordOutcome({
      intentId: transaction.intentId,
      ledgerStatus: interpreted.ledgerStatus,
      providerStatus: interpreted.providerStatus,
    });
    return action({
      interpretation: interpreted,
      orderId: transaction.orderId,
      authorizationId: transaction.authorizationId,
      captureId: null,
      amountMinor: transaction.amountMinor,
      currency: transaction.currency,
    });
  }

  let readback: PayPalOrderSnapshot;
  try {
    readback = await deps.gateway.getCapture(captured.captureId);
  } catch (error) {
    await deps.repo.recordOutcome({
      intentId: transaction.intentId,
      ledgerStatus: "FAILED",
      providerStatus: captured.status,
    });
    const failed = failureFromUnknown(error);
    return {
      ...failed,
      code: "UNVERIFIED",
      message: "PayPal capture was not verified by a follow-up read. Completion was not recorded.",
    };
  }

  const agrees =
    captured.captureId === readback.captureId &&
    captured.captureStatus === readback.captureStatus &&
    captured.amountValue === readback.amountValue &&
    captured.currency === readback.currency;
  const interpreted = interpretCapture({
    captureStatus: readback.captureStatus,
    captureId: readback.captureId,
    amountMinor: minorOf(readback),
    currency: readback.currency,
    expectedAmountMinor: transaction.amountMinor,
    expectedCurrency: transaction.currency,
    verifiedByReadback: agrees,
  });

  await deps.repo.recordOutcome({
    intentId: transaction.intentId,
    ledgerStatus: interpreted.ledgerStatus,
    providerStatus: interpreted.providerStatus,
    captureId: interpreted.completed ? readback.captureId : undefined,
  });

  return action({
    interpretation: interpreted,
    orderId: transaction.orderId,
    authorizationId: transaction.authorizationId,
    captureId: interpreted.completed ? readback.captureId : null,
    amountMinor: transaction.amountMinor,
    currency: transaction.currency,
  });
}

export async function voidPayPalOrder(deps: OrderDeps, orderId: string): Promise<PaymentActionResult> {
  const loaded = await loadTransaction(deps, orderId);
  if (!isTransaction(loaded)) return loaded;
  if (loaded.ledgerStatus === "VOIDED") {
    return action({
      interpretation: {
        ledgerStatus: "VOIDED",
        completed: false,
        providerStatus: "VOIDED",
        message: "This authorization is already voided. No completed payment was recorded.",
      },
      orderId,
      authorizationId: loaded.authorizationId,
      captureId: null,
      amountMinor: loaded.amountMinor,
      currency: loaded.currency,
    });
  }
  const gate = decideVoid({ ledgerStatus: loaded.ledgerStatus, authorizationId: loaded.authorizationId });
  if (!gate.ok) return fromPolicy(gate);
  return voidRecordedAuthorization(deps, loaded, null);
}

async function voidRecordedAuthorization(
  deps: OrderDeps,
  transaction: TransactionRecord,
  reason: string | null,
): Promise<PaymentActionResult> {
  if (!transaction.authorizationId) {
    return {
      ok: false,
      httpStatus: 409,
      code: "NOT_AUTHORIZED",
      message: "There is no PayPal authorization to void.",
    };
  }

  try {
    await deps.gateway.voidAuthorization({
      authorizationId: transaction.authorizationId,
      requestId: transaction.voidRequestId,
    });
  } catch (error) {
    if (!(error instanceof PayPalRequestError)) {
      const failed = failureFromUnknown(error);
      return {
        ...failed,
        message: reason
          ? `${reason} PayPal did not void the authorization. No completed payment was recorded.`
          : failed.message,
      };
    }
  }

  let readback: PayPalOrderSnapshot;
  try {
    readback = await deps.gateway.getAuthorization(transaction.authorizationId);
  } catch (error) {
    const failed = failureFromUnknown(error);
    return {
      ...failed,
      code: "VOID_UNVERIFIED",
      message: reason
        ? `${reason} PayPal did not confirm the void. The authorization was not recorded as voided.`
        : "PayPal did not confirm the void. The authorization was not recorded as voided.",
    };
  }

  const interpreted = interpretVoid({
    authorizationStatus: readback.authorizationStatus,
    verifiedByReadback: true,
  });
  if (interpreted.ledgerStatus === "VOIDED") {
    await deps.repo.recordOutcome({
      intentId: transaction.intentId,
      ledgerStatus: "VOIDED",
      providerStatus: "VOIDED",
    });
  }

  const message = reason ? `${reason} ${interpreted.message}` : interpreted.message;
  if (interpreted.ledgerStatus !== "VOIDED") {
    return {
      ok: false,
      httpStatus: 502,
      code: "VOID_UNVERIFIED",
      message,
    };
  }

  return action({
    interpretation: interpreted,
    orderId: transaction.orderId,
    authorizationId: transaction.authorizationId,
    captureId: null,
    amountMinor: transaction.amountMinor,
    currency: transaction.currency,
    message,
  });
}

export async function cancelPayPalOrder(deps: OrderDeps, orderId: string): Promise<PaymentActionResult> {
  const loaded = await loadTransaction(deps, orderId);
  if (!isTransaction(loaded)) return loaded;
  if (loaded.ledgerStatus === "COMPLETED") {
    return {
      ok: false,
      httpStatus: 409,
      code: "ALREADY_COMPLETED",
      message: "A verified payment cannot be marked canceled.",
    };
  }
  if (loaded.ledgerStatus === "AUTHORIZED") {
    return {
      ok: false,
      httpStatus: 409,
      code: "USE_VOID",
      message: "This order is authorized. Void the authorization instead of marking it canceled.",
    };
  }
  if (loaded.ledgerStatus === "VOIDED") {
    return action({
      interpretation: {
        ledgerStatus: "VOIDED",
        completed: false,
        providerStatus: "VOIDED",
        message: "This authorization is already voided.",
      },
      orderId,
      authorizationId: loaded.authorizationId,
      captureId: null,
      amountMinor: loaded.amountMinor,
      currency: loaded.currency,
    });
  }

  const interpreted = interpretCancellation();
  await deps.repo.recordOutcome({
    intentId: loaded.intentId,
    ledgerStatus: interpreted.ledgerStatus,
    providerStatus: interpreted.providerStatus,
  });
  return action({
    interpretation: interpreted,
    orderId,
    authorizationId: null,
    captureId: null,
    amountMinor: loaded.amountMinor,
    currency: loaded.currency,
  });
}
