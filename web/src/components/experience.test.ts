import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AssessmentResponse, PaymentView } from "@/lib/api-types";
import {
  STALE_ASSESSMENT_NOTICE,
  checkoutClosedReason,
  journeySteps,
  paymentPresentation,
  selectCatalog,
  verdict,
} from "@/components/experience";
import { FitResult } from "@/components/fit-result";
import { PaymentStatus } from "@/components/payment-status";
import { PlacementEditor } from "@/components/placement-editor";
import { ProductCard } from "@/components/product-card";

const products = [
  { sku: "A" },
  { sku: "B" },
  { sku: "C" },
  { sku: "D" },
];

function assessment(result: AssessmentResponse["result"]): AssessmentResponse {
  return {
    assessmentId: result === "UNCERTAIN" ? null : "assess-1",
    roomId: "room-1",
    measurementVersion: 2,
    policyFingerprint: "fp",
    result,
    reasons: [{ code: "WIDTH_EXCEEDS_ROOM", message: "The desk is wider than the confirmed opening.", blocking: true }],
    explanation: "Required width is 160 cm. The confirmed opening is 100 cm.",
    product: null,
    comparison: {
      requiredWidthMm: 1600,
      requiredDepthMm: 900,
      availableWidthMm: 1000,
      availableDepthMm: 1200,
      requiredHorizontalClearanceMm: 200,
      requiredDepthClearanceMm: 200,
      budgetMinor: 18000,
      priceMinor: 12900,
      currency: "USD",
    },
  };
}

function payment(overrides: Partial<PaymentView> = {}): PaymentView {
  return {
    completed: false,
    ledgerStatus: "AUTHORIZED",
    displayStatus: "AUTHORIZED",
    providerStatus: "CREATED",
    orderId: "ORDER1",
    authorizationId: "AUTH1",
    captureId: null,
    amountMinor: 12900,
    currency: "USD",
    message: "PayPal authorized the payment.",
    ...overrides,
  };
}

describe("workspace presentation", () => {
  it("marks only the active journey step from confirmed application state", () => {
    expect(
      journeySteps({
        hasPhoto: true,
        measurementsConfirmed: false,
        hasCurrentAssessment: false,
        paymentSettled: false,
      }).map((step) => step.state),
    ).toEqual(["done", "current", "waiting", "waiting"]);
    expect(
      journeySteps({
        hasPhoto: false,
        measurementsConfirmed: true,
        hasCurrentAssessment: true,
        paymentSettled: false,
      }).map((step) => step.state),
    ).toEqual(["waiting", "done", "done", "current"]);
  });

  it("shows compatible desks first and keeps the selected desk visible", () => {
    const view = selectCatalog(products, { A: "DOES_NOT_FIT", B: "FIT", C: "FIT" }, "all", "A", false);
    expect(view.shown.map((item) => item.sku)).toEqual(["A", "B", "C"]);
    expect(view.hidden).toBe(1);
  });

  it("filters to desks that do not fit", () => {
    const view = selectCatalog(products, { A: "DOES_NOT_FIT", B: "FIT" }, "DOES_NOT_FIT", null, false);
    expect(view.shown.map((item) => item.sku)).toEqual(["A"]);
  });

  it("renders fit, blocked, and uncertain evidence in centimeters", () => {
    for (const result of ["FIT", "DOES_NOT_FIT", "UNCERTAIN"] as const) {
      const html = renderToStaticMarkup(createElement(FitResult, { assessment: assessment(result) }));
      expect(html).toContain(verdict(result).label);
      expect(html).toContain("100 cm");
      expect(html).toContain("$129.00");
      expect(html).toContain("View verification details");
      expect(html).not.toContain("WIDTH_EXCEEDS_ROOM");
    }
  });

  it("keeps checkout closed for a desk that does not fit and for a stale room", () => {
    expect(checkoutClosedReason({ result: "DOES_NOT_FIT", confirmed: true, sceneDirty: false, consented: true })).toMatch(/stays closed/);
    expect(checkoutClosedReason({ result: "UNCERTAIN", confirmed: false, sceneDirty: false, consented: false })).toMatch(/not confirmed/);
    expect(checkoutClosedReason({ result: "FIT", confirmed: true, sceneDirty: true, consented: true })).toMatch(/Verify the desk again/);
    expect(STALE_ASSESSMENT_NOTICE).toMatch(/cannot capture a payment/);
  });

  it("asks for a photo before an upload exists", () => {
    const html = renderToStaticMarkup(
      createElement(PlacementEditor, {
        imageUrl: null,
        box: null,
        obstacles: [],
        drawing: false,
        onDrawingChange: () => undefined,
        onBoxChange: () => undefined,
      }),
    );
    expect(html).toContain("Upload a room photo");
    expect(html).toContain("will not be measured");
  });

  it("shows an authorized hold separately from a captured receipt and a void", () => {
    const authorized = renderToStaticMarkup(
      createElement(PaymentStatus, {
        payment: payment(),
        busy: null,
        sku: "DESK-NOOK-100",
        onCapture: () => undefined,
        onVoid: () => undefined,
        onSaveRoom: () => undefined,
      }),
    );
    expect(authorized).toContain("AUTHORIZED");
    expect(authorized).toContain("not captured yet");
    expect(authorized).toContain("Capture payment");
    expect(authorized).not.toContain("CAPTURED");

    const captured = renderToStaticMarkup(
      createElement(PaymentStatus, {
        payment: payment({
          completed: true,
          ledgerStatus: "COMPLETED",
          displayStatus: "CAPTURED",
          captureId: "CAP1",
          message: "PayPal capture was verified by a server read-back.",
        }),
        busy: null,
        sku: "DESK-NOOK-100",
        onCapture: () => undefined,
        onVoid: () => undefined,
        onSaveRoom: () => undefined,
      }),
    );
    expect(captured).toContain("CAPTURED");
    expect(captured).toContain("CAP1");
    expect(captured).toContain("$129.00");
    expect(paymentPresentation(payment({ completed: true, displayStatus: "CAPTURED", captureId: "CAP1", ledgerStatus: "COMPLETED" })).receipt).toBe(true);

    const voided = renderToStaticMarkup(
      createElement(PaymentStatus, {
        payment: payment({
          ledgerStatus: "VOIDED",
          displayStatus: "VOIDED",
          message: "The desk no longer fits, so the authorization was voided.",
        }),
        busy: null,
        sku: "DESK-NOOK-100",
        historical: true,
        onCapture: () => undefined,
        onVoid: () => undefined,
        onSaveRoom: () => undefined,
      }),
    );
    expect(voided).toContain("VOIDED");
    expect(voided).toContain("Earlier transaction");
    expect(voided).toContain("No completed payment was recorded");
  });

  it("lets a buyer select a product card without inventing a fit result", () => {
    const html = renderToStaticMarkup(
      createElement(ProductCard, {
        title: "Nook Desk",
        sku: "DESK-NOOK-100",
        widthMm: 1000,
        depthMm: 550,
        priceMinor: 12900,
        explanation: "Not checked yet.",
        selected: false,
        loading: false,
        onSelect: () => undefined,
        onDetails: () => undefined,
      }),
    );
    expect(html).toContain("Nook Desk");
    expect(html).toContain("100 cm");
    expect(html).toContain("$129.00");
    expect(html).toContain("Not checked");
    expect(html).toContain("Select");
  });
});
