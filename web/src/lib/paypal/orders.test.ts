import { describe, expect, it, vi } from "vitest";
import type { CatalogProduct } from "@/lib/geometry/fit";
import { evidenceFingerprint, type EvidenceRoom } from "@/lib/policy/fingerprint";
import type { CheckoutContext, CheckoutRepository, TransactionRecord } from "@/lib/paypal/orders";
import {
  authorizePayPalOrder,
  cancelPayPalOrder,
  capturePayPalOrder,
  createPayPalOrder,
  voidPayPalOrder,
} from "@/lib/paypal/orders";
import type { PayPalGateway } from "@/lib/paypal/gateway";
import type { PayPalOrderSnapshot } from "@/lib/paypal/snapshot";
import type { FitResult } from "@/lib/geometry/fit";

const NOW = new Date("2026-10-28T15:00:00.000Z");

const nook: CatalogProduct & { id: string; title: string } = {
  id: "prod-nook",
  sku: "DESK-NOOK-100",
  title: "Nook Desk",
  widthMm: 1000,
  depthMm: 550,
  heightMm: 740,
  priceMinor: 12900,
  currency: "USD",
  available: true,
};

function room(overrides: Partial<EvidenceRoom> = {}): EvidenceRoom {
  return {
    id: "room-1",
    availableWidthMm: 1500,
    availableDepthMm: 1200,
    requiredHorizontalClearanceMm: 200,
    requiredDepthClearanceMm: 200,
    budgetMinor: 18000,
    currency: "USD",
    confirmed: true,
    version: 1,
    ...overrides,
  };
}

function context(options: {
  room?: Partial<EvidenceRoom>;
  result?: FitResult;
  product?: CatalogProduct & { id: string; title: string };
} = {}): CheckoutContext {
  const product = options.product ?? nook;
  const current = room(options.room);
  const result = options.result ?? "FIT";
  return {
    assessment: {
      id: "assess-1",
      result,
      productSku: product.sku,
      measurementVersion: options.room?.version ?? current.version,
      policyFingerprint: evidenceFingerprint({ product, room: current, result }),
      createdAt: NOW,
      roomId: current.id,
    },
    room: current,
    product,
  };
}

function emptySnapshot(overrides: Partial<PayPalOrderSnapshot> = {}): PayPalOrderSnapshot {
  return {
    id: "ORDER-1",
    status: "CREATED",
    authorizationId: null,
    authorizationStatus: null,
    captureId: null,
    captureStatus: null,
    amountValue: "129.00",
    currency: "USD",
    ...overrides,
  };
}

function gateway(): PayPalGateway {
  return {
    createOrder: vi.fn(async (input) =>
      emptySnapshot({ amountValue: input.amountValue, currency: input.currency }),
    ),
    authorizeOrder: vi.fn(),
    captureAuthorization: vi.fn(),
    voidAuthorization: vi.fn(),
    getOrder: vi.fn(),
    getAuthorization: vi.fn(),
    getCapture: vi.fn(),
  };
}

function repository(loaded: CheckoutContext | null): CheckoutRepository {
  return {
    getContext: vi.fn(async () => loaded),
    findOpenPayment: vi.fn(async () => null),
    reserve: vi.fn(async () => ({
      intentId: "intent-1",
      requestId: "req-create",
      authorizeRequestId: "req-authorize",
      captureRequestId: "req-capture",
      voidRequestId: "req-void",
    })),
    attachOrder: vi.fn(async () => undefined),
    failOrder: vi.fn(async () => undefined),
    getTransactionByOrderId: vi.fn(),
    recordOutcome: vi.fn(async () => undefined),
  };
}

function transaction(overrides: Partial<TransactionRecord> = {}): TransactionRecord {
  const base = context();
  return {
    intentId: "intent-1",
    orderId: "ORDER-1",
    ledgerStatus: "CREATED",
    amountMinor: 12900,
    currency: "USD",
    authorizationId: null,
    captureId: null,
    authorizeRequestId: "req-authorize",
    captureRequestId: "req-capture",
    voidRequestId: "req-void",
    providerStatus: "CREATED",
    policyFingerprint: base.assessment.policyFingerprint,
    buyerConsentAt: NOW,
    assessment: base.assessment,
    room: base.room,
    product: base.product,
    ...overrides,
  };
}

const verifiedAuthorization = emptySnapshot({
  status: "COMPLETED",
  authorizationId: "AUTH-1",
  authorizationStatus: "CREATED",
  amountValue: "129.00",
  currency: "USD",
});

const verifiedCapture = emptySnapshot({
  id: "CAP-1",
  status: "COMPLETED",
  captureId: "CAP-1",
  captureStatus: "COMPLETED",
  amountValue: "129.00",
  currency: "USD",
});

describe("PayPal order policy", () => {
  it("an over-budget desk cannot be purchased", async () => {
    const loaded = context({ room: { budgetMinor: 10000 } });
    const repo = repository(loaded);
    const payments = gateway();
    const result = await createPayPalOrder(
      { repo, gateway: payments, now: () => NOW },
      { assessmentId: "assess-1", consent: true, claimedResult: "FIT", claimedPriceMinor: 100 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_ELIGIBLE");
    expect(payments.createOrder).not.toHaveBeenCalled();
    expect(repo.reserve).not.toHaveBeenCalled();
  });

  it("a forged client FIT result cannot create an eligible payment", async () => {
    const loaded = context({ result: "DOES_NOT_FIT" });
    const payments = gateway();
    const result = await createPayPalOrder(
      { repo: repository(loaded), gateway: payments, now: () => NOW },
      { assessmentId: "assess-1", consent: true, claimedResult: "FIT" },
    );
    expect(result.ok).toBe(false);
    expect(payments.createOrder).not.toHaveBeenCalled();
  });

  it("a forged client price or SKU mismatch cannot change the PayPal amount", async () => {
    const payments = gateway();
    const repo = repository(context());
    const priced = await createPayPalOrder(
      { repo, gateway: payments, now: () => NOW },
      { assessmentId: "assess-1", consent: true, claimedPriceMinor: 100, claimedSku: nook.sku },
    );
    expect(priced.ok).toBe(true);
    expect(payments.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ amountValue: "129.00", currency: "USD", sku: nook.sku }),
    );

    const switched = gateway();
    const mismatched = await createPayPalOrder(
      { repo: repository(context()), gateway: switched, now: () => NOW },
      { assessmentId: "assess-1", consent: true, claimedSku: "DESK-STUDIO-140", claimedPriceMinor: 100 },
    );
    expect(mismatched.ok).toBe(false);
    if (!mismatched.ok) expect(mismatched.code).toBe("SKU_MISMATCH");
    expect(switched.createOrder).not.toHaveBeenCalled();
  });

  it("FIT allows order creation while DOES_NOT_FIT and UNCERTAIN do not", async () => {
    const allowed = gateway();
    const fit = await createPayPalOrder(
      { repo: repository(context()), gateway: allowed, now: () => NOW },
      { assessmentId: "assess-1", consent: true },
    );
    expect(fit.ok).toBe(true);
    expect(allowed.createOrder).toHaveBeenCalledTimes(1);

    for (const result of ["DOES_NOT_FIT", "UNCERTAIN"] as const) {
      const blocked = gateway();
      const response = await createPayPalOrder(
        {
          repo: repository(context({ result })),
          gateway: blocked,
          now: () => NOW,
        },
        { assessmentId: "assess-1", consent: true, claimedResult: "FIT" },
      );
      expect(response.ok).toBe(false);
      expect(blocked.createOrder).not.toHaveBeenCalled();
      expect(blocked.authorizeOrder).not.toHaveBeenCalled();
    }
  });

  it("authorizes a fresh FIT order without capturing it", async () => {
    const payments = gateway();
    payments.authorizeOrder = vi.fn(async () => verifiedAuthorization);
    payments.getOrder = vi.fn(async () => verifiedAuthorization);
    const repo = repository(context());
    repo.getTransactionByOrderId = vi.fn(async () => transaction());
    const result = await authorizePayPalOrder({ repo, gateway: payments, now: () => NOW }, "ORDER-1");
    expect(result).toMatchObject({
      ok: true,
      completed: false,
      ledgerStatus: "AUTHORIZED",
      displayStatus: "AUTHORIZED",
      authorizationId: "AUTH-1",
      captureId: null,
    });
    expect(payments.captureAuthorization).not.toHaveBeenCalled();
    expect(repo.recordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ ledgerStatus: "AUTHORIZED", authorizationId: "AUTH-1" }),
    );
  });

  it("a changed measurement voids an authorization instead of capturing", async () => {
    const fresh = context();
    const payments = gateway();
    payments.voidAuthorization = vi.fn(async () => emptySnapshot({ status: "ACCEPTED", authorizationId: "AUTH-1" }));
    payments.getAuthorization = vi.fn(async () =>
      emptySnapshot({
        id: "AUTH-1",
        status: "VOIDED",
        authorizationId: "AUTH-1",
        authorizationStatus: "VOIDED",
      }),
    );
    const repo = repository(fresh);
    repo.getTransactionByOrderId = vi.fn(async () =>
      transaction({
        ledgerStatus: "AUTHORIZED",
        authorizationId: "AUTH-1",
        providerStatus: "CREATED",
        room: room({ version: 2, availableWidthMm: 1000 }),
        assessment: fresh.assessment,
      }),
    );
    const result = await capturePayPalOrder({ repo, gateway: payments, now: () => NOW }, "ORDER-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.completed).toBe(false);
      expect(result.ledgerStatus).toBe("VOIDED");
      expect(result.displayStatus).toBe("VOIDED");
      expect(result.captureId).toBeNull();
    }
    expect(payments.captureAuthorization).not.toHaveBeenCalled();
    expect(payments.voidAuthorization).toHaveBeenCalledTimes(1);
    expect(repo.recordOutcome).toHaveBeenCalledWith(expect.objectContaining({ ledgerStatus: "VOIDED" }));
  });

  it("captures a valid authorization once and ignores a duplicate capture", async () => {
    const payments = gateway();
    payments.captureAuthorization = vi.fn(async () => verifiedCapture);
    payments.getCapture = vi.fn(async () => verifiedCapture);
    const current = transaction({
      ledgerStatus: "AUTHORIZED",
      authorizationId: "AUTH-1",
      providerStatus: "CREATED",
    });
    let stored = current;
    const repo = repository(context());
    repo.getTransactionByOrderId = vi.fn(async () => stored);
    repo.recordOutcome = vi.fn(async (input) => {
      stored = {
        ...stored,
        ledgerStatus: input.ledgerStatus,
        providerStatus: input.providerStatus,
        captureId: input.captureId ?? stored.captureId,
      };
    });

    const first = await capturePayPalOrder({ repo, gateway: payments, now: () => NOW }, "ORDER-1");
    const second = await capturePayPalOrder({ repo, gateway: payments, now: () => NOW }, "ORDER-1");
    expect(first).toMatchObject({ ok: true, completed: true, ledgerStatus: "COMPLETED", captureId: "CAP-1" });
    expect(second).toMatchObject({ ok: true, completed: true, captureId: "CAP-1" });
    expect(payments.captureAuthorization).toHaveBeenCalledTimes(1);
    expect(payments.getCapture).toHaveBeenCalledTimes(1);
  });

  it("voids an eligible uncaptured authorization", async () => {
    const payments = gateway();
    payments.voidAuthorization = vi.fn(async () => emptySnapshot({ authorizationId: "AUTH-1" }));
    payments.getAuthorization = vi.fn(async () =>
      emptySnapshot({
        id: "AUTH-1",
        status: "VOIDED",
        authorizationId: "AUTH-1",
        authorizationStatus: "VOIDED",
      }),
    );
    const repo = repository(context());
    repo.getTransactionByOrderId = vi.fn(async () =>
      transaction({ ledgerStatus: "AUTHORIZED", authorizationId: "AUTH-1" }),
    );
    const result = await voidPayPalOrder({ repo, gateway: payments, now: () => NOW }, "ORDER-1");
    expect(result).toMatchObject({ ok: true, completed: false, ledgerStatus: "VOIDED", captureId: null });
    expect(payments.captureAuthorization).not.toHaveBeenCalled();
    expect(payments.voidAuthorization).toHaveBeenCalledWith({
      authorizationId: "AUTH-1",
      requestId: "req-void",
    });
  });

  it("payment cancellation or failure does not create a completed transaction", async () => {
    const failedGateway = gateway();
    const declined = emptySnapshot({
      id: "CAP-1",
      status: "DECLINED",
      captureId: "CAP-1",
      captureStatus: "DECLINED",
    });
    failedGateway.captureAuthorization = vi.fn(async () => declined);
    const failedRepo = repository(context());
    failedRepo.getTransactionByOrderId = vi.fn(async () =>
      transaction({ ledgerStatus: "AUTHORIZED", authorizationId: "AUTH-1" }),
    );
    const failure = await capturePayPalOrder(
      { repo: failedRepo, gateway: failedGateway, now: () => NOW },
      "ORDER-1",
    );
    expect(failure.ok).toBe(true);
    if (failure.ok) {
      expect(failure.completed).toBe(false);
      expect(failure.ledgerStatus).toBe("FAILED");
      expect(failure.displayStatus).not.toBe("CAPTURED");
    }
    expect(failedRepo.recordOutcome).toHaveBeenCalledWith(expect.objectContaining({ ledgerStatus: "FAILED" }));

    const cancelRepo = repository(context());
    cancelRepo.getTransactionByOrderId = vi.fn(async () => transaction());
    const canceled = await cancelPayPalOrder({ repo: cancelRepo, gateway: gateway(), now: () => NOW }, "ORDER-1");
    expect(canceled.ok).toBe(true);
    if (canceled.ok) {
      expect(canceled.completed).toBe(false);
      expect(canceled.ledgerStatus).toBe("CANCELED");
      expect(canceled.captureId).toBeNull();
    }
  });
});
