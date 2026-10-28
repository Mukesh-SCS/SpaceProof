import { describe, expect, it } from "vitest";
import { formatUsd, minorToPayPalValue, parseUsdToMinor, payPalValueToMinor } from "@/lib/money";

describe("money", () => {
  it("formats integer cents without floating-point arithmetic", () => {
    expect(minorToPayPalValue(12900)).toBe("129.00");
    expect(minorToPayPalValue(100)).toBe("1.00");
    expect(minorToPayPalValue(1099)).toBe("10.99");
    expect(minorToPayPalValue(0)).toBe("0.00");
    expect(formatUsd(18000)).toBe("$180.00");
  });

  it("round-trips PayPal amount strings", () => {
    expect(payPalValueToMinor("129.00")).toBe(12900);
    expect(payPalValueToMinor("219.00")).toBe(21900);
    expect(payPalValueToMinor("129")).toBeNull();
    expect(payPalValueToMinor("129.5")).toBeNull();
    expect(payPalValueToMinor("129.999")).toBeNull();
  });

  it("parses dollar input into cents", () => {
    expect(parseUsdToMinor("180")).toBe(18000);
    expect(parseUsdToMinor("180.5")).toBe(18050);
    expect(parseUsdToMinor("180.50")).toBe(18050);
    expect(parseUsdToMinor("180.999")).toBeNull();
    expect(parseUsdToMinor("abc")).toBeNull();
  });
});
