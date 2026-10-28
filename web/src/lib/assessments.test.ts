import { describe, expect, it } from "vitest";
import { readAssessmentRequest } from "@/lib/assessments";
import { roomDraftChanged } from "@/lib/rooms";

describe("assessment requests", () => {
  it("drops a client price and a client fit result", () => {
    const parsed = readAssessmentRequest({
      sku: "DESK-NOOK-100",
      availableWidthMm: 1500,
      availableDepthMm: 1200,
      requiredHorizontalClearanceMm: 200,
      requiredDepthClearanceMm: 200,
      budgetMinor: 18000,
      currency: "USD",
      confirmed: true,
      priceMinor: 100,
      result: "FIT",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.room).not.toHaveProperty("priceMinor");
    expect(parsed).not.toHaveProperty("result");
    expect(JSON.stringify(parsed.room)).not.toContain("100");
    expect(JSON.stringify(parsed)).not.toContain("FIT");
  });
});

describe("room versions", () => {
  const draft = {
    availableWidthMm: 1500,
    availableDepthMm: 1200,
    requiredHorizontalClearanceMm: 200,
    requiredDepthClearanceMm: 200,
    budgetMinor: 18000,
    currency: "USD",
    confirmed: true,
  };

  it("keeps the version when the measurement is unchanged", () => {
    expect(roomDraftChanged(draft, { ...draft })).toBe(false);
  });

  it("changes when a relevant measurement changes", () => {
    expect(roomDraftChanged(draft, { ...draft, availableWidthMm: 1000 })).toBe(true);
    expect(roomDraftChanged(draft, { ...draft, budgetMinor: 10000 })).toBe(true);
    expect(roomDraftChanged(draft, { ...draft, confirmed: false })).toBe(true);
  });
});
