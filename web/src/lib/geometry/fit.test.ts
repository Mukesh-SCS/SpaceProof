import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEMO_ROOM, SCENARIO_A_WIDTH_MM, SCENARIO_B_WIDTH_MM } from "@/lib/demo-scenario";
import { assessFit, type CatalogProduct, type RoomConstraints } from "@/lib/geometry/fit";

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

const studio: CatalogProduct = {
  sku: "DESK-STUDIO-140",
  title: "Studio Desk",
  widthMm: 1400,
  depthMm: 700,
  heightMm: 750,
  priceMinor: 21900,
  currency: "USD",
  available: true,
};

function room(overrides: Partial<RoomConstraints> = {}): RoomConstraints {
  return {
    availableWidthMm: DEMO_ROOM.availableWidthMm,
    availableDepthMm: DEMO_ROOM.availableDepthMm,
    requiredHorizontalClearanceMm: DEMO_ROOM.requiredHorizontalClearanceMm,
    requiredDepthClearanceMm: DEMO_ROOM.requiredDepthClearanceMm,
    budgetMinor: DEMO_ROOM.budgetMinor,
    currency: DEMO_ROOM.currency,
    confirmed: DEMO_ROOM.confirmed,
    ...overrides,
  };
}

describe("deterministic fit engine", () => {
  it("a compatible affordable desk returns FIT", () => {
    const result = assessFit(nook, room());
    expect(result.result).toBe("FIT");
    expect(result.requiredWidthMm).toBe(1200);
    expect(result.requiredDepthMm).toBe(750);
    expect(result.priceMinor).toBe(12900);
    expect(result.reasons.map((reason) => reason.code)).toEqual([
      "FIT_WIDTH",
      "FIT_DEPTH",
      "FIT_BUDGET",
      "FIT_AVAILABLE",
    ]);
  });

  it("scenario B accepts a 100 cm desk in a 150 cm room", () => {
    const result = assessFit(nook, room({ availableWidthMm: SCENARIO_B_WIDTH_MM }));
    expect(SCENARIO_B_WIDTH_MM).toBe(1500);
    expect(nook.widthMm).toBe(1000);
    expect(result.result).toBe("FIT");
  });

  it("an oversized desk returns DOES_NOT_FIT", () => {
    const wide = { ...nook, sku: "DESK-WIDE", widthMm: 2100, depthMm: 500 };
    const result = assessFit(
      wide,
      room({
        requiredHorizontalClearanceMm: 0,
        requiredDepthClearanceMm: 0,
        availableWidthMm: 2000,
        availableDepthMm: 800,
        budgetMinor: 50000,
      }),
    );
    expect(result.result).toBe("DOES_NOT_FIT");
    expect(result.reasons.map((reason) => reason.code)).toContain("WIDTH_EXCEEDS_ROOM");
    expect(result.reasons.map((reason) => reason.code)).not.toContain("CLEARANCE_EXCEEDS_WIDTH");

    const deep = { ...nook, sku: "DESK-DEEP", widthMm: 900, depthMm: 1600 };
    const depthResult = assessFit(
      deep,
      room({
        requiredHorizontalClearanceMm: 0,
        requiredDepthClearanceMm: 0,
        availableWidthMm: 2000,
        availableDepthMm: 1500,
        budgetMinor: 50000,
      }),
    );
    expect(depthResult.result).toBe("DOES_NOT_FIT");
    expect(depthResult.reasons.map((reason) => reason.code)).toContain("DEPTH_EXCEEDS_ROOM");
  });

  it("scenario A rejects a 140 cm desk in a 100 cm room", () => {
    const result = assessFit(
      studio,
      room({ availableWidthMm: SCENARIO_A_WIDTH_MM, budgetMinor: 50000 }),
    );
    expect(SCENARIO_A_WIDTH_MM).toBe(1000);
    expect(studio.widthMm).toBe(1400);
    expect(result.result).toBe("DOES_NOT_FIT");
    expect(result.reasons.map((reason) => reason.code)).toContain("WIDTH_EXCEEDS_ROOM");
  });

  it("a clearance violation returns DOES_NOT_FIT", () => {
    const result = assessFit(
      nook,
      room({
        availableWidthMm: 1500,
        availableDepthMm: 1000,
        requiredHorizontalClearanceMm: 600,
        requiredDepthClearanceMm: 600,
        budgetMinor: 50000,
      }),
    );
    expect(nook.widthMm).toBeLessThan(1500);
    expect(nook.depthMm).toBeLessThan(1000);
    expect(result.result).toBe("DOES_NOT_FIT");
    expect(result.reasons.map((reason) => reason.code)).toEqual([
      "CLEARANCE_EXCEEDS_WIDTH",
      "CLEARANCE_EXCEEDS_DEPTH",
    ]);
  });

  it("an over-budget desk returns DOES_NOT_FIT", () => {
    const result = assessFit(
      nook,
      room({
        budgetMinor: 10000,
        requiredHorizontalClearanceMm: 0,
        requiredDepthClearanceMm: 0,
        availableWidthMm: 2000,
        availableDepthMm: 1500,
      }),
    );
    expect(result.result).toBe("DOES_NOT_FIT");
    expect(result.reasons.map((reason) => reason.code)).toEqual(["OVER_BUDGET"]);
  });

  it("missing or invalid measurements return UNCERTAIN", () => {
    const cases: RoomConstraints[] = [
      room({ availableWidthMm: null }),
      room({ availableDepthMm: undefined }),
      room({ requiredHorizontalClearanceMm: null }),
      room({ requiredDepthClearanceMm: null }),
      room({ budgetMinor: null }),
      room({ availableWidthMm: 0 }),
      room({ availableWidthMm: -5 }),
      room({ availableWidthMm: 10.5 }),
      room({ availableWidthMm: "2000" }),
      room({ requiredHorizontalClearanceMm: -1 }),
      room({ confirmed: false }),
      room({ confirmed: "true" }),
      room({ currency: "usd" }),
    ];

    for (const candidate of cases) {
      expect(assessFit(nook, candidate).result).toBe("UNCERTAIN");
    }

    expect(assessFit(null, room()).result).toBe("UNCERTAIN");
    expect(assessFit(null, room()).reasons.map((reason) => reason.code)).toContain("CATALOG_MISSING");
  });

  it("does not treat a photo measurement or a client price as catalog truth", () => {
    const tampered = {
      ...room(),
      photoWidthMm: 1,
      priceMinor: 100,
    };
    const result = assessFit(nook, tampered);
    expect(result.result).toBe("FIT");
    expect(result.priceMinor).toBe(nook.priceMinor);
    expect(result.availableWidthMm).toBe(DEMO_ROOM.availableWidthMm);
  });

  it("requires chair clearance before a dining table can fit", () => {
    const table = {
      ...nook,
      sku: "TABLE-CAFE-80",
      title: "Cafe Table",
      category: "dining_table" as const,
      widthMm: 800,
      depthMm: 800,
      priceMinor: 16900,
    };
    const tight = assessFit(table, room({ requiredHorizontalClearanceMm: 0, requiredDepthClearanceMm: 0 }));
    expect(tight.result).toBe("UNCERTAIN");
    expect(tight.reasons.map((reason) => reason.code)).toContain("CHAIR_CLEARANCE_REQUIRED");
    const held = assessFit(table, room());
    expect(held.result).toBe("FIT");
    expect(held.reasons.map((reason) => reason.code)).toContain("FIT_WIDTH");
    const blocked = assessFit(table, room({ availableWidthMm: 900 }));
    expect(blocked.result).toBe("DOES_NOT_FIT");
    expect(blocked.reasons.map((reason) => reason.code)).toContain("CLEARANCE_EXCEEDS_WIDTH");
    expect(blocked.explanation).toMatch(/chair clearance/);
    expect(blocked.explanation).not.toMatch(/doorway/i);
  });

  it("the seeded desks disagree on the demo corner", () => {
    const file = JSON.parse(readFileSync(path.resolve(process.cwd(), "../data/products.json"), "utf8")) as {
      products: CatalogProduct[];
    };
    expect(file.products.length).toBeGreaterThanOrEqual(12);
    expect(file.products.length).toBeLessThanOrEqual(20);
    expect(file.products.filter((product) => product.category === "dining_table").length).toBeGreaterThanOrEqual(3);
    expect(new Set(file.products.map((product) => product.sku)).size).toBe(file.products.length);
    const nookRow = file.products.find((product) => product.sku === "DESK-NOOK-100");
    const studio = file.products.find((product) => product.sku === "DESK-STUDIO-140");
    expect(nookRow?.widthMm).toBe(1000);
    expect(studio?.widthMm).toBe(1400);
    expect(assessFit(nookRow ?? null, room()).result).toBe("FIT");
    const wide = assessFit(studio ?? null, room());
    expect(wide.result).toBe("DOES_NOT_FIT");
    expect(wide.reasons.map((reason) => reason.code)).toEqual(
      expect.arrayContaining(["CLEARANCE_EXCEEDS_WIDTH", "OVER_BUDGET"]),
    );
  });
});
