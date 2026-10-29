import { describe, expect, it } from "vitest";
import {
  assessmentIsCurrent,
  checkoutMayOpen,
  confirmationStatement,
  retainPaymentHistory,
  sceneReplacement,
  sceneSignature,
  versionsAreConsistent,
  type AssessmentStamp,
  type SceneInputs,
} from "@/lib/scene-freshness";

const scene: SceneInputs = {
  imageToken: "photo-a",
  widthMm: 1500,
  depthMm: 1200,
  sideClearanceMm: 200,
  depthClearanceMm: 200,
  budget: "180",
  confirmed: true,
  placement: { minX: 0.1, minY: 0.2, maxX: 0.6, maxY: 0.8, label: "Desk area", source: "buyer" },
  constraintEpoch: 1,
};

function stamp(signature: string, overrides: Partial<AssessmentStamp> = {}): AssessmentStamp {
  return {
    sceneSignature: signature,
    roomId: "room-1",
    measurementVersion: 3,
    policyFingerprint: "abc",
    sku: "DESK-NOOK-100",
    priceMinor: 12900,
    result: "FIT",
    ...overrides,
  };
}

describe("scene freshness", () => {
  it("blocks checkout when the photograph is replaced", () => {
    const original = sceneSignature(scene);
    const next = sceneSignature({ ...scene, imageToken: "photo-b" });
    expect(assessmentIsCurrent(stamp(original), next)).toBe(false);
    expect(sceneReplacement()).toEqual({ confirmed: false, consent: false });
  });

  it("blocks checkout when the placement region moves", () => {
    const original = sceneSignature(scene);
    const moved = sceneSignature({
      ...scene,
      placement: { ...scene.placement!, minX: 0.2 },
    });
    expect(original).not.toBe(moved);
    expect(checkoutMayOpen({
      stamp: stamp(original),
      signature: moved,
      catalogSku: "DESK-NOOK-100",
      catalogPriceMinor: 12900,
      consent: true,
    })).toBe(false);
  });

  it("keeps a label-only placement edit from looking like a new region", () => {
    const renamed = sceneSignature({
      ...scene,
      placement: { ...scene.placement!, label: "Dining area", source: "ai" },
    });
    expect(renamed).toBe(sceneSignature(scene));
  });

  it("blocks checkout when measurements change or a save bumps the room epoch", () => {
    const original = sceneSignature(scene);
    expect(sceneSignature({ ...scene, widthMm: 1000 })).not.toBe(original);
    expect(sceneSignature({ ...scene, confirmed: false })).not.toBe(original);
    expect(sceneSignature({ ...scene, constraintEpoch: 2 })).not.toBe(original);
    expect(assessmentIsCurrent(stamp(original), sceneSignature({ ...scene, constraintEpoch: 2 }))).toBe(false);
  });

  it("opens checkout only for the current FIT, catalog SKU, and catalog price", () => {
    const signature = sceneSignature(scene);
    const current = stamp(signature);
    expect(checkoutMayOpen({
      stamp: current,
      signature,
      catalogSku: "DESK-NOOK-100",
      catalogPriceMinor: 12900,
      consent: true,
    })).toBe(true);
    expect(checkoutMayOpen({
      stamp: current,
      signature,
      catalogSku: "DESK-NOOK-100",
      catalogPriceMinor: 100,
      consent: true,
    })).toBe(false);
    expect(checkoutMayOpen({
      stamp: stamp(signature, { sku: "TABLE-CAFE-80" }),
      signature,
      catalogSku: "DESK-NOOK-100",
      catalogPriceMinor: 12900,
      consent: true,
    })).toBe(false);
    expect(checkoutMayOpen({
      stamp: stamp(signature, { result: "DOES_NOT_FIT" }),
      signature,
      catalogSku: "DESK-NOOK-100",
      catalogPriceMinor: 12900,
      consent: true,
    })).toBe(false);
    expect(checkoutMayOpen({
      stamp: current,
      signature,
      catalogSku: "DESK-NOOK-100",
      catalogPriceMinor: 12900,
      consent: false,
    })).toBe(false);
  });

  it("keeps completed payments when the scene is replaced", () => {
    const history = retainPaymentHistory({
      "DESK-NOOK-100": { displayStatus: "CAPTURED", captureId: "66M90673NA362091J" },
    });
    expect(history["DESK-NOOK-100"]?.displayStatus).toBe("CAPTURED");
  });

  it("requires one room version across a multi-product check", () => {
    expect(versionsAreConsistent([4, 4, null])).toBe(true);
    expect(versionsAreConsistent([4, 5])).toBe(false);
  });

  it("states the confirmed size of the selected area", () => {
    expect(confirmationStatement(1500, 1200)).toBe(
      "This selected area has 4 ft 11.06 in usable width and 3 ft 11.24 in usable depth.",
    );
  });
});
