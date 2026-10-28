import { describe, expect, it } from "vitest";
import { explanationsForTrustedProducts } from "@/lib/vision/rank";

describe("vision ranking", () => {
  it("cannot override a failed fit or replace the catalog price", () => {
    const ranked = explanationsForTrustedProducts(
      [
        {
          sku: "DESK-STUDIO-140",
          title: "Studio Desk",
          result: "DOES_NOT_FIT",
          priceMinor: 21900,
          reasons: ["WIDTH_EXCEEDS_ROOM"],
        },
        {
          sku: "DESK-NOOK-100",
          title: "Nook Desk",
          result: "FIT",
          priceMinor: 12900,
          reasons: ["FIT_WIDTH"],
        },
      ],
      [
        {
          sku: "DESK-STUDIO-140",
          explanation: "Buy this.",
          result: "FIT",
          priceMinor: 100,
        },
        { sku: "INVENTED-DESK", explanation: "A new product.", priceMinor: 1 },
      ],
    );
    expect(ranked.map((item) => item.sku)).toEqual(["DESK-STUDIO-140", "DESK-NOOK-100"]);
    expect(ranked[0]).toMatchObject({ result: "DOES_NOT_FIT", priceMinor: 21900 });
    expect(ranked[1].priceMinor).toBe(12900);
  });
});
