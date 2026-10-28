import { describe, expect, it } from "vitest";
import { placementChanged, readPlacement } from "@/lib/scene";

const box = {
  minX: 0.1,
  minY: 0.2,
  maxX: 0.6,
  maxY: 0.8,
  label: "Desk placement area",
  source: "ai" as const,
};

describe("placement regions", () => {
  it("accepts a normalized box and rounds coordinates", () => {
    const parsed = readPlacement({ ...box, minX: 0.10004 });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.placement?.minX).toBe(0.1);
  });

  it("rejects coordinates outside the image", () => {
    const parsed = readPlacement({ ...box, maxX: 1.2 });
    expect(parsed.ok).toBe(false);
  });

  it("treats a moved rectangle as a new scene version trigger", () => {
    expect(placementChanged(box, box)).toBe(false);
    expect(placementChanged(box, { ...box, maxX: 0.7, source: "buyer" })).toBe(true);
    expect(placementChanged(box, null)).toBe(true);
  });

  it("does not treat a label edit as a measurement change", () => {
    expect(placementChanged(box, { ...box, label: "Corner" })).toBe(false);
  });
});
