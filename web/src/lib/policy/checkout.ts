import { assessFit, type CatalogProduct, type FitResult, type RoomConstraints } from "@/lib/geometry/fit";
import { evidenceFingerprint, type EvidenceRoom } from "@/lib/policy/fingerprint";

export const ASSESSMENT_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export interface StoredAssessment {
  id: string;
  result: FitResult;
  productSku: string;
  measurementVersion: number;
  policyFingerprint: string;
  createdAt: Date;
  roomId: string;
}

export type LedgerStatus =
  | "PENDING"
  | "CREATED"
  | "AUTHORIZED"
  | "COMPLETED"
  | "VOIDED"
  | "CANCELED"
  | "FAILED";

export interface PolicyRejection {
  ok: false;
  httpStatus: number;
  code: string;
  message: string;
  voidOutstanding: boolean;
}

export type Eligibility =
  | { ok: true; amountMinor: number; currency: "USD"; sku: string; fingerprint: string }
  | PolicyRejection;

export interface PaymentInterpretation {
  ledgerStatus: LedgerStatus;
  completed: boolean;
  providerStatus: string;
  code: string;
  message: string;
}

function rejected(
  httpStatus: number,
  code: string,
  message: string,
  voidOutstanding = false,
): PolicyRejection {
  return { ok: false, httpStatus, code, message, voidOutstanding };
}

/**
 * Decides whether the stored assessment still matches the live catalog and room.
 * Claimed prices and claimed fit results are ignored on purpose.
 */
export function evaluateEligibility(input: {
  assessment: StoredAssessment | null;
  product: CatalogProduct | null;
  room: EvidenceRoom | null;
  claimedResult?: unknown;
  claimedPriceMinor?: unknown;
  claimedSku?: unknown;
  consent: unknown;
  now: Date;
  maxAgeMs?: number;
}): Eligibility {
  void input.claimedResult;
  void input.claimedPriceMinor;

  if (!input.assessment || !input.room) {
    return rejected(404, "NOT_FOUND", "No server assessment exists for that id.");
  }

  const claimedSku = input.claimedSku;
  if (claimedSku !== undefined && claimedSku !== null && claimedSku !== "") {
    if (typeof claimedSku !== "string" || claimedSku !== input.assessment.productSku) {
      return rejected(
        403,
        "SKU_MISMATCH",
        "The requested SKU does not match the assessed product. The PayPal amount was not changed.",
      );
    }
  }

  if (input.consent !== true) {
    return rejected(403, "CONSENT_REQUIRED", "Checkout requires an explicit consent to the catalog price.");
  }

  const maxAgeMs = input.maxAgeMs ?? ASSESSMENT_MAX_AGE_MS;
  const ageMs = input.now.getTime() - input.assessment.createdAt.getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > maxAgeMs) {
    return rejected(403, "STALE_ASSESSMENT", "This fit assessment is no longer fresh. Check the fit again.");
  }

  if (!input.product || input.product.sku !== input.assessment.productSku) {
    return rejected(404, "CATALOG_MISSING", "The assessed SKU is not in the trusted catalog.");
  }

  if (input.room.id !== input.assessment.roomId) {
    return rejected(403, "ROOM_MISMATCH", "This assessment is not linked to the current room measurement.");
  }

  if (input.room.version !== input.assessment.measurementVersion) {
    return rejected(
      403,
      "STALE_ASSESSMENT",
      `Room measurements changed from version ${input.assessment.measurementVersion} to version ${input.room.version}. This fit assessment is no longer valid.`,
    );
  }

  const roomInput: RoomConstraints = input.room;
  const recomputed = assessFit(input.product, roomInput);
  if (input.assessment.result !== "FIT" || recomputed.result !== "FIT") {
    return rejected(403, "NOT_ELIGIBLE", "Only a current server result of FIT can continue checkout.");
  }

  const fingerprint = evidenceFingerprint({
    product: input.product,
    room: input.room,
    result: recomputed.result,
  });
  if (fingerprint !== input.assessment.policyFingerprint) {
    return rejected(
      403,
      "FINGERPRINT_MISMATCH",
      "The catalog, budget, or measurements no longer match this fit assessment.",
    );
  }

  if (recomputed.priceMinor === null || recomputed.currency !== "USD" || recomputed.priceMinor !== input.product.priceMinor) {
    return rejected(403, "AMOUNT_MISMATCH", "The fit result price does not match the catalog price.");
  }

  return {
    ok: true,
    amountMinor: input.product.priceMinor,
    currency: "USD",
    sku: input.product.sku,
    fingerprint,
  };
}

export function decideOrderCreation(input: Parameters<typeof evaluateEligibility>[0]): Eligibility {
  return evaluateEligibility(input);
}

export function decideAuthorization(input: {
  ledgerStatus: LedgerStatus;
  eligibility: Eligibility;
}): { ok: true } | PolicyRejection {
  if (input.ledgerStatus === "AUTHORIZED") {
    return { ok: true };
  }
  if (input.ledgerStatus === "COMPLETED") {
    return rejected(409, "ALREADY_COMPLETED", "This payment is already captured.");
  }
  if (input.ledgerStatus === "VOIDED") {
    return rejected(409, "VOIDED", "This authorization was already voided.");
  }
  if (input.ledgerStatus === "CANCELED") {
    return rejected(409, "CANCELED", "This checkout was canceled.");
  }
  if (input.ledgerStatus === "FAILED") {
    return rejected(409, "FAILED", "This checkout already failed.");
  }
  if (input.ledgerStatus !== "CREATED") {
    return rejected(409, "NOT_READY", "There is no approved PayPal order to authorize.");
  }
  if (!input.eligibility.ok) {
    return input.eligibility;
  }
  return { ok: true };
}

/**
 * Capture is allowed only while the linked assessment is still current.
 * A material change asks the caller to void the outstanding authorization.
 */
export function decideCapture(input: {
  ledgerStatus: LedgerStatus;
  transactionAmountMinor: number;
  transactionCurrency: string;
  intentFingerprint: string;
  buyerConsentAt: Date | null;
  assessment: StoredAssessment | null;
  product: CatalogProduct | null;
  room: EvidenceRoom | null;
  now: Date;
  maxAgeMs?: number;
}): { ok: true } | PolicyRejection {
  if (input.ledgerStatus === "COMPLETED") {
    return rejected(409, "ALREADY_COMPLETED", "This payment is already captured.");
  }
  if (input.ledgerStatus === "VOIDED") {
    return rejected(409, "VOIDED", "This authorization was already voided. No completed payment was recorded.");
  }
  if (input.ledgerStatus === "CANCELED") {
    return rejected(409, "CANCELED", "This checkout was canceled.");
  }
  if (input.ledgerStatus === "FAILED") {
    return rejected(409, "FAILED", "This checkout already failed.");
  }
  if (input.ledgerStatus !== "AUTHORIZED") {
    return rejected(409, "NOT_AUTHORIZED", "PayPal has not authorized this order yet. Capture was not requested.");
  }

  const eligible = evaluateEligibility({
    assessment: input.assessment,
    product: input.product,
    room: input.room,
    consent: input.buyerConsentAt ? true : false,
    now: input.now,
    maxAgeMs: input.maxAgeMs,
  });
  if (!eligible.ok) {
    return { ...eligible, voidOutstanding: true };
  }
  if (input.assessment && eligible.fingerprint !== input.assessment.policyFingerprint) {
    return rejected(403, "FINGERPRINT_MISMATCH", "The assessment evidence changed. Capture was refused.", true);
  }
  if (input.intentFingerprint !== eligible.fingerprint) {
    return rejected(
      403,
      "FINGERPRINT_MISMATCH",
      "The purchase intent no longer matches the fit assessment. Capture was refused.",
      true,
    );
  }
  if (eligible.amountMinor !== input.transactionAmountMinor || eligible.currency !== input.transactionCurrency) {
    return rejected(
      409,
      "AMOUNT_MISMATCH",
      "The catalog amount changed after PayPal authorization. Capture was refused.",
      true,
    );
  }
  return { ok: true };
}

export function decideVoid(input: { ledgerStatus: LedgerStatus; authorizationId: string | null }): { ok: true } | PolicyRejection {
  if (input.ledgerStatus === "COMPLETED") {
    return rejected(409, "ALREADY_COMPLETED", "A captured payment cannot be voided here.");
  }
  if (input.ledgerStatus === "VOIDED") {
    return { ok: true };
  }
  if (input.ledgerStatus !== "AUTHORIZED" || !input.authorizationId) {
    return rejected(409, "NOT_AUTHORIZED", "There is no uncaptured PayPal authorization to void.");
  }
  return { ok: true };
}

export function buyerFacingStatus(ledgerStatus: LedgerStatus, completed: boolean): string {
  if (completed && ledgerStatus === "COMPLETED") return "CAPTURED";
  return ledgerStatus;
}

export function interpretAuthorization(input: {
  authorizationStatus?: string | null;
  authorizationId?: string | null;
  amountMinor?: number | null;
  currency?: string | null;
  expectedAmountMinor: number;
  expectedCurrency: string;
  verifiedByReadback: boolean;
}): PaymentInterpretation {
  const authorizationStatus = (input.authorizationStatus ?? "").toUpperCase();
  const providerStatus = authorizationStatus || "UNKNOWN";
  const amountMatches = input.amountMinor === input.expectedAmountMinor && input.currency === input.expectedCurrency;
  const authorized =
    authorizationStatus === "CREATED" &&
    typeof input.authorizationId === "string" &&
    input.authorizationId.length > 0 &&
    amountMatches &&
    input.verifiedByReadback;

  if (authorized) {
    return {
      ledgerStatus: "AUTHORIZED",
      completed: false,
      providerStatus: "CREATED",
      code: "AUTHORIZED",
      message: "PayPal authorized the order. The payment is not captured yet.",
    };
  }

  if (["DENIED", "FAILED", "DECLINED", "EXPIRED"].includes(authorizationStatus)) {
    return {
      ledgerStatus: "FAILED",
      completed: false,
      providerStatus,
      code: "AUTHORIZATION_FAILED",
      message: "PayPal did not authorize the payment. No completed payment was recorded.",
    };
  }

  if (authorizationStatus === "VOIDED") {
    return {
      ledgerStatus: "VOIDED",
      completed: false,
      providerStatus: "VOIDED",
      code: "VOIDED",
      message: "PayPal voided the authorization. No completed payment was recorded.",
    };
  }

  if ((authorizationStatus === "CREATED" || authorizationStatus === "CAPTURED") && !amountMatches) {
    return {
      ledgerStatus: "FAILED",
      completed: false,
      providerStatus,
      code: "AMOUNT_MISMATCH",
      message: "The PayPal authorization amount did not match the catalog amount.",
    };
  }

  if (authorizationStatus === "CREATED" && !input.verifiedByReadback) {
    return {
      ledgerStatus: "FAILED",
      completed: false,
      providerStatus,
      code: "UNVERIFIED",
      message: "The PayPal authorization was not verified. It was not recorded as authorized.",
    };
  }

  return {
    ledgerStatus: "PENDING",
    completed: false,
    providerStatus: providerStatus || "PENDING",
    code: "PENDING",
    message: "PayPal has not authorized this order.",
  };
}

/**
 * A capture is completed only after a server read-back with a matching amount.
 * An authorized order is not a completed payment.
 */
export function interpretCapture(input: {
  captureStatus?: string | null;
  captureId?: string | null;
  amountMinor?: number | null;
  currency?: string | null;
  expectedAmountMinor: number;
  expectedCurrency: string;
  verifiedByReadback: boolean;
}): PaymentInterpretation {
  const captureStatus = (input.captureStatus ?? "").toUpperCase();
  const providerStatus = captureStatus || "UNKNOWN";
  const amountMatches = input.amountMinor === input.expectedAmountMinor && input.currency === input.expectedCurrency;
  const captured =
    captureStatus === "COMPLETED" &&
    typeof input.captureId === "string" &&
    input.captureId.length > 0 &&
    amountMatches &&
    input.verifiedByReadback;

  if (captured) {
    return {
      ledgerStatus: "COMPLETED",
      completed: true,
      providerStatus: "COMPLETED",
      code: "CAPTURED",
      message: "PayPal capture was verified by a server read-back.",
    };
  }

  if (["DENIED", "DECLINED", "FAILED"].includes(captureStatus)) {
    return {
      ledgerStatus: "FAILED",
      completed: false,
      providerStatus,
      code: "PAYMENT_FAILED",
      message: "PayPal declined or failed the capture. No completed payment was recorded.",
    };
  }

  if (captureStatus === "VOIDED" || captureStatus === "CANCELLED" || captureStatus === "CANCELED") {
    return {
      ledgerStatus: "CANCELED",
      completed: false,
      providerStatus,
      code: "CANCELED",
      message: "PayPal reported a canceled capture. No completed payment was recorded.",
    };
  }

  if (captureStatus === "COMPLETED" && !amountMatches) {
    return {
      ledgerStatus: "FAILED",
      completed: false,
      providerStatus,
      code: "AMOUNT_MISMATCH",
      message: "The PayPal capture amount did not match the catalog amount. Completion was not recorded.",
    };
  }

  if (captureStatus === "COMPLETED" && !input.verifiedByReadback) {
    return {
      ledgerStatus: "FAILED",
      completed: false,
      providerStatus,
      code: "UNVERIFIED",
      message: "The capture was not verified with PayPal. Completion was not recorded.",
    };
  }

  return {
    ledgerStatus: "PENDING",
    completed: false,
    providerStatus: providerStatus || "PENDING",
    code: "PENDING",
    message: "The PayPal payment is not captured.",
  };
}

export function interpretVoid(input: {
  authorizationStatus?: string | null;
  verifiedByReadback: boolean;
}): PaymentInterpretation {
  const authorizationStatus = (input.authorizationStatus ?? "").toUpperCase();
  if (authorizationStatus === "VOIDED" && input.verifiedByReadback) {
    return {
      ledgerStatus: "VOIDED",
      completed: false,
      providerStatus: "VOIDED",
      code: "VOIDED",
      message: "PayPal voided the authorization. No completed payment was recorded.",
    };
  }
  return {
    ledgerStatus: "AUTHORIZED",
    completed: false,
    providerStatus: authorizationStatus || "UNKNOWN",
    code: "VOID_UNVERIFIED",
    message: "PayPal did not confirm that the authorization was voided. It is still treated as authorized.",
  };
}

export function interpretCancellation(): PaymentInterpretation {
  return {
    ledgerStatus: "CANCELED",
    completed: false,
    providerStatus: "CANCELED",
    code: "CANCELED",
    message: "The buyer canceled checkout. No completed payment was recorded.",
  };
}
