import { describe, expect, it } from "vitest";
import type { CatalogProduct } from "@/lib/geometry/fit";
import { evidenceFingerprint, type EvidenceRoom } from "@/lib/policy/fingerprint";
import {
  decideCapture,
  interpretAuthorization,
  interpretCancellation,
  interpretCapture,
  interpretVoid,
} from "@/lib/policy/checkout";

const NOW = new Date("2026-10-28T15:00:00.000Z");

const nook: CatalogProduct = {
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

describe("payment ledger", () => {
  it("does not treat authorization or cancellation as a completed payment", () => {
    const authorized = interpretAuthorization({
      authorizationStatus: "CREATED",
      authorizationId: "AUTH-1",
      amountMinor: 12900,
      currency: "USD",
      expectedAmountMinor: 12900,
      expectedCurrency: "USD",
      verifiedByReadback: true,
    });
    expect(authorized.ledgerStatus).toBe("AUTHORIZED");
    expect(authorized.completed).toBe(false);

    const canceled = interpretCancellation();
    expect(canceled.ledgerStatus).toBe("CANCELED");
    expect(canceled.completed).toBe(false);

    const declined = interpretCapture({
      captureStatus: "DECLINED",
      captureId: "CAP-1",
      amountMinor: 12900,
      currency: "USD",
      expectedAmountMinor: 12900,
      expectedCurrency: "USD",
      verifiedByReadback: true,
    });
    expect(declined.ledgerStatus).toBe("FAILED");
    expect(declined.completed).toBe(false);

    const unverified = interpretCapture({
      captureStatus: "COMPLETED",
      captureId: "CAP-1",
      amountMinor: 12900,
      currency: "USD",
      expectedAmountMinor: 12900,
      expectedCurrency: "USD",
      verifiedByReadback: false,
    });
    expect(unverified.completed).toBe(false);
    expect(unverified.ledgerStatus).not.toBe("COMPLETED");

    const pending = interpretCapture({
      captureStatus: "PENDING",
      expectedAmountMinor: 12900,
      expectedCurrency: "USD",
      verifiedByReadback: true,
    });
    expect(pending.completed).toBe(false);
    expect(pending.ledgerStatus).not.toBe("COMPLETED");
  });

  it("records completion only for a verified matching capture", () => {
    const completed = interpretCapture({
      captureStatus: "COMPLETED",
      captureId: "CAP-1",
      amountMinor: 12900,
      currency: "USD",
      expectedAmountMinor: 12900,
      expectedCurrency: "USD",
      verifiedByReadback: true,
    });
    expect(completed).toMatchObject({ ledgerStatus: "COMPLETED", completed: true, code: "CAPTURED" });
  });

  it("records a void only when PayPal confirms it", () => {
    const voided = interpretVoid({ authorizationStatus: "VOIDED", verifiedByReadback: true });
    expect(voided).toMatchObject({ ledgerStatus: "VOIDED", completed: false });

    const unverified = interpretVoid({ authorizationStatus: "VOIDED", verifiedByReadback: false });
    expect(unverified.ledgerStatus).not.toBe("VOIDED");
    expect(unverified.completed).toBe(false);
  });

  it("a changed measurement version blocks capture and asks for a void", () => {
    const current = room();
    const fingerprint = evidenceFingerprint({ product: nook, room: current, result: "FIT" });
    const decision = decideCapture({
      ledgerStatus: "AUTHORIZED",
      transactionAmountMinor: 12900,
      transactionCurrency: "USD",
      intentFingerprint: fingerprint,
      buyerConsentAt: NOW,
      assessment: {
        id: "assess-1",
        result: "FIT",
        productSku: nook.sku,
        measurementVersion: 1,
        policyFingerprint: fingerprint,
        createdAt: NOW,
        roomId: current.id,
      },
      product: nook,
      room: room({ version: 2, availableWidthMm: 1000 }),
      now: NOW,
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.code).toBe("STALE_ASSESSMENT");
      expect(decision.voidOutstanding).toBe(true);
    }
  });
});
